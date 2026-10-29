import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { initTheme, SessionManager, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../src/tools.js";
import { ToolRenderCache } from "../src/render-cache.js";
import { BashGroups } from "../src/bash-groups.js";

const plain = (row: ToolExecutionComponent, width = 120) => row.render(width).map(line => stripTerminalSequences(line).trimEnd());
const call = (id: string, name = "bash") => ({ type: "toolCall", id, name, arguments: { command: `printf ${id}`, path: "README.md" } });
const message = (content: unknown[]) => ({ role: "assistant", content, stopReason: "toolUse", timestamp: 0 });
const result = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });
function harness(services: Parameters<typeof registerCodexTools>[2] = {}) {
  initTheme("dark", false);
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Array<(event: any, ctx: any) => void>>();
  const sessionManager = SessionManager.inMemory(process.cwd());
  const emit = (type: string, event = {}) => {
    for (const handler of handlers.get(type) ?? []) handler({ type, ...event }, { mode: "tui", sessionManager });
  };
  registerCodexTools({
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    on(type: string, handler: (event: any, ctx: any) => void) {
      const listeners = handlers.get(type) ?? []; listeners.push(handler); handlers.set(type, listeners);
    },
  } as unknown as ExtensionAPI, undefined, services);
  emit("session_start");
  return {
    emit, sessionManager,
    declare(content: unknown[]) { emit("message_start", { message: message([]) }); emit("message_update", { message: message(content) }); },
    row(id: string, name = "bash", expanded = false) {
      const row = new ToolExecutionComponent(name, id, call(id, name).arguments, { showImages: false }, tools.get(name),
        { requestRender() {} } as never, process.cwd());
      row.setExpanded(expanded); return row;
    },
    dispose() { emit("session_shutdown"); },
  };
}
afterEach(() => vi.useRealTimers());

test("Bash preview hints follow injected bindings and disappear on expansion", () => {
  let keys: import("@earendil-works/pi-tui").KeyId[] = ["ctrl+shift+o"];
  const h = harness({ getKeybindings: () => ({ getKeys: () => keys }) });
  try {
    const a = h.row("a"); a.updateResult(result("body\nsecond\nthird\nfourth"));
    assert.match(plain(a).at(-1)!, /… \+1 lines \(ctrl\+shift\+o to expand\)$/u);
    assert.doesNotMatch(plain(a).at(-1)!, /expand.*expand/u);
    a.setExpanded(true);
    assert.doesNotMatch(plain(a).join("\n"), /to expand|collapse/u);
    assert(plain(a).includes("     fourth"));
    a.setExpanded(false); keys = ["ctrl+x", "ctrl+y"]; a.invalidate();
    assert.match(plain(a).at(-1)!, /ctrl\+x\/ctrl\+y to expand/u);
    keys = []; a.invalidate();
    assert.equal(plain(a).at(-1), "     … +1 lines");
  } finally { h.dispose(); }
});

test("consecutive Bash calls use one host row and preserve source order under out-of-order completion", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b"), call("c")]);
    const rows = [h.row("a"), h.row("b"), h.row("c")];
    rows.forEach(row => { row.setArgsComplete(); row.markExecutionStarted(); });
    rows[2]!.updateResult(result("c succeeded"));
    rows[0]!.updateResult(result("Error: harmless text"));
    rows[1]!.updateResult(result("AssertionError: actual failure\n  at test.ts:1\nmore", true));
    assert.equal(rows[1]!.render(120).length, 0);
    assert.equal(rows[2]!.render(120).length, 0);
    for (const expanded of [false, true]) {
      rows.forEach(row => row.setExpanded(expanded));
      const text = plain(rows[0]!).join("\n");
      assert(text.indexOf("Bash(printf a)") < text.indexOf("Bash(printf b)"));
      assert(text.indexOf("Bash(printf b)") < text.indexOf("Bash(printf c)"));
      for (const id of ["a", "b", "c"]) assert.equal(text.split(`Bash(printf ${id})`).length - 1, 1);
      for (const output of ["AssertionError", "harmless text", "c succeeded"]) assert(text.includes(output));
    }
  } finally { h.dispose(); }
});

