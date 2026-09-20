import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { initTheme, SessionManager, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../src/tools.js";
import { ToolRenderCache } from "../src/render-cache.js";

const plain = (row: ToolExecutionComponent, width = 120) => row.render(width).map(line => stripTerminalSequences(line).trimEnd()).join("\n");
const call = (id: string, args = { path: `src/${id}.ts` }, name = "read") => ({ type: "toolCall", id, name, arguments: args });
const message = (content: unknown[]) => ({ role: "assistant", content, stopReason: "toolUse", timestamp: 0 });
const result = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });
function harness(start = true, cache = new ToolRenderCache()) {
  initTheme("dark", false);
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Array<(event: any, ctx: any) => void>>();
  const sessionManager = SessionManager.inMemory(process.cwd());
  const emit = (type: string, event = {}) => {
    for (const handler of handlers.get(type) ?? []) handler({ type, ...event }, { mode: "tui", cwd: process.cwd(), sessionManager });
  };
  registerCodexTools({
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    on(type: string, handler: (event: any, ctx: any) => void) {
      const listeners = handlers.get(type) ?? []; listeners.push(handler); handlers.set(type, listeners);
    },
  } as unknown as ExtensionAPI, undefined, { renderCache: cache });
  if (start) emit("session_start");
  return {
    emit, sessionManager, tools, cache,
    declare(content: unknown[]) { emit("message_start", { message: message([]) }); emit("message_update", { message: message(content) }); },
    row(id: string, args: Record<string, unknown> = { path: `src/${id}.ts` }) {
      return new ToolExecutionComponent("read", id, args, { showImages: false }, tools.get("read"),
        { requestRender() {} } as never, process.cwd());
    },
    publish(id: string, value: ReturnType<typeof result>, args: Record<string, unknown> = { path: `src/${id}.ts` }) {
      emit("tool_execution_start", { toolCallId: id, toolName: "read", args });
      emit("tool_execution_end", { toolCallId: id, toolName: "read", result: value, isError: value.isError });
      sessionManager.appendMessage({ role: "toolResult", toolCallId: id, toolName: "read", ...value, timestamp: 1 });
      return value;
    },
    dispose() { emit("session_shutdown"); },
  };
}

test("real limited Read excludes continuation notices from source counts and previews", async () => {
  const h = harness();
  const root = join(process.cwd(), ".tmp"); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "read-test-"));
  try {
    writeFileSync(join(dir, "sample.txt"), "one\ntwo\nthree\nfour\nfive\nsix");
    const args = { path: "sample.txt", offset: 2, limit: 2 };
    const actual = await h.tools.get("read")!.execute("limited", args, undefined, undefined, { cwd: dir } as never);
    assert.match(actual.content[0]!.type === "text" ? actual.content[0]!.text : "", /Use offset=4/u);
    const row = h.row("limited", args); row.setArgsComplete();
    row.updateResult({ ...actual, isError: false });
    const text = plain(row);
    assert.match(text, /L2–3 · 2 lines/u);
    assert.match(text, /2  two\n.*3  three/u);
    assert.doesNotMatch(text, /4  \[|4  $/mu);
    assert.match(text, /3 more lines in file.*offset=4/u);
  } finally { h.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("real truncation reports only returned source lines and preserves oversized-line warnings", async () => {
  const h = harness();
  const root = join(process.cwd(), ".tmp"); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "read-test-"));
  try {
    for (const [name, content] of [["many.txt", "line\n".repeat(2100)], ["token.txt", "x".repeat(60 * 1024)]]) {
      writeFileSync(join(dir, name!), content!);
      const args = { path: name! };
      const actual = await h.tools.get("read")!.execute(name!, args, undefined, undefined, { cwd: dir } as never);
      const row = h.row(name!, args); row.updateResult({ ...actual, isError: false });
      const text = plain(row);
      if (name === "many.txt") {
        assert.match(text, /2000 lines · truncated/u);
        assert.match(text, /1997 more lines/u);
        assert.match(text, /offset=2001/u);
      } else {
        assert.match(text, /0 lines · truncated/u);
        assert.match(text, /exceeds 50\.0KB limit/u);
        assert.doesNotMatch(text, /│\s+1/u);
      }
    }
  } finally { h.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("image results keep their own host row so attachments remain next to their filename", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("image"), call("c")]);
    const a = h.row("a"); const image = h.row("image"); const c = h.row("c");
    a.updateResult(result("alpha")); c.updateResult(result("gamma"));
    image.updateResult({ content: [{ type: "image", data: "", mimeType: "image/png" }], isError: false });
    assert.match(plain(image), /image.ts.*Image loaded/u);
    assert.match(plain(a), /a.ts/u); assert.doesNotMatch(plain(a), /image.ts|c.ts/u);
    assert.match(plain(c), /c.ts/u);
  } finally { h.dispose(); }
});

