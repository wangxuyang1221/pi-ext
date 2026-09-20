import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { initTheme, SessionManager, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../src/tools.js";
import { ReadGroups } from "../src/read-groups.js";
import { ToolRenderCache } from "../src/render-cache.js";

const call = (id: string) => ({ type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } });
const message = (content: unknown[]) => ({ role: "assistant", content });
const result = (text: string) => ({ content: [{ type: "text" as const, text }], isError: false });
const plain = (row: ToolExecutionComponent) => row.render(100).map(stripTerminalSequences).join("\n");
function harness() {
  initTheme("dark", false);
  const tools = new Map<string, ToolDefinition>(), handlers = new Map<string, Function[]>();
  const sessionManager = SessionManager.inMemory(process.cwd());
  const ctx = { mode: "tui", cwd: process.cwd(), sessionManager };
  const cache = new ToolRenderCache();
  registerCodexTools({ registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); }, on(type: string, handler: Function) {
    const listeners = handlers.get(type) ?? []; listeners.push(handler); handlers.set(type, listeners);
  } } as unknown as ExtensionAPI, undefined, { renderCache: cache });
  const emit = (type: string, extra = {}) => { for (const handler of handlers.get(type) ?? []) handler({ type, ...extra }, ctx); };
  emit("session_start");
  return { emit, sessionManager, cache,
    declare(ids: string[]) { emit("message_start", { message: message([]) }); emit("message_update", { message: message(ids.map(id => call(id))) }); },
    end(id: string, data = result(`content ${id}`)) { emit("tool_execution_end", { toolName: "read", toolCallId: id, result: data, isError: data.isError }); return data; },
    row(id: string) { return new ToolExecutionComponent("read", id, { path: `${id}.ts` }, { showImages: false }, tools.get("read"), { requestRender() {} } as never, process.cwd()); },
    close() { emit("session_shutdown"); },
  };
}

test("source events update same-width views before persistence and old callbacks cannot roll results back", () => {
  const h = harness(); const scans = vi.spyOn(h.sessionManager, "buildContextEntries");
  try {
    h.declare(["a", "b"]);
    const oldA = h.row("a"), oldB = h.row("b");
    h.emit("tool_execution_start", { toolName: "read", toolCallId: "a", args: call("a").arguments });
    h.emit("tool_execution_update", { toolName: "read", toolCallId: "b", args: call("b").arguments, partialResult: result("partial b") });
    assert.match(plain(oldA), /Read 2 files.*\n/su); assert.match(plain(oldA), /Reading/u);
    oldB.updateResult(h.end("b")); oldA.updateResult(h.end("a"));
    assert.match(plain(oldA), /content b/u);
    // No message has been persisted; reconstructed views must still use the event-owned facts.
    assert.equal(h.sessionManager.buildContextEntries().length, 0); scans.mockClear();
    for (let i = 0; i < 3; i++) {
      const a = h.row("a"), b = h.row("b");
      oldA.updateArgs({ path: "stale.ts" }); oldB.updateResult(result("stale data"), true);
      h.emit("tool_execution_update", { toolName: "read", toolCallId: "b", args: { path: "stale.ts" }, partialResult: result("late partial") });
      h.emit("message_update", { message: message([call("a"), call("b")]) });
      h.emit("message_end", { message: { role: "toolResult", toolName: "read", toolCallId: "b", ...result("content b") } });
      const text = plain(a);
      assert.match(text, /Read 2 files/u); assert.match(text, /content b/u);
      assert.doesNotMatch(text, /stale|partial|Reading/u); assert.deepEqual(b.render(100), []);
    }
    assert.equal(scans.mock.calls.length, 0);
  } finally { scans.mockRestore(); h.close(); }
});

