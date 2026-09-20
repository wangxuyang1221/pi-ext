import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { initTheme, ToolExecutionComponent, sessionEntryToContextMessages, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../src/tools.js";
import { ToolRenderCache } from "../src/render-cache.js";

function setup(cache = new ToolRenderCache(), start = true) {
  initTheme("dark", false);
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Array<(event: any, ctx?: any) => void>>();
  const entries: any[] = [];
  const scan = vi.fn(() => entries);
  const emit = (type: string, event = {}) => {
    for (const handler of handlers.get(type) ?? []) handler({ type, ...event }, { mode: "tui", cwd: process.cwd(), sessionManager: { buildContextEntries: scan } });
  };
  registerCodexTools({ registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    on(type: string, handler: (event: any, ctx?: any) => void) {
      const list = handlers.get(type) ?? []; list.push(handler); handlers.set(type, list);
    } } as unknown as ExtensionAPI, undefined, { renderCache: cache, getKeybindings: () => ({ getKeys: () => ["ctrl+o"] }) });
  if (start) emit("session_start");
  const rows = new Map<string, ToolExecutionComponent>();
  return {
    cache, emit, entries, scan,
    declare(content: any[], start = false) { emit(start ? "message_start" : "message_update", { message: { role: "assistant", content } }); },
    row(id: string) {
      const row = new ToolExecutionComponent("bash", id, { command: `printf ${id}` }, { showImages: false }, tools.get("bash"),
        { requestRender() {} } as never, process.cwd());
      row.setExpanded(true); rows.set(id, row); return row;
    },
    dispose: () => emit("session_shutdown"),
  };
}
const call = (id: string) => ({ type: "toolCall", id, name: "bash", arguments: { command: `printf ${id}` } });
const text = (row: ToolExecutionComponent, width = 120) => stripTerminalSequences(row.render(width).join("\n"));
const result = (text: string) => ({ content: [{ type: "text" as const, text }], isError: false });
afterEach(() => vi.useRealTimers());

for (const change of ["append", "replace-tail", "replace-prefix", "replace-all", "empty-final"] as const) {
  test(`output revisions support ${change} without reprocessing another member`, () => {
    const h = setup();
    try {
      h.declare([call("a"), call("b")]); const a = h.row("a"); const b = h.row("b");
      let reads = 0;
      a.updateResult({ content: [{ type: "text", get text() { reads++; return "stable marker"; } }], isError: false });
      b.markExecutionStarted(); b.updateResult(result("original prefix\noriginal tail"), true); text(a);
      const previous = reads;
      const output = change === "append" ? "original prefix\noriginal tail\nappended"
        : change === "replace-tail" ? "original prefix\nchanged tail"
        : change === "replace-prefix" ? "changed prefix\noriginal tail"
        : change === "replace-all" ? "replaced entirely" : "";
      b.updateResult(result(output), change !== "empty-final");
      const rendered = text(a);
      for (const line of output.split("\n")) if (line) assert.ok(rendered.includes(line));
      assert.equal(reads, previous);
      if (!output) assert.ok(rendered.includes("(No content)"));
    } finally { h.dispose(); }
  });
}

test("reload discovers already-created fresh rows before first session_start", () => {
  const h = setup(new ToolRenderCache(), false);
  try {
    h.entries.push({ type: "message", message: { role: "assistant", content: [call("a"), call("b")] } });
    const a = h.row("a"); const b = h.row("b");
    a.updateResult(result("first")); b.updateResult(result("second"));
    assert.match(text(b), /second/u);
    h.emit("session_start", { reason: "reload" });
    assert.equal(text(a).match(/⏺ Bash\(/gu)?.length, 2);
    assert.match(text(a), /second/u);
    assert.deepEqual(b.render(120), []);
    h.emit("session_shutdown");
    b.updateResult(result("stale"));
    assert.equal(h.cache.stats().layouts.chargedBytes, 0);
  } finally { h.dispose(); }
});

test("superseded snapshots are not cleaned before the next frame", () => {
  const h = setup();
  try {
    const row = h.row("a"); let reads = 0;
    for (let index = 0; index < 20; index++) row.updateResult({ content: [{ type: "text", get text() { reads++; return `${index}`; } }], isError: false });
    assert.equal(reads, 0);
    assert.match(text(row), /19/u);
    assert.equal(reads, 1);
  } finally { h.dispose(); }
});

test("warning-only revisions and return-to-width reuse captured output layouts", () => {
  const h = setup();
  try {
    const row = h.row("a"); let reads = 0;
    const content = [{ type: "text" as const, get text() { reads++; return "content\n".repeat(150); } }];
    row.updateResult({ content, isError: false });
    text(row, 120); text(row, 71); const previous = reads;
    row.updateResult({ content, isError: false, details: { truncation: { truncated: true }, fullOutputPath: "/known/file" } } as never);
    const rendered = text(row, 120);
    assert.match(rendered, /Truncated capture.*known\/file/u);
    assert.equal(reads, previous);
    row.setExpanded(false); text(row);
    const misses = h.cache.stats().layouts.misses;
    row.setExpanded(true); text(row, 120);
    assert.equal(h.cache.stats().layouts.misses, misses);
  } finally { h.dispose(); }
});

test("theme invalidation refreshes output styling without re-reading the capture", () => {
  const h = setup();
  try {
    const row = h.row("a"); let reads = 0;
    row.updateResult({ content: [{ type: "text", get text() { reads++; return "theme marker"; } }], isError: false });
    const before = row.render(120); const previous = reads;
    initTheme("light", false); row.invalidate(); const after = row.render(120);
    assert.notDeepEqual(after, before);
    assert.equal(stripTerminalSequences(after.join("\n")), stripTerminalSequences(before.join("\n")));
    assert.equal(reads, previous);
  } finally { h.dispose(); }
});

test("50 KiB command tokens wrap without truncating captured command text", () => {
  const h = setup();
  try {
    const row = h.row("a"); const command = "q".repeat(50 * 1024);
    row.updateArgs({ command }); row.markExecutionStarted();
    const rendered = text(row, 1);
    assert.equal(rendered.match(/q/gu)?.length, command.length);
    assert.ok(row.render(1).every(line => visibleWidth(line) <= 1));
  } finally { h.dispose(); }
});

test("stable frames and timer ticks never scan the session", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const h = setup();
  try {
    h.declare([call("a"), call("b")]); const a = h.row("a"); const b = h.row("b");
    a.markExecutionStarted(); b.markExecutionStarted();
    const scans = h.scan.mock.calls.length;
    for (let index = 0; index < 10; index++) { vi.advanceTimersByTime(1000); text(a); }
    assert.equal(h.scan.mock.calls.length, scans);
    a.updateResult(result("done")); b.updateResult(result("done"));
    assert.equal(vi.getTimerCount(), 0);
  } finally { h.dispose(); }
});

test("changing source separators reassigns already bound rows without swallowing a member", () => {
  const h = setup();
  try {
    h.declare([call("a"), call("b"), call("c")]);
    const a = h.row("a"); const b = h.row("b"); const c = h.row("c");
    [a, b, c].forEach(row => row.markExecutionStarted()); text(a);
    h.declare([call("a"), { type: "text", text: "break" }, call("b"), call("c")]);
    assert.match(text(a), /Bash\(printf a\)/u);
    assert.doesNotMatch(text(a), /printf b|printf c/u);
    assert.equal(text(b).match(/⏺ Bash\(/gu)?.length, 2);
    assert.equal(c.render(120).length, 0);
    h.declare([call("a"), call("b"), call("c")]);
    assert.equal(text(a).match(/⏺ Bash\(/gu)?.length, 3);
    assert.equal(b.render(120).length, 0);
  } finally { h.dispose(); }
});

test("missing leaders and duplicate IDs remain independently visible", () => {
  const h = setup();
  try {
    h.declare([call("a"), call("b")]); const b = h.row("b"); b.markExecutionStarted();
    assert.match(text(b), /printf b/u);
    const a = h.row("a"); a.markExecutionStarted(); assert.equal(text(a).match(/⏺ Bash\(/gu)?.length, 2);
    const duplicate = h.row("b"); duplicate.markExecutionStarted(); assert.match(text(duplicate), /printf b/u);
    assert.equal(b.render(120).length, 0);
  } finally { h.dispose(); }
});

test("duplicate IDs in source content never duplicate another component's capture", () => {
  const h = setup();
  try {
    h.declare([call("a"), call("b"), call("b"), call("c")]);
    const a = h.row("a"); const b = h.row("b"); const duplicate = h.row("b"); const c = h.row("c");
    a.updateResult(result("capture-a")); b.updateResult(result("capture-b-first"));
    duplicate.updateResult(result("capture-b-second")); c.updateResult(result("capture-c"));
    const rendered = [a, b, duplicate, c].map(row => text(row)).join("\n");
    for (const capture of ["capture-a", "capture-b-first", "capture-b-second", "capture-c"]) assert.equal(rendered.split(capture).length - 1, 1);
    assert(rendered.indexOf("capture-b-first") < rendered.indexOf("capture-b-second"));
    assert(rendered.indexOf("capture-b-second") < rendered.indexOf("capture-c"));
  } finally { h.dispose(); }
});

for (const lifecycle of ["session_start", "session_tree", "session_compact", "session_shutdown"]) {
  test(`${lifecycle} invalidates old callbacks and cache scopes before reusing call IDs`, () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const h = setup();
    try {
      const old = h.row("a"); old.markExecutionStarted(); old.updateResult(result("old"), true); text(old);
      h.emit(lifecycle);
      assert.equal(h.cache.stats().layouts.chargedBytes, 0);
      const current = h.row("a"); current.markExecutionStarted(); current.updateResult(result("new"), true);
      text(current); const stats = h.cache.stats().layouts.chargedBytes;
      old.updateResult(result("late old result")); old.invalidate(); text(old);
      assert.equal(h.cache.stats().layouts.chargedBytes, stats);
      assert.equal(vi.getTimerCount(), 0);
      assert.match(text(current), /new/u);
    } finally { h.dispose(); }
  });
}

test("recovery follows the host compaction projection instead of inventing hidden retained calls", () => {
  const h = setup();
  try {
    h.entries.push({ type: "compaction", id: "compaction", parentId: null, timestamp: "", summary: "summary", tokensBefore: 100,
      retainedTail: [{ role: "assistant", content: [call("kept-a"), call("kept-b")], timestamp: 0, stopReason: "toolUse" }] });
    h.emit("session_start");
    const a = h.row("kept-a"); const b = h.row("kept-b");
    a.updateResult(result("kept")); b.updateResult(result("kept-b"));
    const projectsTail = sessionEntryToContextMessages(h.entries[0]).some(message => message.role === "assistant");
    assert.equal(text(a).match(/⏺ Bash\(/gu)?.length, projectsTail ? 2 : 1);
    assert.equal(b.render(120).length === 0, projectsTail);
    assert.doesNotMatch(text(a), /\d+\.\d+s/u);
  } finally { h.dispose(); }
});