test("text, thinking, other tools, missing rows and assistant boundaries break Read groups", () => {
  for (const separator of [{ type: "text", text: "between" }, { type: "thinking", thinking: "between" }, call("bash", { path: "unused" }, "bash"), call("unbound")]) {
    const h = harness();
    try {
      h.declare([call("a"), separator, call("b")]);
      const a = h.row("a"); const b = h.row("b");
      a.updateResult(h.publish("a", result("alpha"))); b.updateResult(h.publish("b", result("beta")));
      assert.match(plain(a), /Read a.ts/u); assert.match(plain(b), /Read b.ts/u);
      assert.doesNotMatch(plain(a), /files/u);
      h.declare([call("c")]); const c = h.row("c");
      c.updateResult(h.publish("c", result("gamma")));
      assert.match(plain(c), /Read c.ts/u);
    } finally { h.dispose(); }
  }
});

test("streaming membership and repeated file ranges retain separate members without false counts", () => {
  const h = harness();
  try {
    h.declare([call("a")]); const a = h.row("a", {});
    assert.doesNotMatch(plain(a), /✓|\d+ lines/u);
    h.emit("message_update", { message: message([call("a"), call("b")]) });
    const b = h.row("b", { path: "src/same.ts", offset: 20, limit: 3 });
    a.updateArgs({ path: "src/same.ts", offset: 1, limit: 2 });
    a.updateResult(h.publish("a", result("first\nsecond"), { path: "src/same.ts", offset: 1, limit: 2 }));
    b.updateResult(h.publish("b", result("twenty"), { path: "src/same.ts", offset: 20, limit: 3 }));
    const text = plain(a);
    assert.equal(text.split("same.ts").length - 1, 2);
    assert.match(text, /L1–2 · 2 lines/u); assert.match(text, /L20–20 · 1 line/u);
    h.emit("message_update", { message: message([call("a"), { type: "text", text: "barrier" }, call("b")]) });
    assert.doesNotMatch(plain(a), /files|twenty/u); assert.match(plain(b), /twenty/u);
    const orphan = h.row("orphan"); assert.match(plain(orphan), /orphan.ts/u);
    // Another view of one source occurrence is not a duplicated source call.
    const replacement = h.row("a"); assert.match(plain(replacement), /Read same.ts/u);
    assert.match(plain(replacement), /first/u);
  } finally { h.dispose(); }
});

test("reload preserves fresh rows and tree or compaction rebuild only the active branch", () => {
  const h = harness(false);
  try {
    const entry = h.sessionManager.appendMessage(message([call("a"), call("b")]) as never);
    const a = h.row("a"); const b = h.row("b");
    a.updateResult(h.publish("a", result("alpha"))); b.updateResult(h.publish("b", result("beta")));
    h.emit("session_start");
    assert.match(plain(a), /Read 2 files/u); assert.equal(b.render(120).length, 0);
    for (const event of ["session_tree", "session_compact"]) {
      if (event === "session_compact") h.sessionManager.appendCompaction("summary", entry, 100);
      h.emit(event);
      const restoredA = h.row("a"); const restoredB = h.row("b");
      restoredA.updateResult(result("fresh-alpha")); restoredB.updateResult(result("fresh-beta"));
      assert.match(plain(restoredA), /Read 2 files/u); assert.equal(restoredB.render(120).length, 0);
      a.updateArgs({ path: "stale.ts" }); a.updateResult(result("stale"));
      assert.doesNotMatch(plain(restoredA), /stale/u);
    }
    h.sessionManager.resetLeaf(); h.emit("session_tree");
    assert.doesNotMatch(plain(h.row("a")), /files/u);
    h.dispose();
    assert.equal(h.cache.stats().layouts.chargedBytes, 0);
    assert.equal(h.cache.stats().counts.chargedBytes, 0);
  } finally { h.dispose(); }
});

