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

function createPipeline(history: number, output = Array.from({ length: 1800 }, (_, index) => `output ${index}`).join("\n"), withResult = true, offscreenRunning = false) {
  initTheme("dark", false);
  mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), ".tmp/codex-ui-pipeline-"));
  const terminal = new CaptureTerminal();
  const screen = new TuiMainScreen(terminal as Terminal, false, directory);
  // Use explicit frames so timer callbacks are deterministic, without changing their cadence.
  screen.requestRender = () => {};
  screen.start();
  const tools: ToolDefinition[] = [];
  const handlers = new Map<string, Array<() => void>>();
  registerCodexTools({
    registerTool(tool: ToolDefinition) { tools.push(tool); },
    on(event: string, handler: () => void) {
      const callbacks = handlers.get(event) ?? [];
      callbacks.push(handler);
      handlers.set(event, callbacks);
    },
  } as unknown as ExtensionAPI);
  let id = 0;
  const bash = () => new ToolExecutionComponent("bash", `bash-${id++}`, { command: "printf sample", timeout: 30 },
    { showImages: false }, tools.find(tool => tool.name === "bash"), screen, directory);
  for (let index = 0; index < history; index++) {
    const row = bash();
    row.setExpanded(true);
    const running = offscreenRunning && index === 0;
    if (running) { row.setArgsComplete(); row.markExecutionStarted(); }
    row.updateResult({ content: [{ type: "text", text: "offscreen-history-marker\n".repeat(1800) }], isError: false }, running);
    screen.addChild(row);
  }
  const row = bash();
  row.setExpanded(true);
  row.setArgsComplete();
  row.markExecutionStarted();
  let text = output;
  if (withResult) row.updateResult({ content: [{ type: "text", text }], isError: false }, true);
  screen.addChild(row);
  screen.renderNow();
  terminal.take();
  return {
    row, screen, terminal,
    update(event: "append" | "replace-tail") {
      text = (event === "append" ? text : output) + "\nnext output";
      row.updateResult({ content: [{ type: "text", text }], isError: false }, true);
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
    for (const event of ["append", "replace-tail"] as const) {
      const writes: string[] = [];
      for (const history of [0, 20]) {
        vi.setSystemTime(0);
        const pipeline = createPipeline(history, output);
        try {
          const before = pipeline.screen.fullRedraws;
          vi.advanceTimersByTime(100);
          pipeline.update(event);
          pipeline.screen.renderNow();
          const data = pipeline.terminal.take();
          writes.push(data);
          assert.equal(pipeline.screen.fullRedraws - before, 0);
          assert.doesNotMatch(data, /offscreen-history-marker|\x1b\[(?:2J|3J)/u);
          assert.match(stripTerminalSequences(pipeline.row.render(120).slice(-4).join("\n")), /next output\s+\d+ lines · 0\.1s\s*$/u);
        } finally { pipeline.dispose(); }
      }
      assert.equal(writes[1], writes[0]);
    }
  }
});

test("an offscreen running tool still refreshes instead of being hidden to avoid a redraw", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const pipeline = createPipeline(20, "current output\n".repeat(1800), true, true);
  try {
    const previous = pipeline.screen.fullRedraws;
    vi.advanceTimersByTime(1000);
    pipeline.screen.renderNow();
    assert.equal(pipeline.screen.fullRedraws - previous, 1);
    const data = pipeline.terminal.take();
    assert.match(data, /offscreen-history-marker/u);
    assert.match(stripTerminalSequences(data), /1800 lines · 1\.0s/u);
  } finally { pipeline.dispose(); }
});

test("expanded footer changes owners once and freezes after an empty final result", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const pipeline = createPipeline(0, "", false);
  const plain = () => stripTerminalSequences(pipeline.row.render(120).join("\n")).trimEnd();
  try {
    assert.match(plain(), /0\.0s$/u);
    assert.doesNotMatch(plain(), /0 lines/u);
    vi.advanceTimersByTime(1000);
    pipeline.row.updateResult({ content: [], isError: false }, true);
    assert.match(plain(), /0 lines · 1\.0s$/u);
    assert.equal(plain().match(/1\.0s/gu)?.length, 1);
    vi.advanceTimersByTime(1000);
    pipeline.row.updateResult({ content: [], isError: false });
    const final = plain();
    assert.match(final, /completed/u);
    assert.match(final, /0 lines · 2\.0s$/u);
    vi.advanceTimersByTime(5000);
    assert.equal(plain(), final);
    pipeline.row.setExpanded(false);
    assert.match(plain(), /0 lines · 2\.0s · 30s limit.*expand/u);
  } finally { pipeline.dispose(); }
});

test("expanded bash timer ticks update the visible bottom instead of replaying history", () => {
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
    assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
    const text = stripTerminalSequences(after.join("\n")).trimEnd();
    assert.match(text, /1800 lines · 1\.0s$/u);
    assert.match(text, /30s limit.*collapse/u);
  } finally {
    pipeline.dispose();
    vi.useRealTimers();
  }
});
