import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { initTheme, SessionManager, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../src/tools.js";
import { ToolRenderCache } from "../src/render-cache.js";

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
  const rows: ToolExecutionComponent[] = [];
  return {
    emit, sessionManager, rows,
    declare(content: unknown[]) { emit("message_start", { message: message([]) }); emit("message_update", { message: message(content) }); },
    row(id: string, name = "bash", expanded = false) {
      const row = new ToolExecutionComponent(name, id, call(id, name).arguments, { showImages: false }, tools.get(name),
        { requestRender() {} } as never, process.cwd());
      row.setExpanded(expanded); rows.push(row); return row;
    },
    dispose() { emit("session_shutdown"); },
  };
}
afterEach(() => vi.useRealTimers());

test("consecutive Bash calls use one host row and preserve source order under out-of-order completion", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b"), call("c")]);
    const rows = [h.row("a"), h.row("b"), h.row("c")];
    rows.forEach(row => { row.setArgsComplete(); row.markExecutionStarted(); });
    rows[2]!.updateResult(result("c succeeded"));
    rows[0]!.updateResult(result("Error: harmless text"));
    rows[1]!.updateResult(result("AssertionError: actual failure\n  at test.ts:1\nmore", true));
    assert.match(plain(rows[0]!).join("\n"), /3 commands.*2 succeeded.*1 failed/u);
    assert.equal(rows[1]!.render(120).length, 0);
    assert.equal(rows[2]!.render(120).length, 0);
    assert.equal(plain(rows[0]!).length, 5);
    for (const id of ["a", "b", "c"]) assert.match(plain(rows[0]!).join("\n"), new RegExp(`\\$ printf ${id}`, "u"));
    assert.doesNotMatch(plain(rows[0]!).join("\n"), /AssertionError|harmless text|c succeeded/u);
    rows.forEach(row => row.setExpanded(true));
    const text = plain(rows[0]!).join("\n");
    assert.ok(text.indexOf("$ printf a") < text.indexOf("$ printf b"));
    assert.ok(text.indexOf("$ printf b") < text.indexOf("$ printf c"));
    for (const id of ["a", "b", "c"]) assert.equal(text.split(`$ printf ${id}`).length - 1, 1);
  } finally { h.dispose(); }
});

test("source text, thinking, other tools and assistant messages break groups", () => {
  for (const separator of [{ type: "text", text: "between" }, { type: "thinking", thinking: "between" }, call("read", "read")]) {
    const h = harness();
    try {
      h.declare([call("a"), separator, call("b")]);
      const a = h.row("a"); const b = h.row("b");
      a.updateResult(result("")); b.updateResult(result(""));
      assert.match(plain(a).join("\n"), /1 commands.*1 succeeded/u);
      assert.match(plain(b).join("\n"), /1 commands.*1 succeeded/u);
      h.declare([call("c")]); const c = h.row("c");
      assert.match(plain(c).join("\n"), /1 commands/u);
    } finally { h.dispose(); }
  }
});

test("streaming membership and arguments refresh the first row without losing unknown calls", () => {
  const h = harness();
  try {
    h.declare([call("a")]); const a = h.row("a", "bash", true);
    h.emit("message_update", { message: message([call("a"), call("b")]) });
    const b = h.row("b", "bash", true);
    b.updateArgs({ command: "printf updated" });
    assert.match(plain(a).join("\n"), /2 commands/u);
    assert.match(plain(a).join("\n"), /printf updated/u);
    assert.equal(b.render(120).length, 0);
    const orphan = h.row("unknown");
    assert.match(plain(orphan).join("\n"), /printf unknown/u);
  } finally { h.dispose(); }
});

test("all-success collapse keeps commands visible and expansion preserves raw blank lines", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b")]); const a = h.row("a"); const b = h.row("b");
    a.updateResult(result("first\n\nthird\n")); b.updateResult(result(""));
    assert.equal(plain(a).length, 4);
    assert.match(plain(a).join("\n"), /printf a/u);
    assert.match(plain(a).join("\n"), /printf b/u);
    assert.doesNotMatch(plain(a).join("\n"), /first|third/u);
    [a, b].forEach(row => row.setExpanded(true));
    const lines = plain(a);
    assert.equal(lines[3], "  │     first");
    assert.equal(lines[4], "  │");
    assert.equal(lines[5], "  │     third");
    assert.equal(lines[6], "  │");
    assert.equal(lines[7], "  │");
    assert.equal(lines.at(-1), "        (no output)");
    [a, b].forEach(row => row.setExpanded(false));
    assert.equal(plain(a).length, 4);
  } finally { h.dispose(); }
});

