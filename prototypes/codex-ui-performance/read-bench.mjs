import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import xterm from '@xterm/headless';
import { TuiMainScreen, TuiAltScreen, Text } from '@earendil-works/pi-tui';
import { loadThemeFromPath, setThemeInstance } from '@earendil-works/pi-coding-agent';
import { cwd, outputDirectory, definitions, fixtures, variants, textResult, restoreClock, save, median, percentile } from './shared.mjs';

const rounds = Number(process.env.PI_PERF_ROUNDS ?? 7);
assert(Number.isInteger(rounds) && rounds >= 3);
setThemeInstance(loadThemeFromPath(path.join(cwd, 'themes/codex-pi.json'), 'truecolor'));
const report = { environment: { ...JSON.parse(process.env.PI_PERF_SOURCES), node: process.version,
  cpu: os.cpus()[0]?.model, rounds, warmup: 2, palette: 'codex-pi',
  boundary: 'ToolExecutionComponent + real TUI + UTF-8 + awaited xterm parsing; fixed text chrome; no model or file I/O' }, cases: [] };
class Capture {
  columns = 120; rows = 40; chunks = [];
  write(text) { this.chunks.push(text); }
  start() {} stop() {} drainInput() {} hideCursor() {} showCursor() {} moveBy() {} clearLine() {} clearFromCursor() {} setTitle() {}
  take() { const text = this.chunks.join(''); this.chunks = []; return text; }
}
const summarize = values => ({ median: median(values), p95: percentile(values, 0.95), samples: values });
try {
  for (const fixture of fixtures.filter(item => item.name === 'read')) for (const history of [0, 20]) for (const mode of ['regular', 'fullscreen']) for (const variant of variants) {
    const samples = {};
    const memory = [];
    for (let round = 0; round < rounds; round++) {
      globalThis.gc?.(); const startHeap = process.memoryUsage().heapUsed;
      const owner = definitions(variant);
      const terminal = new Capture();
      const screen = mode === 'regular' ? new TuiMainScreen(terminal, false, outputDirectory)
        : new TuiAltScreen(terminal, false, outputDirectory, { mouse: false });
      screen.requestRender = () => {}; screen.start();
      const emulator = new xterm.Terminal({ cols: 120, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
      try {
        for (let index = 0; index < history; index++) {
          const row = owner.row('read', { path: `history/${index}.ts` });
          row.updateResult(fixture.result); row.setArgsComplete(); screen.addChild(row);
        }
        screen.addChild(new Text('Read benchmark', 0, 0));
        owner.declareGroup('read', 3);
        const rows = Array.from({ length: 3 }, (_, index) => {
          const row = owner.row('read', { path: `src/file-${index}.ts` });
          row.setArgsComplete(); row.markExecutionStarted(); screen.addChild(row); return row;
        });
        screen.addChild(new Text('> fixed input\nfixed footer', 0, 0));
        const paint = async (phase, update) => {
          const cpu = process.cpuUsage(); const start = performance.now();
          update(); screen.renderNow(); const output = terminal.take();
          if (output) await new Promise(resolve => emulator.write(Buffer.from(output, 'utf8'), resolve));
          const elapsed = performance.now() - start; const usage = process.cpuUsage(cpu);
          if (round >= 2) (samples[phase] ??= []).push({ wallMs: elapsed, cpuMs: (usage.user + usage.system) / 1000, bytes: Buffer.byteLength(output) });
        };
        await paint('pending', () => {});
        await paint('complete', () => rows.forEach(row => row.updateResult(fixture.result)));
        for (let tick = 0; tick < 20; tick++) await paint('stable', () => rows.forEach(row => row.invalidate()));
        await paint('sibling-update', () => rows[1].updateResult(textResult(fixture.result.content[0].text + '\nCHANGED')));
        await paint('expand', () => rows.forEach(row => row.setExpanded(true)));
        await paint('collapse', () => rows.forEach(row => row.setExpanded(false)));
        await paint('narrow', () => { terminal.columns = 30; emulator.resize(30, 40); screen.invalidate(); });
        await paint('restore-width', () => { terminal.columns = 120; emulator.resize(120, 40); screen.invalidate(); });
        const stats = owner.stats();
        if (stats) for (const value of Object.values(stats)) assert(value.chargedBytes <= value.limitBytes);
        globalThis.gc?.();
        memory.push({ retainedHeapDelta: process.memoryUsage().heapUsed - startHeap, rss: process.memoryUsage().rss, cache: stats });
        owner.dispose();
        if (owner.stats()) assert(Object.values(owner.stats()).every(value => value.chargedBytes === 0));
      } finally { owner.dispose(); screen.stop(); emulator.dispose(); }
    }
    report.cases.push({ fixture: fixture.id, history, mode, variant, memory,
      phases: Object.fromEntries(Object.entries(samples).map(([phase, values]) => [phase,
        Object.fromEntries(['wallMs', 'cpuMs', 'bytes'].map(key => [key, summarize(values.map(value => value[key]))]))])) });
    console.log(`Measured Read ${fixture.id}/${history}/${mode}/${variant}`);
    save(`reads-${process.env.PI_PERF_AGENT_VERSION}.json`, report);
  }
} finally { restoreClock(); }