test("source text, thinking, other tools and assistant messages break groups", () => {
  for (const separator of [{ type: "text", text: "between" }, { type: "thinking", thinking: "between" }, call("read", "read")]) {
    const h = harness();
    try {
      h.declare([call("a"), separator, call("b")]);
      const a = h.row("a"); const b = h.row("b");
      a.updateResult(result("")); b.updateResult(result(""));
      assert.match(plain(a).join("\n"), /Bash\(printf a\)/u);
      assert.doesNotMatch(plain(a).join("\n"), /printf b/u);
      assert.match(plain(b).join("\n"), /Bash\(printf b\)/u);
      h.declare([call("c")]); const c = h.row("c"); c.markExecutionStarted();
      assert.match(plain(c).join("\n"), /Bash\(printf c\)/u);
    } finally { h.dispose(); }
  }
});

test("repeated first IDs in separate Bash segments never reorder visible calls", () => {
  for (const separator of [{ type: "text", text: "between" }, { type: "thinking", thinking: "between" }, call("read", "read")]) {
    const h = harness();
    try {
      const content = [call("a"), call("b"), separator, call("a"), call("c")];
      h.declare(content);
      const rows = ["a", "b", "a", "c"].map(id => { const row = h.row(id); row.updateResult(result(`output ${id}`)); return row; });
      const order = () => rows.flatMap(row => plain(row)).join("\n").match(/Bash\(printf [abc]\)/gu);
      const expected = ["Bash(printf a)", "Bash(printf b)", "Bash(printf a)", "Bash(printf c)"];
      assert.deepEqual(order(), expected);
      h.emit("message_update", { message: message([...content, call("d")]) });
      const d = h.row("d"); d.updateResult(result("output d")); rows.push(d);
      assert.deepEqual(order(), expected);
      assert.doesNotMatch(plain(rows[0]!).join("\n"), /printf [cd]/u);
      assert.match(plain(rows[2]!).join("\n"), /printf a/u);
    } finally { h.dispose(); }
  }
});

test("IDs reused by a later assistant message cannot take ownership of earlier rows", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b")]);
    const a = h.row("a"), b = h.row("b");
    a.updateResult(result("old a")); b.updateResult(result("old b"));
    const before = plain(a);
    h.declare([call("a"), call("c")]);
    const duplicate = h.row("a"), c = h.row("c");
    duplicate.updateResult(result("new a")); c.updateResult(result("new c"));
    assert.deepEqual(plain(a), before);
    assert.equal(b.render(120).length, 0);
    assert.match(plain(duplicate).join("\n"), /new a/u);
    assert.match(plain(c).join("\n"), /new c/u);
    assert.doesNotMatch(plain(a).join("\n"), /new [ac]/u);
  } finally { h.dispose(); }
});

test("duplicate rows cannot claim historical unbound candidate slots", () => {
  for (const barrier of [
    undefined, { type: "text", text: "between" }, { type: "thinking", thinking: "between" }, call("other", "read"),
  ]) {
    const h = harness();
    try {
      h.declare([call("a"), call("b")]);
      const oldB = h.row("b"); oldB.updateResult(result("old b"));
      const beforeB = plain(oldB);
      assert(beforeB.join("\n").includes("old b"));
      const prefix = barrier ? [call("a"), call("b"), barrier] : [];
      if (barrier) h.emit("message_update", { message: message([...prefix, call("a"), call("c")]) });
      else h.declare([call("a"), call("c")]);
      const newA = h.row("a"), c = h.row("c");
      newA.updateResult(result("new a")); c.updateResult(result("new c"));
      for (const expanded of [false, true, false]) {
        newA.setExpanded(expanded); c.setExpanded(expanded);
        assert.deepEqual(plain(oldB), beforeB);
        assert.doesNotMatch(plain(newA).join("\n"), /old b|printf b/u);
        assert.match(plain(newA).join("\n"), /new a/u);
      }
      h.emit("message_update", { message: message([...prefix, call("a"), call("c"), call("d")]) });
      const d = h.row("d"); d.updateResult(result("new d"));
      assert.deepEqual(plain(oldB), beforeB);
      assert.deepEqual([oldB, newA, c, d].flatMap(row => plain(row)).join("\n").match(/old b|new [acd]/gu),
        ["old b", "new a", "new c", "new d"]);
      h.emit("session_start"); h.declare([call("a"), call("b")]);
      const freshA = h.row("a"), freshB = h.row("b");
      freshA.updateResult(result("fresh a")); freshB.updateResult(result("fresh b"));
      assert.match(plain(freshA).join("\n"), /fresh b/u);
      assert.deepEqual(plain(freshB), []);
    } finally { h.dispose(); }
  }
});