test("result priority preserves final content, status and details without replay invalidations", () => {
  const groups = new ReadGroups(new ToolRenderCache());
  groups.discover(message([call("a"), call("b")]), true);
  const a = groups.bind({ state: {}, toolCallId: "a" } as never);
  const b = groups.bind({ state: {}, toolCallId: "b" } as never);
  groups.result("a", result("first partial"), "partial", false);
  groups.result("a", result("next partial"), "partial", false);
  assert.equal(groups.resolve(a).content?.[0]?.text, "next partial");
  groups.result("a", result("execution output"), "execution", false);
  assert.equal(groups.resolve(a).status, "completed");
  groups.result("a", result("late partial"), "partial", false);
  assert.equal(groups.resolve(a).content?.[0]?.text, "execution output");
  const final = { ...result("Operation aborted"), details: { marker: "final details" } };
  groups.result("a", final, "message", true);
  // A final message also works without a preceding execution event.
  groups.result("b", result("message only"), "message", false);
  const member = groups.resolve(a), revision = member.revision, version = member.group.version;
  assert.equal(member.content, final.content); assert.equal(member.details, final.details);
  assert.equal(member.status, "failed");
  for (let i = 0; i < 3; i++) {
    groups.result("a", structuredClone(final), "message", true);
    groups.result("a", result("late execution"), "execution", false);
    groups.result("a", result("late partial"), "partial", false);
    groups.start("a", { path: "late.ts" });
  }
  assert.equal(member.revision, revision); assert.equal(member.group.version, version);
  assert.equal(member.content, final.content); assert.equal(member.details, final.details);
  assert.equal(member.status, "failed"); assert.equal(member.path, "a.ts");
  assert.equal(groups.resolve(b).content?.[0]?.text, "message only");
});

test.each([[false, false], [true, false], [false, true], [true, true]])("final message reflows image=%s with shared content=%s", (initialImage, sharedContent) => {
  const h = harness();
  const scans = vi.spyOn(h.sessionManager, "buildContextEntries");
  try {
    h.declare(["a", "b", "c"]);
    const a = h.row("a"), b = h.row("b"), c = h.row("c");
    a.updateResult(h.end("a")); c.updateResult(h.end("c"));
    const image = { content: [{ type: "image" as const, mimeType: "image/png", data: "" }], isError: false };
    const initial = initialImage ? image : result("original middle");
    h.emit("tool_execution_end", { toolName: "read", toolCallId: "b", result: initial, isError: false });
    b.updateResult(initial);
    if (initialImage) assert.doesNotMatch(plain(a), /Read 3 files/u);
    else assert.match(plain(a), /Read 3 files/u);
    const revised = initialImage ? result("revised middle") : image;
    if (sharedContent) (initial.content as Array<{ type: string }>).splice(0, initial.content.length, ...revised.content);
    const final = sharedContent ? { ...initial } : revised;
    h.emit("message_end", { message: { role: "toolResult", toolName: "read", toolCallId: "b", ...final } });
    // Native message_end requests a paint without replaying the tool's renderer slots.
    if (initialImage) {
      assert.match(plain(a), /Read 3 files/u); assert.match(plain(a), /revised middle/u);
      assert.deepEqual(b.render(100), []); assert.deepEqual(c.render(100), []);
    } else {
      assert.doesNotMatch(plain(a), /Read 3 files|original middle|b.ts|c.ts/u);
      assert.match(plain(b), /b.ts.*Image loaded/u); assert.match(plain(c), /content c/u);
    }
    const painted = [a, b, c].map(plain);
    const stats = h.cache.stats();
    for (let i = 0; i < 3; i++) {
      h.emit("message_end", { message: { role: "toolResult", toolName: "read", toolCallId: "b", ...structuredClone(final) } });
      h.end("b", result("late execution"));
      h.emit("tool_execution_update", { toolName: "read", toolCallId: "b", args: { path: "late.ts" }, partialResult: result("late partial") });
      assert.deepEqual([a, b, c].map(plain), painted);
    }
    assert.equal(h.cache.stats().layouts.misses, stats.layouts.misses);
    assert.equal(h.cache.stats().counts.misses, stats.counts.misses);
    assert.equal(scans.mock.calls.length, 0);
  } finally { scans.mockRestore(); h.close(); }
});

test("final promotion refreshes in-place details once even when content and status are unchanged", () => {
  const h = harness();
  try {
    h.declare(["a"]);
    const a = h.row("a");
    const shared = { ...result("source"), details: { truncation: { truncated: false } } };
    h.emit("tool_execution_end", { toolName: "read", toolCallId: "a", result: shared, isError: false });
    a.updateResult(shared);
    assert.doesNotMatch(plain(a), /truncated/u);
    shared.details.truncation.truncated = true;
    const final = { role: "toolResult", toolName: "read", toolCallId: "a", ...shared };
    h.emit("message_end", { message: final });
    assert.match(plain(a), /truncated/u);
    const stats = h.cache.stats();
    for (let i = 0; i < 3; i++) {
      h.emit("message_end", { message: final });
      assert.match(plain(a), /truncated/u);
    }
    assert.equal(h.cache.stats().layouts.misses, stats.layouts.misses);
    assert.equal(h.cache.stats().counts.misses, stats.counts.misses);
  } finally { h.close(); }
});