test("unchanged content reuses extraction and counts across redraw, resize, theme and sibling updates", () => {
  const cache = new ToolRenderCache();
  const computes: string[] = [];
  const original = cache.scope.bind(cache);
  cache.scope = () => {
    const scope = original();
    return { ...scope, get active() { return scope.active; },
      lines: (key, compute) => scope.lines(key, () => { computes.push(key); return compute(); }),
      count: (key, compute) => scope.count(key, () => { computes.push(key); return compute(); }) };
  };
  const h = harness(true, cache);
  try {
    h.declare([call("a"), call("b"), call("c")]); const a = h.row("a"); const b = h.row("b"); const c = h.row("c");
    a.updateResult(h.publish("a", result("alpha\n".repeat(2000)))); b.updateResult(h.publish("b", result("beta\n".repeat(1000))));
    plain(a);
    const first = computes.filter(key => key.startsWith("read-source"));
    assert.equal(first.length, 6);
    assert(!first.some(key => key.endsWith("prefix\0true")));
    for (const width of [120, 120, 30, 80, 120]) { a.invalidate(); plain(a, width); }
    initTheme("light", false); a.invalidate(); plain(a);
    assert.deepEqual(computes.filter(key => key.startsWith("read-source")), first);
    c.updateResult(h.publish("c", result("changed"))); plain(a);
    assert.equal(computes.filter(key => key.startsWith("read-source")).length, first.length + 3);
    a.setExpanded(true); b.setExpanded(true); assert.match(plain(a), /40  alpha/u);
    a.setExpanded(false); b.setExpanded(false); assert.doesNotMatch(plain(a), /40  alpha/u);
    const stats = cache.stats();
    assert(stats.layouts.chargedBytes <= stats.layouts.limitBytes);
    assert(stats.counts.chargedBytes <= stats.counts.limitBytes);
  } finally { h.dispose(); initTheme("dark", false); }
});

test("long previews stay within three screen rows and full paths survive narrow expansion", () => {
  const h = harness();
  try {
    const path = "directory/".repeat(10) + "中文.ts";
    const row = h.row("long", { path });
    row.updateResult(result(("中文👩‍💻é\t\x1b[31m".repeat(200) + "\n").repeat(5)));
    for (const width of [1, 2, 3, 4, 8, 16, 30, 80, 120, 160]) {
      const lines = row.render(width);
      assert.equal(lines.length, 6);
      assert(lines.every(line => visibleWidth(line) <= width));
    }
    assert.deepEqual(row.render(0), []);
    row.setExpanded(true);
    const expanded = plain(row, 30);
    const pathLines = expanded.split("\n").slice(2, 2 + Math.ceil(visibleWidth(path) / 26));
    assert.equal(pathLines.map(line => line.slice(4)).join(""), path);
    row.setExpanded(false); assert.equal(row.render(30).length, 6);
  } finally { h.dispose(); }
});

test("limited Read preserves selected blank lines and empty files do not invent lines", () => {
  const h = harness();
  try {
    const row = h.row("blank", { path: "blank.txt", limit: 2 });
    row.updateResult(result("one\n\n\n[3 more lines in file. Use offset=3 to continue.]"));
    assert.match(plain(row), /1  one\n.*│\s+2\n/u);
    assert.doesNotMatch(plain(row), /1 more lines/u);
    const empty = h.row("empty"); empty.updateResult(result(""));
    assert.match(plain(empty), /0 lines/u); assert.equal(empty.render(120).length, 2);
    empty.updateResult(result("Operation aborted", true));
    assert.match(plain(empty), /Interrupted\n.*Operation aborted/u);
    assert.doesNotMatch(plain(empty), /✓|0 lines/u);
  } finally { h.dispose(); }
});

test("consecutive Read calls share one row and keep source order under out-of-order results", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b"), call("c")]);
    const rows = [h.row("a"), h.row("b"), h.row("c")];
    rows.forEach(row => { row.setArgsComplete(); row.markExecutionStarted(); });
    rows[2]!.updateResult(h.publish("c", result("c-first\nc-second\nc-third\nc-fourth")));
    rows[0]!.updateResult(h.publish("a", result("a-first")));
    rows[1]!.updateResult(h.publish("b", result("Permission denied\nstack", true)));
    const text = plain(rows[0]!);
    assert.match(text, /Read 3 files/u);
    assert(text.indexOf("a.ts") < text.indexOf("b.ts"));
    assert(text.indexOf("b.ts") < text.indexOf("c.ts"));
    assert.match(text, /a-first/u);
    assert.match(text, /Permission denied/u);
    assert.match(text, /c-third/u);
    assert.doesNotMatch(text, /c-fourth|stack/u);
    assert.match(text, /1 more lines/u);
    assert.equal(rows[1]!.render(120).length, 0);
    assert.equal(rows[2]!.render(120).length, 0);
  } finally { h.dispose(); }
});