test("streaming discovery does not rescan every candidate for each retained ID", () => {
  for (const count of [100, 1000]) {
    const groups = new BashGroups(new ToolRenderCache());
    const blocks = Array.from({ length: count }, (_, i) => call(`cost-${i}`));
    groups.discover(message(blocks), true);
    let scanned = 0;
    const includes = Array.prototype.includes;
    const spy = vi.spyOn(Array.prototype, "includes").mockImplementation(function (this: unknown[], ...args) {
      if (typeof this[0] === "string" && this[0].startsWith("cost-")) scanned += this.length;
      return includes.apply(this, args);
    });
    try { groups.discover(message([...blocks, call("cost-next")])); }
    finally { spy.mockRestore(); }
    assert(scanned <= count * 4, "Retained membership must not use a nested candidate scan");
  }
});

test("ambiguous bindings do not scan retained history or acquire its unbound slots", () => {
  for (const count of [100, 1000]) {
    const groups = new BashGroups(new ToolRenderCache());
    for (let i = 0; i < count; i++) groups.discover(message([call(`ambiguous-${i}`), call(`neighbor-${i}`)]), true);
    groups.discover(message(Array.from({ length: count }, (_, i) => call(`ambiguous-${i}`))), true);
    let visited = 0;
    const values = Map.prototype.values;
    const spy = vi.spyOn(Map.prototype, "values").mockImplementation(function (this: Map<unknown, unknown>) {
      const iterator = values.call(this), next = iterator.next.bind(iterator);
      iterator.next = () => { const item = next(); if (!item.done) visited++; return item; };
      return iterator;
    });
    try {
      for (let i = 0; i < count; i++) {
        const ctx = { toolCallId: `ambiguous-${i}`, state: {} } as never;
        const member = groups.bind(ctx);
        assert.deepEqual(member.group.members, [member]);
        assert.equal(groups.bind(ctx), member);
      }
    } finally { spy.mockRestore(); }
    assert(visited <= count * 2, "Binding duplicate rows must not scan all historical members");
    groups.reset();
    groups.discover(message([call("ambiguous-0"), call("neighbor-0")]), true);
    const a = groups.bind({ toolCallId: "ambiguous-0", state: {} } as never);
    const b = groups.bind({ toolCallId: "neighbor-0", state: {} } as never);
    assert.equal(a.group, b.group);
  }
});

test("streaming membership and arguments refresh the first row without losing unknown calls", () => {
  const h = harness();
  try {
    h.declare([call("a")]); const a = h.row("a", "bash", true);
    h.emit("message_update", { message: message([call("a"), call("b")]) });
    const b = h.row("b", "bash", true); b.updateArgs({ command: "printf updated" });
    assert.deepEqual(plain(a), []);
    a.markExecutionStarted(); b.markExecutionStarted();
    assert.equal(plain(a).join("\n").match(/\$ Bash\(/gu)?.length, 2);
    assert.match(plain(a).join("\n"), /printf updated/u);
    assert.equal(b.render(120).length, 0);
    const orphan = h.row("unknown"); orphan.markExecutionStarted();
    assert.match(plain(orphan).join("\n"), /printf unknown/u);
  } finally { h.dispose(); }
});

test("all-success collapse keeps commands visible and expansion preserves raw blank lines", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b")]); const a = h.row("a"); const b = h.row("b");
    a.updateResult(result("first\n\nthird\n")); b.updateResult(result(""));
    const collapsed = plain(a);
    for (const text of ["printf a", "printf b", "first", "third", "… +1 lines"]) assert(collapsed.join("\n").includes(text));
    [a, b].forEach(row => row.setExpanded(true));
    const lines = plain(a);
    assert.deepEqual(lines.slice(2, 6), ["  ⎿  first", "", "     third", ""]);
    assert.equal(lines[6], "");
    assert.equal(lines.at(-1), "  ⎿  (No content)");
    [a, b].forEach(row => row.setExpanded(false));
    assert.deepEqual(plain(a), collapsed);
  } finally { h.dispose(); }
});

