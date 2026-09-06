import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { ToolExecutionComponent, theme, setThemeInstance, loadThemeFromPath } from '@earendil-works/pi-coding-agent';
import { TuiMainScreen, TuiAltScreen } from '@earendil-works/pi-tui';
import xterm from '@xterm/headless';
import { cwd, outputDirectory, variants, definitions, textResult, restoreRow, fixtures, save, restoreClock, median, percentile } from './shared.mjs';
import * as before from './.generated/before/mcp/renderers.js';
import * as after from './.generated/after/mcp/renderers.js';

assert.ok(JSON.parse(process.env.PI_PERF_SOURCES).build.mcp.before['renderers.ts'], 'MCP requires an immutable baseline');
setThemeInstance(loadThemeFromPath(`${cwd}/themes/codex-pi.json`, 'truecolor'));
const inputs = {
  short: textResult('first\nsecond\nthird'),
  token: textResult('中🙂x'.repeat(6000)),
  json: textResult(JSON.stringify({ rows: Array.from({ length: 900 }, (_, id) => ({ id, text: 'sample,:\\\"中文' })) })),
  blocks: { content: Array.from({ length: 24 }, (_, id) => ({ type: 'text', text: `${id}: ${'block '.repeat(250)}` })), isError: false },
};
function row(variant, ui) {
  const renderer = variant === 'before' ? before : after;
  return new ToolExecutionComponent('mcp_fixture', 'mcp-bench', { query: 'fixture' }, { showImages: false }, {
    name: 'mcp_fixture', label: 'MCP', parameters: {}, description: '', renderShell: 'self',
    renderCall: (args, theme, context) => renderer.renderMcpToolCall(args, { serverName: 'fixture', toolName: 'preview' }, theme, context),
    renderResult: renderer.renderMcpToolResult,
  }, ui, cwd);
}
const memory = process.argv.includes('--memory');
const report = { environment: { ...JSON.parse(process.env.PI_PERF_SOURCES), node: process.version, width: 120, height: 40,
  palette: 'codex-pi', mode: memory ? 'memory' : 'bench', rounds: 5, command: process.argv, }, cases: [] };
function stats(values) { return { median: median(values), p95: percentile(values, .95), samples: values }; }
try {
  for (const variant of variants) {
    assert.notEqual(variant, 'native');
    if (memory) {
      const rows = Array.from({ length: 20 }, () => row(variant, { requestRender() {} }));
      const samples = [];
      for (let cycle = 0; cycle < 24; cycle++) {
        for (const component of rows) {
          component.updateResult(textResult(JSON.stringify({ cycle, data: 'x'.repeat(48000) })));
          for (const width of [120, 60, 120]) for (const expanded of [false, true]) {
            component.setExpanded(expanded); component.render(width);
          }
        }
        globalThis.gc(); samples.push(process.memoryUsage());
      }
      rows.length = 0; globalThis.gc();
      report.cases.push({ variant, samples, afterRelease: process.memoryUsage() });
      continue;
    }
    for (const [fixture, result] of Object.entries(inputs)) for (const history of [0, 20]) for (const mode of ['regular', 'fullscreen']) {
      const cpu = [], wall = [], bytes = [], frames = [];
      for (let round = 0; round < 5; round++) {
        const owner = definitions(variant);
        const terminal = { columns: 120, rows: 40, chunks: [], write(text) { this.chunks.push(text); },
          hideCursor() {}, showCursor() {}, start() {}, stop() {}, drainInput() {}, moveBy() {}, clearLine() {}, clearFromCursor() {}, setTitle() {} };
        const screen = mode === 'regular' ? new TuiMainScreen(terminal, false, outputDirectory)
          : new TuiAltScreen(terminal, false, outputDirectory, { mouse: false });
        screen.requestRender = () => {};
        const parser = new xterm.Terminal({ cols: 120, rows: 40, scrollback: 10000 });
        try {
          screen.start();
          for (let index = 0; index < history; index++) screen.addChild(restoreRow(owner, fixtures[0], false, screen));
          const component = row(variant, screen); screen.addChild(component);
          component.updateResult(result);
          for (let frame = 0; frame < 12; frame++) {
            const startCpu = process.cpuUsage(), start = performance.now();
            component.setExpanded(frame % 4 === 1);
            terminal.columns = frame % 4 === 2 ? 60 : 120;
            parser.resize(terminal.columns, 40);
            screen.renderNow();
            const output = terminal.chunks.join(''); terminal.chunks.length = 0;
            await new Promise(resolve => parser.write(Buffer.from(output), resolve));
            const used = process.cpuUsage(startCpu);
            if (round >= 2 && frame >= 4) {
              const sample = { phase: ['collapsed-repeat', 'expanded', 'narrow', 'wide'][frame % 4],
                cpuMs: (used.user + used.system) / 1000, wallMs: performance.now() - start, bytes: Buffer.byteLength(output) };
              frames.push(sample); cpu.push(sample.cpuMs); wall.push(sample.wallMs); bytes.push(sample.bytes);
            }
          }
        } finally { screen.stop(); parser.dispose(); owner.dispose(); }
        globalThis.gc();
      }
      assert.ok(bytes.some(value => value > 0), 'Terminal workload must emit output');
      report.cases.push({ variant, fixture, history, mode, cpuMs: stats(cpu), wallMs: stats(wall), bytes: stats(bytes),
        phases: Object.fromEntries(['collapsed-repeat', 'expanded', 'narrow', 'wide'].map(phase => {
          const selected = frames.filter(frame => frame.phase === phase);
          return [phase, { cpuMs: stats(selected.map(frame => frame.cpuMs)), wallMs: stats(selected.map(frame => frame.wallMs)),
            bytes: stats(selected.map(frame => frame.bytes)) }];
        })) });
    }
  }
  console.log(save(memory ? 'mcp-memory.json' : 'mcp-bench.json', report));
} finally { restoreClock(); }