test("Bash aligns with real Read and Edited labels", () => {
  const h = harness();
  try {
    const a = h.row("a"); a.updateResult(result(""));
    const column = plain(a).find(line => line.includes("Bash"))!.indexOf("Bash");
    assert.equal(column, 2);
    for (const [name, label] of [["read", "Read"], ["edit", "Edited"]]) {
      const row = h.row(`reference-${name}`, name);
      row.updateResult(result("fixture")); row.setArgsComplete();
      assert.equal(plain(row).find(line => line.includes(label!))!.indexOf(label!), column);
    }
  } finally { h.dispose(); }
});

test("collapsed captures are never read in pending, running, successful or failed states", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b"), call("c"), call("d")]);
    const rows = ["a", "b", "c", "d"].map(id => h.row(id));
    rows[1]!.markExecutionStarted();
    rows.forEach((row, index) => row.updateResult({ content: [{ type: "text", get text(): string { throw new Error("Collapsed output was read"); } }], isError: index === 3 }, index < 2));
    const lines = plain(rows[0]!);
    assert.equal(lines.length, 6);
    for (const id of ["a", "b", "c", "d"]) assert(lines.some(line => line.includes(`printf ${id}`)));
  } finally { h.dispose(); }
});

test("collapsed commands fit one line and expansion restores the full multiline command", () => {
  const h = harness();
  try {
    const row = h.row("a");
    row.updateArgs({ command: "alpha\n  beta " + "long-command-".repeat(12) + " END-MARKER" });
    row.updateResult(result("CAPTURE"));
    for (const width of [24, 48, 120, 300]) {
      row.setExpanded(false);
      const commands = plain(row, width).slice(2);
      assert.equal(commands.length, 1);
      assert.match(commands[0]!, /\.\.\.$/u);
      assert(visibleWidth(commands[0]!.slice(8)) <= Math.min(120, width - 8));
      assert.doesNotMatch(commands[0]!, /END-MARKER|CAPTURE/u);
      row.setExpanded(true);
      assert.match(plain(row, width).join("\n"), /END-MARKER/u);
      assert.match(plain(row, width).join("\n"), /CAPTURE/u);
      row.setExpanded(false);
      assert.deepEqual(plain(row, width).slice(2), commands);
    }
  } finally { h.dispose(); }
});

test("collapsed command limits count display columns including the three-dot suffix", () => {
  const h = harness();
  try {
    const row = h.row("a"); row.updateResult(result(""));
    for (const command of ["x".repeat(119), "x".repeat(120), "x".repeat(121), "中文👩‍💻é".repeat(40)]) {
      row.updateArgs({ command });
      const preview = plain(row, 300)[2]!.slice(8);
      assert(visibleWidth(preview) <= 120);
      if (visibleWidth(command) <= 120) assert.equal(preview, command);
      else assert.match(preview, /\.\.\.$/u);
      for (const width of [1, 2, 4, 9, 10, 30, 71]) {
        assert.equal(row.render(width).length, 3);
        assert(row.render(width).every(line => visibleWidth(line) <= width));
      }
    }
    row.updateArgs({ command: "alpha\nbeta" });
    assert.match(plain(row, 300)[2]!, /alpha beta/u);
    const pending = h.row("pending"); pending.updateArgs({ command: "x".repeat(200) });
    const line = plain(pending, 120)[2]!;
    assert.match(line, /\.\.\. +queued$/u);
    assert.equal(visibleWidth(line.slice(8).split(/ {3,}/u)[0]!), 120 - 8 - "queued".length - 3);
  } finally { h.dispose(); }
});

test("running clocks share one interval and refresh only the group bottom without processing unchanged output", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const h = harness();
  try {
    h.declare([call("a"), call("b")]); const a = h.row("a", "bash", true); const b = h.row("b", "bash", true);
    [a, b].forEach(row => { row.setArgsComplete(); row.markExecutionStarted(); });
    let reads = 0;
    a.updateResult({ content: [{ type: "text", get text() { reads++; return "unchanged\n".repeat(100); } }], isError: false }, true);
    b.updateResult(result("latest\n".repeat(100)), true);
    const before = plain(a); const beforeReads = reads;
    vi.advanceTimersByTime(1000);
    const after = plain(a);
    assert.deepEqual(after.slice(0, -1), before.slice(0, -1));
    assert.match(after.at(-1)!, /1: 1\.0s running.*2: 1\.0s running/u);
    assert.equal(reads, beforeReads);
    b.updateResult(result("changed"), true); plain(a);
    assert.equal(reads, beforeReads);
    assert.equal(vi.getTimerCount(), 1);
    a.updateResult(result("done")); b.updateResult(result("done"));
    assert.equal(vi.getTimerCount(), 0);
    assert.match(plain(a).join("\n"), /\$ printf b/u);
  } finally { h.dispose(); }
});