test("Bash aligns with real Read and Edited labels", () => {
  const h = harness();
  try {
    const a = h.row("a"); a.updateResult(result(""));
    const column = plain(a).find(line => line.includes("Bash"))!.indexOf("Bash");
    assert.equal(column, 2);
    for (const [name, label] of [["read", "Read"], ["edit", "Edited"]]) {
      const row = h.row(`reference-${name}`, name); row.updateResult(result("fixture")); row.setArgsComplete();
      assert.equal(plain(row).find(line => line.includes(label!))!.indexOf(label!), column);
    }
  } finally { h.dispose(); }
});

test("pending captures stay unread while running, successful and failed captures are previewed", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b"), call("c"), call("d")]);
    const rows = ["a", "b", "c", "d"].map(id => h.row(id)); rows[1]!.markExecutionStarted();
    const reads = [0, 0, 0, 0];
    rows.forEach((row, index) => row.updateResult({ content: [{ type: "text", get text(): string { reads[index]!++; return `capture-${index}`; } }], isError: index === 3 }, index < 2));
    const lines = plain(rows[0]!);
    assert.equal(reads[0], 0); assert.doesNotMatch(lines.join("\n"), /printf a|capture-0/u);
    for (const id of ["b", "c", "d"]) assert(lines.some(line => line.includes(`printf ${id}`)));
    for (const index of [1, 2, 3]) assert(lines.some(line => line.includes(`capture-${index}`)));
  } finally { h.dispose(); }
});

test("collapsed commands fit one line and expansion restores the full multiline command", () => {
  const h = harness();
  try {
    const row = h.row("a"); row.updateArgs({ command: "alpha\n  beta " + "long-command-".repeat(12) + " END-MARKER" }); row.updateResult(result("CAPTURE"));
    for (const width of [24, 48, 120, 300]) {
      row.setExpanded(false); const command = plain(row, width)[1]!;
      if (width < 200) assert.match(command, /…\)$/u);
      assert(visibleWidth(command) <= width); assert.doesNotMatch(command, /CAPTURE/u);
      row.setExpanded(true);
      assert.match(plain(row, width).join("\n"), /END-MARKER/u);
      assert.match(plain(row, width).join("\n"), /CAPTURE/u);
      row.setExpanded(false); assert.equal(plain(row, width)[1], command);
    }
  } finally { h.dispose(); }
});

test("collapsed command limits use available display columns including the ellipsis", () => {
  const h = harness();
  try {
    const row = h.row("a"); row.updateResult(result(""));
    for (const command of ["x".repeat(119), "x".repeat(292), "x".repeat(293), "中文👩‍💻é".repeat(40)]) {
      row.updateArgs({ command }); const preview = plain(row, 300)[1]!.slice(7, -1);
      assert(visibleWidth(preview) <= 292);
      if (visibleWidth(command) <= 292) assert.equal(preview, command); else assert.match(preview, /…$/u);
      for (const width of [1, 2, 4, 9, 10, 30, 71]) {
        assert.equal(row.render(width).length, 3);
        assert(row.render(width).every(line => visibleWidth(line) <= width));
      }
    }
    row.updateArgs({ command: "alpha\nbeta" }); assert.match(plain(row, 300)[1]!, /alpha beta/u);
    const pending = h.row("pending"); pending.updateArgs({ command: "x".repeat(200) });
    assert.deepEqual(plain(pending), []); pending.markExecutionStarted(); assert.match(plain(pending)[1]!, /…\)$/u);
  } finally { h.dispose(); }
});

test("running Bash creates no clock timers or time-driven output changes", () => {
  vi.useFakeTimers(); vi.setSystemTime(0); const h = harness();
  try {
    h.declare([call("a"), call("b")]); const a = h.row("a", "bash", true); const b = h.row("b", "bash", true);
    [a, b].forEach(row => { row.setArgsComplete(); row.markExecutionStarted(); });
    let reads = 0;
    a.updateResult({ content: [{ type: "text", get text() { reads++; return "unchanged\n".repeat(100); } }], isError: false }, true);
    b.updateResult(result("latest\n".repeat(100)), true); const before = plain(a); const beforeReads = reads;
    vi.advanceTimersByTime(1000); assert.deepEqual(plain(a), before); assert.equal(reads, beforeReads);
    b.updateResult(result("changed"), true); plain(a); assert.equal(reads, beforeReads);
    assert.equal(vi.getTimerCount(), 0);
    a.updateResult(result("done")); b.updateResult(result("done")); assert.equal(vi.getTimerCount(), 0);
    assert.match(plain(a).join("\n"), /Bash\(printf b\)/u);
  } finally { h.dispose(); }
});

