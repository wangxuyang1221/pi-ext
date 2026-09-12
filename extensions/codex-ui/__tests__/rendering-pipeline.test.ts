import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { TuiMainScreen, stripTerminalSequences, type Terminal } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../src/tools.js";

afterEach(() => vi.useRealTimers());

class CaptureTerminal {
  columns = 120;
  rows = 40;
  chunks: string[] = [];
  write(text: string) { this.chunks.push(text); }
  start() {}
  stop() {}
  async drainInput() {}
  hideCursor() {}
  showCursor() {}
  moveBy() {}
  clearLine() {}
  clearFromCursor() {}
  setTitle() {}
  take() {
    const text = this.chunks.join("");
    this.chunks = [];
    return text;
  }
}

function createPipeline(history: number, output = Array.from({ length: 1800 }, (_, index) => `output ${index}`).join("\n"), withResult = true, offscreenRunning = false, groupSize = 1) {
  initTheme("dark", false);
  mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), ".tmp/codex-ui-pipeline-"));
  const terminal = new CaptureTerminal();
  const screen = new TuiMainScreen(terminal as Terminal, false, directory);
  // Use explicit frames so timer callbacks are deterministic, without changing their cadence.
  screen.requestRender = () => {};
  screen.start();
  const tools: ToolDefinition[] = [];
  const handlers = new Map<string, Array<(event?: unknown, ctx?: unknown) => void>>();
  registerCodexTools({
    registerTool(tool: ToolDefinition) { tools.push(tool); },
    on(event: string, handler: (event?: unknown, ctx?: unknown) => void) {
      const callbacks = handlers.get(event) ?? [];
      callbacks.push(handler);
      handlers.set(event, callbacks);
    },
  } as unknown as ExtensionAPI, undefined, { getKeybindings: () => ({ getKeys: () => ["ctrl+o"] }) });
  let id = 0;
  const bash = () => new ToolExecutionComponent("bash", `bash-${id++}`, { command: "printf sample", timeout: 30 },
    { showImages: false }, tools.find(tool => tool.name === "bash"), screen, directory);
  const historyRows: ToolExecutionComponent[] = [];
  for (let index = 0; index < history; index++) {
    const row = bash();
    row.setExpanded(true);
    const running = offscreenRunning && index === 0;
    if (running) { row.setArgsComplete(); row.markExecutionStarted(); }
    row.updateResult({ content: [{ type: "text", text: "offscreen-history-marker\n".repeat(1800) }], isError: false }, running);
    screen.addChild(row); historyRows.push(row);
  }
  const message = { role: "assistant", content: Array.from({ length: groupSize }, (_, index) => ({
    type: "toolCall", id: `bash-${id + index}`, name: "bash", arguments: { command: "printf sample" },
  })) };
  for (const handler of handlers.get("message_start") ?? []) handler({ message }, { mode: "tui" });
  const rows = Array.from({ length: groupSize }, () => bash());
  let text = output;
  rows.forEach((row, index) => {
    row.setExpanded(true); row.setArgsComplete();
    const running = index === rows.length - 1;
    if (running) row.markExecutionStarted();
    if (withResult) row.updateResult({ content: [{ type: "text", text }], isError: false }, running);
    screen.addChild(row);
  });
  const row = rows[0]!;
  const active = rows.at(-1)!;
  screen.renderNow();
  terminal.take();
  return {
    row, rows, historyRows, screen, terminal,
    update(event: "append" | "replace-tail") {
      text = (event === "append" ? text : output) + "\nnext output";
      active.updateResult({ content: [{ type: "text", text }], isError: false }, true);
    },
    dispose() {
      for (const handler of handlers.get("session_shutdown") ?? []) handler();
      screen.stop();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("stable tail updates never resend offscreen history for short rows or long tokens", () => {
  vi.useFakeTimers();
  for (const output of ["short output\n".repeat(1800).trimEnd(), "x".repeat(50 * 1024)]) {
    for (const event of ["append", "replace-tail"] as const) for (const groupSize of [1, 3, 10]) {
      const writes: string[] = [];
      for (const history of [0, 20]) {
        vi.setSystemTime(0);
        const pipeline = createPipeline(history, output, true, false, groupSize);
        try {
          const before = pipeline.screen.fullRedraws;
          vi.advanceTimersByTime(100);
          pipeline.update(event);
          pipeline.screen.renderNow();
          const data = pipeline.terminal.take();
          writes.push(data);
          assert.equal(pipeline.screen.fullRedraws - before, 0);
          assert.doesNotMatch(data, /offscreen-history-marker|\x1b\[(?:2J|3J)/u);
          assert.match(stripTerminalSequences(pipeline.row.render(120).slice(-4).join("\n")), /next output\s*$/u);
        } finally { pipeline.dispose(); }
      }
      assert.equal(writes[1], writes[0]);
      console.log(JSON.stringify({ benchmark: "claude-bash-terminal", event, groupSize, kind: output.startsWith("x") ? "token" : "lines", history0Bytes: writes[0]!.length, history20Bytes: writes[1]!.length }));
    }
  }
});

test("an offscreen running tool reflects real prefix changes instead of freezing to avoid a redraw", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const pipeline = createPipeline(20, "current output\n".repeat(1800), true, true);
  try {
    const previous = pipeline.screen.fullRedraws;
    pipeline.historyRows[0]!.updateResult({ content: [{ type: "text", text: "changed-prefix\noffscreen-history-marker\n".repeat(1800) }], isError: false }, true);
    pipeline.screen.renderNow();
    assert.equal(pipeline.screen.fullRedraws - previous, 1);
    const data = pipeline.terminal.take();
    assert.match(data, /offscreen-history-marker/u);
    assert.match(stripTerminalSequences(data), /changed-prefix/u);
  } finally { pipeline.dispose(); }
});

test("expanded running state settles after an empty final result without resetting expansion", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const pipeline = createPipeline(0, "", false);
  const plain = () => stripTerminalSequences(pipeline.row.render(120).join("\n")).trimEnd();
  try {
    assert.match(plain(), /Running…$/u);
    vi.advanceTimersByTime(1000);
    pipeline.row.updateResult({ content: [], isError: false }, true);
    assert.match(plain(), /Running…$/u);
    assert.doesNotMatch(plain(), /\d+\.\d+s/u);
    vi.advanceTimersByTime(1000);
    pipeline.row.updateResult({ content: [], isError: false });
    const final = plain();
    assert.match(final, /Bash\(printf sample\)/u);
    assert.match(final, /\(No content\)/u);
    pipeline.row.updateResult({ content: [{ type: "text", text: "one\ntwo\nthree\nfour" }], isError: false });
    assert.match(plain(), /four/u);
    pipeline.row.updateResult({ content: [], isError: false });
    vi.advanceTimersByTime(5000);
    assert.equal(plain(), final);
    pipeline.row.setExpanded(false);
    assert.match(plain(), /\(No content\)/u);
    assert.equal(pipeline.row.render(120).length, 3);
    assert.match(plain(), /⏺ Bash\(/u);
  } finally { pipeline.dispose(); }
});

test("completion recolors the real offscreen command instead of freezing its running state", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const output = "same-output\n".repeat(1800);
  const pipeline = createPipeline(20, output);
  try {
    const previous = pipeline.screen.fullRedraws;
    const before = pipeline.row.render(120);
    pipeline.row.updateResult({ content: [{ type: "text", text: output }], isError: false });
    pipeline.screen.renderNow();
    const after = pipeline.row.render(120);
    assert.equal(stripTerminalSequences(before.join("\n")), stripTerminalSequences(after.join("\n")));
    assert.notEqual(before[1], after[1]);
    assert.equal(pipeline.screen.fullRedraws - previous, 1);
    assert.match(pipeline.terminal.take(), /offscreen-history-marker/u);
  } finally { pipeline.dispose(); }
});

test("elapsed time alone produces no terminal writes or full-mode timers", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const pipeline = createPipeline(20);
  try {
    const before = pipeline.row.render(120);
    const redraws = pipeline.screen.fullRedraws;
    vi.advanceTimersByTime(1000);
    pipeline.screen.renderNow();
    const data = pipeline.terminal.take();
    assert.equal(pipeline.screen.fullRedraws - redraws, 0);
    assert.doesNotMatch(data, /offscreen-history-marker|\x1b\[(?:2J|3J)/u);
    const after = pipeline.row.render(120);
    assert.deepEqual(after, before);
    assert.equal(data, "");
    assert.equal(vi.getTimerCount(), 0);
  } finally {
    pipeline.dispose();
    vi.useRealTimers();
  }
});

for (const event of ["tick", "append", "replace-tail"] as const) {
  test(`three-member groups keep ${event} at the visible tail instead of replaying history`, () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const pipeline = createPipeline(20, "group output\n".repeat(1800), true, false, 3);
    try {
      const previous = pipeline.screen.fullRedraws;
      vi.advanceTimersByTime(event === "tick" ? 1000 : 100);
      if (event !== "tick") pipeline.update(event);
      pipeline.screen.renderNow();
      const data = pipeline.terminal.take();
      assert.equal(pipeline.screen.fullRedraws - previous, 0);
      assert.doesNotMatch(data, /offscreen-history-marker|\x1b\[(?:2J|3J)/u);
      assert.equal(pipeline.rows[1]!.render(120).length, 0);
      assert.equal(pipeline.rows[2]!.render(120).length, 0);
      if (event === "tick") assert.equal(data, "");
      else assert.match(stripTerminalSequences(pipeline.row.render(120).at(-1)!), /next output/u);
    } finally { pipeline.dispose(); }
  });
}