test("hydrated results have final-message priority and reject late execution events", () => {
  const h = harness();
  try {
    h.sessionManager.appendMessage(message([call("a"), call("b")]) as never);
    for (const id of ["a", "b"]) h.sessionManager.appendMessage({ role: "toolResult", toolName: "read", toolCallId: id, ...result(`persisted ${id}`), timestamp: 1 });
    h.emit("session_tree");
    const a = h.row("a"), b = h.row("b");
    h.end("b", result("late execution"));
    assert.match(plain(a), /Read 2 files/u); assert.match(plain(a), /persisted b/u);
    assert.doesNotMatch(plain(a), /late execution/u); assert.deepEqual(b.render(100), []);
  } finally { h.close(); }
});

test("source duplicates stay local across messages while repeated snapshots and replacement views do not count as calls", () => {
  for (const later of [false, true]) {
    const h = harness();
    try {
      h.declare(["a", "b"]);
      const oldA = h.row("a"), oldB = h.row("b");
      oldA.updateResult(h.end("a", result("old a"))); oldB.updateResult(h.end("b", result("old b")));
      for (let i = 0; i < 3; i++) h.emit("message_update", { message: message([call("a"), call("b")]) });
      assert.match(plain(h.row("a")), /Read 2 files/u);
      if (later) h.declare(["a", "c"]);
      else h.emit("message_update", { message: message([call("a"), call("b"), { type: "text", text: "barrier" }, call("a"), call("c")]) });
      const newA = h.row("a"), c = h.row("c");
      newA.updateResult(h.end("a", result("new a"))); c.updateResult(h.end("c", result("new c")));
      assert.match(plain(oldA), /old a/u); assert.doesNotMatch(plain(oldA), /new a|old b/u);
      assert.match(plain(oldB), /old b/u); assert.match(plain(newA), /new a/u);
      assert.doesNotMatch(plain(newA), /old a|old b/u); assert.match(plain(c), /new c/u);
    } finally { h.close(); }
  }
});

test("unbound owners, unbound middle rows and missing results never hide neighboring content", () => {
  for (const missing of ["owner", "middle", "result"]) {
    const h = harness();
    try {
      h.declare(["a", "b", "c"]); h.end("a"); h.end("c");
      if (missing !== "result") h.end("b");
      const a = missing === "owner" ? undefined : h.row("a");
      const b = missing === "middle" ? undefined : h.row("b");
      const c = h.row("c");
      if (a) { assert.match(plain(a), /content a/u); assert.doesNotMatch(plain(a), /content c/u); }
      const remaining = [b, c].filter((row): row is ToolExecutionComponent => !!row).map(plain).join("\n");
      assert.match(remaining, /content c/u);
      if (missing !== "owner") assert.match(plain(c), /Read c.ts/u);
      const orphan = h.row("orphan"); orphan.updateResult(result("orphan content"));
      assert.match(plain(orphan), /orphan content/u);
    } finally { h.close(); }
  }
});

test("an image discovered at completion splits the logical group without moving attachments", () => {
  const h = harness();
  try {
    h.declare(["a", "image", "c"]);
    const a = h.row("a"), image = h.row("image"), c = h.row("c");
    for (const id of ["a", "image", "c"]) h.emit("tool_execution_start", { toolName: "read", toolCallId: id, args: call(id).arguments });
    assert.match(plain(a), /Read 3 files/u);
    a.updateResult(h.end("a")); c.updateResult(h.end("c"));
    const data = { content: [{ type: "image", mimeType: "image/png", data: "" }], isError: false };
    h.emit("tool_execution_end", { toolName: "read", toolCallId: "image", result: data, isError: false });
    image.updateResult(data);
    assert.match(plain(a), /Read a.ts/u); assert.doesNotMatch(plain(a), /image.ts|c.ts/u);
    assert.match(plain(image), /Image loaded/u); assert.match(plain(c), /Read c.ts/u);
  } finally { h.close(); }
});