test("recovery uses compacted branch entries, creates no timers and rejects stale callbacks", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const h = harness();
  try {
    const aId = h.sessionManager.appendMessage(message([call("a"), call("b")]) as never);
    h.emit("session_start");
    const old = h.row("a", "bash", true); const b = h.row("b", "bash", true);
    old.updateResult(result("restored"));
    assert.match(plain(old).join("\n"), /2 commands.*1 succeeded.*1 queued/u);
    assert.doesNotMatch(plain(old).join("\n"), /\d+\.\d+s/u);
    assert.equal(vi.getTimerCount(), 0);
    h.sessionManager.branch(aId);
    h.sessionManager.appendCompaction("summary", aId, 100, undefined, true);
    h.emit("session_compact");
    const current = h.row("a", "bash", true); h.row("b");
    current.setArgsComplete(); current.markExecutionStarted();
    old.markExecutionStarted(); old.invalidate(); b.invalidate();
    assert.equal(vi.getTimerCount(), 1);
    h.emit("session_shutdown"); old.invalidate(); current.invalidate();
    assert.equal(vi.getTimerCount(), 0);
  } finally { h.dispose(); }
});

test("captured output, truncation warnings and custom key hints remain visible and width-safe", () => {
  const h = harness({ getKeybindings: () => ({ getKeys: () => ["ctrl+x"] }) });
  try {
    h.declare([call("a")]); const a = h.row("a", "bash", true);
    a.updateArgs({ command: "printf 中文👩‍💻é\nsecond" });
    const output = "\x1b]52;c;bad\x07\x1b[31m中文👩‍💻é\x1b[0m\r\t\n" + "x".repeat(50 * 1024);
    a.updateResult({ ...result(output), details: { truncation: { truncated: true }, fullOutputPath: "/real/output.txt" } } as never);
    const lines = plain(a);
    assert.match(lines.join("\n"), /ctrl\+x collapse/u);
    assert.match(lines.join("\n"), /Truncated capture.*\/real\/output.txt/u);
    assert.equal(lines.join("").match(/x/gu)!.length >= 50 * 1024, true);
    for (const width of [0, NaN, 1, 2, 4, 9, 10, 30, 71, 72, 119, 120, 121, 300]) {
      const rendered = a.render(width);
      assert.ok(rendered.every(line => visibleWidth(line) <= width));
      assert.ok(rendered.every(line => !line.includes("\x1b]52")));
    }
    a.setExpanded(false);
    assert.match(plain(a).join("\n"), /Truncated capture/u);
  } finally { h.dispose(); }
});

test("host errors preserve timeout and cancellation reasons without fabricating structured metadata", () => {
  const h = harness();
  try {
    h.declare([call("a"), call("b"), call("c")]);
    const a = h.row("a"); const b = h.row("b"); const c = h.row("c");
    a.updateResult(result("Error: this is successful output"));
    b.updateResult({ ...result("Command timed out after 2 seconds\noriginal detail\nextra detail"), isError: true });
    c.updateResult({ ...result("Command cancelled"), isError: true });
    const rendered = plain(a).join("\n");
    assert.match(rendered, /3 commands · 1 succeeded · 2 failed/u);
    assert.doesNotMatch(rendered, /this is successful output|Command timed out|Command cancelled|extra detail|exit code|\d+\.\d+s/u);
    [a, b, c].forEach(row => row.setExpanded(true));
    const expanded = plain(a).join("\n");
    assert.match(expanded, /Command timed out after 2 seconds/u);
    assert.match(expanded, /Command cancelled/u);
    assert.doesNotMatch(expanded, /exit code|\d+\.\d+s/u);
  } finally { h.dispose(); }
});

test("low-power rows keep their own bounded renderer and break full-mode grouping", () => {
  let lowPower = false;
  const h = harness({ isLowPowerEnabled: () => lowPower });
  try {
    h.declare([call("a"), call("b"), call("c")]);
    const a = h.row("a"); lowPower = true; const b = h.row("b"); lowPower = false; const c = h.row("c");
    a.updateResult(result("a")); b.updateResult(result("b")); c.updateResult(result("c"));
    assert.match(plain(a).join("\n"), /1 commands/u);
    assert.match(plain(b).join("\n"), /Bash completed/u);
    assert.match(plain(c).join("\n"), /1 commands/u);
  } finally { h.dispose(); }
});

test("derived layouts obey the shared budget and clear on branch navigation", () => {
  const cache = new ToolRenderCache({ layoutBytes: 2048, countBytes: 512 });
  const h = harness({ renderCache: cache });
  try {
    h.declare([call("a"), call("b")]); const a = h.row("a", "bash", true); const b = h.row("b");
    for (let revision = 0; revision < 24; revision++) {
      b.updateResult(result(`${revision}\n` + "long output\n".repeat(1000)));
      for (const width of [120, 71, 120]) assert.ok(a.render(width).length > 1000);
      assert.ok(cache.stats().layouts.chargedBytes <= 2048);
    }
    h.emit("session_tree");
    assert.equal(cache.stats().layouts.chargedBytes, 0);
  } finally { h.dispose(); }
});
