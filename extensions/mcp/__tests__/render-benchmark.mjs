import assert from "node:assert/strict";
import fs from "node:fs";
import readline from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Container, Input, Text, TuiMainScreen } from "@earendil-works/pi-tui";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

// Run after building. --renderer accepts a saved pre-change build for comparison.
// --session is read-only; neither content nor arguments are printed.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const frames = Number(option("--frames", "100"));
const count = Number(option("--rows", "500"));
assert.ok(Number.isInteger(frames) && frames >= 1 && Number.isInteger(count) && count >= 1);
const rendererPath = resolve(option("--renderer", `${root}/extensions/mcp/dist/renderers.js`));
const { renderMcpToolCall, renderMcpToolResult } = await import(pathToFileURL(rendererPath).href);
const agentRoot = `${root}/node_modules/@earendil-works/pi-coding-agent`;
const { initTheme, theme, loadThemeFromPath, setThemeInstance } = await import(pathToFileURL(`${agentRoot}/dist/modes/interactive/theme/theme.js`).href);
initTheme("dark", false);
setThemeInstance(loadThemeFromPath(`${root}/themes/codex-pi.json`));
const version = name => JSON.parse(fs.readFileSync(`${root}/node_modules/@earendil-works/${name}/package.json`)).version;
let records;
const sessionPath = option("--session");
if (sessionPath) {
  const { buildContextEntries } = await import(pathToFileURL(`${agentRoot}/dist/core/session-manager.js`).href);
  const entries = [];
  for await (const line of readline.createInterface({ input: fs.createReadStream(resolve(sessionPath)) })) {
    const entry = JSON.parse(line);
    if (entry.id) entries.push(entry);
  }
  const calls = new Map();
  records = [];
  for (const entry of buildContextEntries(entries, entries.at(-1)?.id)) {
    const message = entry.message;
    for (const block of message?.content ?? []) if (block.type === "toolCall") calls.set(block.id, block);
    if (message?.role === "toolResult" && message.toolName?.startsWith("mcp__")) {
      records.push({ name: message.toolName, args: calls.get(message.toolCallId)?.arguments ?? {}, result: message });
    }
  }
} else {
  records = Array.from({ length: count }, (_, index) => ({
    name: "mcp__benchmark__inspect",
    args: { query: `row-${index} inspect 中文🙂 layout` },
    result: { content: [{ type: "text", text: JSON.stringify({ row: index, text: "中文🙂e\u0301 layout preview ".repeat(80) }) }], isError: false },
  }));
}
assert.ok(records.length > 0, "No MCP results to render");
console.log(JSON.stringify({ node: process.version, pi: version("pi-coding-agent"), tui: version("pi-tui"), rows: records.length, frames, input: sessionPath ? "local-session" : "synthetic", renderer: rendererPath }));
const names = name => { const [, serverName, ...tool] = name.split("__"); return { serverName, toolName: tool.join("__") }; };
const summarize = values => {
  values.sort((a, b) => a - b);
  return { p50ms: +values[Math.floor(values.length * 0.5)].toFixed(3), p95ms: +values[Math.min(values.length - 1, Math.floor(values.length * 0.95))].toFixed(3) };
};
const measure = fn => {
  for (let i = 0; i < 5; i++) fn();
  const samples = [];
  for (let i = 0; i < frames; i++) { const start = performance.now(); fn(); samples.push(performance.now() - start); }
  return summarize(samples);
};
const results = [];
for (const width of [100, 160]) {
  const components = records.flatMap(record => {
    const context = { state: {}, isPartial: false, isError: record.result.isError ?? false, lastComponent: undefined };
    return [renderMcpToolCall(record.args, names(record.name), theme, context),
      renderMcpToolResult(record.result, { expanded: false, isPartial: false }, theme, context)];
  });
  const render = () => { for (const component of components) component.render(width); };
  const coldStart = performance.now(); render();
  const coldMs = performance.now() - coldStart;
  const componentsWarm = measure(render);
  const invalidated = measure(() => { components.at(-1).invalidate(); render(); });
  const resize = measure(() => { for (const component of components) component.render(width === 100 ? 160 : 100); render(); });
  const input = new Input();
  const streaming = new Text("", 0, 0);
  let onInput;
  let painted;
  let bytes = 0;
  const terminal = {
    columns: width, rows: 40, kittyProtocolActive: false,
    start(handler) { onInput = handler; }, stop() {}, async drainInput() {},
    write(data) { bytes += data.length; if (painted) { const done = painted; painted = undefined; done(); } },
    moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
  };
  const tui = new TuiMainScreen(terminal);
  const history = new Container();
  for (const [index, record] of records.entries()) {
    const tool = { renderShell: "self", renderCall: (args, theme, context) => renderMcpToolCall(args, names(record.name), theme, context), renderResult: renderMcpToolResult };
    const row = new ToolExecutionComponent(record.name, `row-${index}`, record.args, { showImages: false }, tool, tui, root);
    row.updateResult(record.result);
    history.addChild(row);
  }
  tui.addChild(history); tui.addChild(streaming); tui.addChild(input); tui.setFocus(input);
  tui.start(); tui.renderNow();
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    const hostWarm = measure(() => tui.renderNow());
    const inputLatency = {};
    for (const mode of ["waiting", "streaming"]) {
      const samples = [];
      for (let i = 0; i < Math.min(frames, 40); i++) {
        // Exercise native input dispatch, scheduling, the complete history, diff and write.
        // The terminal sink is in-memory; this does not measure an OS PTY or terminal emulator.
        if (mode === "streaming") { streaming.setText(`stream-${i} 中文🙂`); tui.requestRender(); }
        const start = performance.now();
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Input was not painted")), 10000);
          painted = () => { clearTimeout(timeout); resolve(); };
          onInput(i % 2 === 0 ? "x" : "\x7f");
        });
        samples.push(performance.now() - start);
      }
      inputLatency[mode] = summarize(samples);
    }
    const row = { width, coldMs: +coldMs.toFixed(3), componentsWarm, oneInvalidated: invalidated, resizeRoundTrip: resize, hostWarm, inputLatency, bytesWritten: bytes };
    results.push(row); console.log(JSON.stringify(row));
  } finally { tui.stop(); }
}
if (args.includes("--check")) {
  assert.equal(records.length, 500, "The 5ms component budget applies to 500 rows");
  for (const result of results) assert.ok(result.componentsWarm.p95ms <= 5, `Component p95 exceeded 5ms at width ${result.width}`);
}