test("recovery uses compacted branch entries, creates no timers and rejects stale callbacks", () => {
  vi.useFakeTimers(); vi.setSystemTime(0); const h = harness();
  try {
    const aId = h.sessionManager.appendMessage(message([call("a"), call("b")]) as never); h.emit("session_start");
    const old = h.row("a", "bash", true); const b = h.row("b", "bash", true); old.updateResult(result("restored"));
    assert.match(plain(old).join("\n"), /Bash\(printf a\)/u); assert.doesNotMatch(plain(old).join("\n"), /printf b|\d+\.\d+s/u);
    assert.equal(vi.getTimerCount(), 0);
    h.sessionManager.branch(aId); h.sessionManager.appendCompaction("summary", aId, 100, undefined, true); h.emit("session_compact");
    const current = h.row("a", "bash", true); h.row("b"); current.setArgsComplete(); current.markExecutionStarted();
    old.markExecutionStarted(); old.invalidate(); b.invalidate(); assert.equal(vi.getTimerCount(), 0);
    h.emit("session_shutdown"); old.invalidate(); current.invalidate(); assert.equal(vi.getTimerCount(), 0);
  } finally { h.dispose(); }
});

test("captured output, truncation warnings and custom key hints remain visible and width-safe", () => {
  const h = harness({ getKeybindings: () => ({ getKeys: () => ["ctrl+x"] }) });
  try {
    h.declare([call("a")]); const a = h.row("a", "bash", true); a.updateArgs({ command: "printf 中文👩‍💻é\nsecond" });
    const output = "\x1b]52;c;bad\x07\x1b[31m中文👩‍💻é\x1b[0m\r\t\n" + "x".repeat(50 * 1024);
    a.updateResult({ ...result(output), details: { truncation: { truncated: true }, fullOutputPath: "/real/output.txt" } } as never);
    const lines = plain(a); assert.doesNotMatch(lines.join("\n"), /to expand|collapse/u);
    assert.match(lines.join("\n"), /Truncated capture.*\/real\/output.txt/u); assert(lines.join("").match(/x/gu)!.length >= 50 * 1024);
    for (const width of [0, NaN, 1, 2, 4, 9, 10, 30, 71, 72, 119, 120, 121, 300]) {
      const rendered = a.render(width); assert(rendered.every(line => visibleWidth(line) <= width)); assert(rendered.every(line => !line.includes("\x1b]52")));
    }
    a.setExpanded(false); assert.match(plain(a).join("\n"), /Truncated capture/u); assert.match(plain(a).join("\n"), /ctrl\+x to expand/u);
  } finally { h.dispose(); }
});

test("host errors preserve timeout and cancellation reasons without fabricating structured metadata", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b"), call("c")]); const a = h.row("a"); const b = h.row("b"); const c = h.row("c");
    a.updateResult(result("Error: this is successful output"));
    b.updateResult(result("Command timed out after 2 seconds\noriginal detail\nextra detail", true)); c.updateResult(result("Command cancelled", true));
    for (const expanded of [false, true]) {
      [a, b, c].forEach(row => row.setExpanded(expanded)); const rendered = plain(a).join("\n");
      assert.equal(rendered.match(/\$ Bash\(/gu)?.length, 3);
      for (const output of ["this is successful output", "Command timed out", "Command cancelled"]) assert(rendered.includes(output));
      assert.doesNotMatch(rendered, /Exit code|\d+\.\d+s/u);
    }
  } finally { h.dispose(); }
});

test("derived layouts obey the shared budget and clear on branch navigation", () => {
  const cache = new ToolRenderCache({ layoutBytes: 2048, countBytes: 512 }); const h = harness({ renderCache: cache });
  try {
    h.declare([call("a"), call("b")]); const a = h.row("a", "bash", true); const b = h.row("b");
    for (let revision = 0; revision < 24; revision++) {
      b.updateResult(result(`${revision}\n` + "long output\n".repeat(1000)));
      for (const width of [120, 71, 120]) assert(a.render(width).length > 1000);
      assert(cache.stats().layouts.chargedBytes <= 2048);
    }
    h.emit("session_tree"); assert.equal(cache.stats().layouts.chargedBytes, 0);
  } finally { h.dispose(); }
});