test("projection changes isolate reused IDs and stale views cannot refill cleared caches", () => {
  for (const event of ["session_start", "session_tree", "session_compact"]) {
    const h = harness();
    const persist = (label: string) => {
      const entry = h.sessionManager.appendMessage(message([call("a"), call("b")]) as never);
      for (const id of ["a", "b"]) h.sessionManager.appendMessage({ role: "toolResult", toolName: "read", toolCallId: id, ...result(`${label} ${id}`), timestamp: 1 });
      return entry;
    };
    try {
      persist("old"); h.emit("session_tree");
      const oldA = h.row("a"), oldB = h.row("b");
      oldA.updateResult(result("old a")); oldB.updateResult(result("old b"));
      assert.match(plain(oldA), /Read 2 files/u);
      if (event !== "session_compact") h.sessionManager.resetLeaf();
      const kept = persist("current");
      if (event === "session_compact") h.sessionManager.appendCompaction("summary", kept, 100);
      h.emit(event);
      for (const old of [oldA, oldB]) {
        old.updateArgs({ path: "stale.ts" }); old.updateResult(result("stale result")); old.invalidate(); plain(old);
      }
      assert.equal(h.cache.stats().layouts.entries, 0);
      assert.equal(h.cache.stats().counts.entries, 0);
      const a = h.row("a"), b = h.row("b");
      assert.match(plain(a), /Read 2 files/u); assert.match(plain(a), /current b/u);
      assert.doesNotMatch(plain(a), /old|stale/u); assert.deepEqual(b.render(100), []);
      h.close(); a.invalidate(); plain(a);
      assert.equal(h.cache.stats().layouts.entries, 0);
      assert.equal(h.cache.stats().counts.entries, 0);
    } finally { h.close(); }
  }
});

test("one streaming update touches only its record and candidate regardless of history size", () => {
  for (const count of [100, 1000]) {
    const groups = new ReadGroups(new ToolRenderCache());
    const views = [];
    for (let i = 0; i < count; i += 2) {
      const ids = [`cost-${i}`, `cost-${i + 1}`];
      groups.discover(message(ids.map(call)), true);
      for (const id of ids) {
        groups.result(id, result("partial"), "partial", false);
        views.push(groups.bind({ state: {}, toolCallId: id } as never));
      }
    }
    for (const view of views) groups.resolve(view);
    const untouched = groups.resolve(views[0]!);
    const version = untouched.group.version;
    let lookups = 0;
    const get = Map.prototype.get;
    const spy = vi.spyOn(Map.prototype, "get").mockImplementation(function (this: Map<unknown, unknown>, key: unknown) {
      lookups++; return get.call(this, key);
    });
    try {
      groups.result(`cost-${count - 1}`, result("final"), "execution", false);
      assert.equal(groups.resolve(views[count - 2]!).group.members[1]!.status, "completed");
    } finally { spy.mockRestore(); }
    assert(lookups < 20, `Expected bounded single-record work, got ${lookups} lookups`);
    assert.equal(groups.resolve(views[0]!), untouched);
    assert.equal(untouched.group.version, version);
  }
});

test("bulk hydration and binding do not rescan an entire candidate for each record", () => {
  for (const count of [100, 1000]) {
    const groups = new ReadGroups(new ToolRenderCache());
    const blocks = Array.from({ length: count }, (_, i) => call(`cost-${i}`));
    let lookups = 0;
    const get = Map.prototype.get;
    const spy = vi.spyOn(Map.prototype, "get").mockImplementation(function (this: Map<unknown, unknown>, key: unknown) {
      lookups++; return get.call(this, key);
    });
    const views = [];
    try {
      groups.discover(message(blocks), true);
      for (const block of blocks) {
        groups.result(block.id, result(block.id), "execution", false);
        views.push(groups.bind({ state: {}, toolCallId: block.id } as never));
      }
      for (const view of views) groups.resolve(view);
    } finally { spy.mockRestore(); }
    assert(lookups < count * 40, `Expected linear bulk work, got ${lookups} lookups for ${count} records`);
    const first = groups.resolve(views[0]!);
    for (let i = 0; i < 10; i++) {
      const replacement = groups.bind({ state: {}, toolCallId: blocks[0]!.id } as never);
      assert.equal(groups.resolve(replacement), first);
    }
  }
});
