import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import xterm from '@xterm/headless';
const { Terminal: HeadlessTerminal } = xterm;
import { TuiMainScreen, TuiAltScreen } from '@earendil-works/pi-tui';
import {
  CustomEditor, FooterComponent, KeybindingsManager, getEditorTheme,
  theme, AssistantMessageComponent, getMarkdownTheme, setTheme, setThemeInstance, loadThemeFromPath,
} from '@earendil-works/pi-coding-agent';
import { parseStreamingJson } from 'benchmark:json-parser';
import * as beforeComponents from './.generated/before/components.js';
import * as afterComponents from './.generated/after/components.js';
import {
  cwd, directory, outputDirectory, width, height, variants, fixtures, code,
  definitions as createDefinitions, textResult, restoreRow, advance, restoreClock,
  median, percentile, cpuMilliseconds, save,
} from './shared.mjs';

const streamRounds = Number(process.env.PI_PERF_STREAM_ROUNDS ?? 4);
if (!Number.isInteger(streamRounds) || streamRounds < 2) throw new Error('PI_PERF_STREAM_ROUNDS must be an integer of at least 2.');
const rounds = Number(process.env.PI_PERF_ROUNDS ?? 7);
if (!Number.isInteger(rounds) || rounds < 3) throw new Error('PI_PERF_ROUNDS must be an integer of at least 3.');
const productPalette = loadThemeFromPath(path.join(cwd, 'themes/codex-pi.json'), 'truecolor');
function definitions(variant) {
  if (process.env.PI_PERF_PROFILE === 'product') {
    if (variant === 'native') setTheme('dark', false);
    else setThemeInstance(productPalette);
  }
  return createDefinitions(variant);
}
const cpuStart = () => process.cpuUsage();
const measured = fn => {
  const cpu = cpuStart();
  const start = performance.now();
  const value = fn();
  return { value, wallMs: performance.now() - start, cpuMs: cpuMilliseconds(cpu) };
};
const summary = values => ({ median: median(values), p95: percentile(values, 0.95), samples: values });

const report = {
  environment: { ...JSON.parse(process.env.PI_PERF_SOURCES), timestamp: new Date().toISOString(), node: process.version, platform: process.platform,
    arch: process.arch, cpu: os.cpus()[0]?.model, agentVersion: process.env.PI_PERF_AGENT_VERSION,
    width, height, terminalParser: '@xterm/headless@5.5.0', scrollback: 10000,
    rounds, warmupRounds: 2, streamRounds, streamWarmupRounds: 1, terminalProgram: process.env.TERM_PROGRAM,
    palette: process.env.PI_PERF_PROFILE === 'product' ? 'native:dark,codex:codex-pi' : 'dark for all variants',
    note: 'Controlled rendering pipeline, not live CLI or Ghostty CPU/GPU.' },
  cold: [], interactions: [], pipeline: [], streams: [], stable: [],
};

class CaptureTerminal {
  columns = width;
  rows = height;
  chunks = [];
  write(text) { this.chunks.push(text); }
  hideCursor() {}
  showCursor() {}
  start() {}
  stop() {}
  drainInput() {}
  moveBy() {}
  clearLine() {}
  clearFromCursor() {}
  setTitle() {}
  take() { const text = this.chunks.join(''); this.chunks = []; return text; }
}

function makeScreen(mode) {
  const terminal = new CaptureTerminal();
  const screen = mode === 'regular'
    ? new TuiMainScreen(terminal, false, outputDirectory)
    : new TuiAltScreen(terminal, false, outputDirectory, { mouse: false });
  // Replay deterministic frame boundaries instead of racing the host's 16 ms scheduler.
  screen.requestRender = () => {};
  screen.start();
  return { screen, terminal };
}

function chrome(variant, screen, historyEntries = 100) {
  const usage = { input: 100, output: 25, cacheRead: 50, cacheWrite: 0, totalTokens: 175,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const message = { role: 'assistant', content: [{ type: 'text', text: 'Inspecting the tool output and checking the result.' }],
    model: 'benchmark-model', api: 'openai-responses', provider: 'benchmark', timestamp: 0, stopReason: 'stop', usage };
  const entries = Array.from({ length: historyEntries }, () => ({ type: 'message', message }));
  const usageSnapshot = { percent: 12.5, contextWindow: 200000, tokens: 25000 };
  const statuses = new Map();
  const keybindings = new KeybindingsManager();
  let editor;
  let footer;
  if (variant === 'native') {
    editor = new CustomEditor(screen, getEditorTheme(), keybindings);
    footer = new FooterComponent({
      state: { model: { id: 'benchmark-model', provider: 'benchmark', reasoning: true, contextWindow: 200000 }, thinkingLevel: 'high' },
      sessionManager: { getEntries: () => entries, getCwd: () => cwd, getSessionName: () => undefined },
      getContextUsage: () => usageSnapshot,
      modelRuntime: { isUsingSubscription: () => false }, modelRegistry: { isUsingOAuth: () => false },
    }, { getGitBranch: () => 'main', getExtensionStatuses: () => statuses, getAvailableProviderCount: () => 1 });
  } else {
    const components = variant === 'before' ? beforeComponents : afterComponents;
    editor = new components.CodexEditor(screen, getEditorTheme(), keybindings, () => theme);
    footer = new components.CodexFooter({ cwd, getModelId: () => 'benchmark-model',
      getThinkingLevel: () => 'high', getContextUsage: () => usageSnapshot, getTheme: () => theme,
      getBranch: () => 'main', getExtensionStatuses: () => statuses });
  }
  const assistant = new AssistantMessageComponent(message, false, getMarkdownTheme());
  return { editor, footer, assistant };
}

async function feed(terminal, data) {
  if (!data) return { cpuMs: 0, wallMs: 0 };
  // Include UTF-8 decoding and wait for parsing, not merely enqueueing.
  const cpu = cpuStart();
  const start = performance.now();
  await new Promise(resolve => terminal.write(Buffer.from(data, 'utf8'), resolve));
  return { cpuMs: cpuMilliseconds(cpu), wallMs: performance.now() - start };
}

function completedRows(owner, screen, count, expanded = true) {
  const fixture = fixtures.find(fixture => fixture.id === 'bash-lines-1800');
  for (let index = 0; index < count; index++) screen.addChild(restoreRow(owner, fixture, expanded, screen));
}

async function cold() {
  for (const fixture of fixtures.filter(fixture => !process.env.PI_PERF_FIXTURE || fixture.id === process.env.PI_PERF_FIXTURE)) for (const expanded of [false, true]) {
    for (const variant of variants) {
      console.log(`Starting cold render: ${fixture.id}/${expanded}/${variant}`);
      const values = [];
      let rows = 0;
      for (let round = 0; round < rounds; round++) {
        const owner = definitions(variant);
        try {
          const result = measured(() => restoreRow(owner, fixture, expanded).render(width));
          rows = result.value.length;
          if (round >= 2) values.push({ wallMs: result.wallMs, cpuMs: result.cpuMs });
        } finally { owner.dispose(); }
        globalThis.gc?.();
      }
      report.cold.push({ fixture: fixture.id, expanded, variant, rows,
        wallMs: summary(values.map(value => value.wallMs)), cpuMs: summary(values.map(value => value.cpuMs)) });
    }
    save(`results-${process.env.PI_PERF_AGENT_VERSION}.json`, report);
    console.log(`Completed cold render: ${fixture.id}/${expanded}`);
  }
}

async function interactions() {
  for (const fixture of fixtures.filter(fixture => ['bash-lines-1800', 'edit-1000', 'edit-10000'].includes(fixture.id)
    && (!process.env.PI_PERF_FIXTURE || fixture.id === process.env.PI_PERF_FIXTURE))) {
    for (const variant of variants) {
      const times = { invalidate: [], collapse: [], reexpand: [], resizeCold: [], resizeReturn: [] };
      for (let round = 0; round < rounds; round++) {
        const owner = definitions(variant);
        try {
          const row = restoreRow(owner, fixture, true);
          row.render(width);
          const events = {
            invalidate: () => { row.invalidate(); row.render(width); },
            collapse: () => { row.setExpanded(false); row.render(width); },
            reexpand: () => { row.setExpanded(true); row.render(width); },
            resizeCold: () => row.render(width - 1),
            resizeReturn: () => row.render(width),
          };
          for (const [event, run] of Object.entries(events)) {
            const result = measured(run);
            if (round >= 2) times[event].push(result.wallMs);
          }
        } finally { owner.dispose(); }
        globalThis.gc?.();
      }
      report.interactions.push({ fixture: fixture.id, variant,
        ...Object.fromEntries(Object.entries(times).map(([event, values]) => [event, summary(values)])) });
    }
  }
}

async function pipeline(fixtureId, mode, history, event, expanded = true) {
  const fixture = fixtures.find(fixture => fixture.id === fixtureId);
  for (const variant of variants) {
    const owner = definitions(variant);
    const { screen, terminal } = makeScreen(mode);
    const emulator = new HeadlessTerminal({ cols: width, rows: height, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
    const { editor, footer, assistant } = chrome(variant, screen);
    const samples = [];
    try {
      completedRows(owner, screen, history, expanded);
      screen.addChild(assistant);
      const row = owner.row('bash', fixture.args, screen);
      row.setExpanded(expanded); row.setArgsComplete(); row.markExecutionStarted();
      row.updateResult(fixture.result, true);
      screen.addChild(row); screen.addChild(editor); screen.addChild(footer);
      screen.renderNow();
      await feed(emulator, terminal.take());
      let output = fixture.result.content[0].text;
      for (let index = 0; index < 14; index++) {
        const previousRedraws = screen.fullRedraws;
        const node = measured(() => {
          advance(event === 'tick' ? 1000 : 100);
          if (event === 'replace-tail') row.updateResult(textResult(fixture.result.content[0].text + `\nnext line ${index}`), true);
          if (event === 'append') {
            output += `\nnext line ${index}`;
            row.updateResult(textResult(output), true);
          }
          screen.renderNow();
        });
        const data = terminal.take();
        const parser = await feed(emulator, data);
        if (index >= 4) samples.push({ nodeWallMs: node.wallMs, nodeCpuMs: node.cpuMs,
          parserCpuMs: parser.cpuMs, parserWallMs: parser.wallMs, totalCpuMs: node.cpuMs + parser.cpuMs,
          bytes: Buffer.byteLength(data), fullRedraws: screen.fullRedraws - previousRedraws });
      }
      report.pipeline.push({ fixture: fixtureId, mode, history, event, expanded, variant,
        ...Object.fromEntries(Object.keys(samples[0]).map(key => [key, summary(samples.map(sample => sample[key]))])) });
    } finally {
      owner.dispose(); footer.dispose(); screen.stop(); emulator.dispose();
    }
  }
  console.log(`Completed pipeline: ${fixtureId}/${mode}/history-${history}/${event}`);
}

async function stable(modes = ['regular', 'fullscreen']) {
  for (const mode of modes) for (const history of [0, 20]) for (const variant of variants) {
    const owner = definitions(variant);
    const { screen, terminal } = makeScreen(mode);
    const { editor, footer, assistant } = chrome(variant, screen);
    try {
      completedRows(owner, screen, history);
      screen.addChild(assistant); screen.addChild(editor); screen.addChild(footer);
      screen.renderNow(); terminal.take();
      const samples = [];
      for (let index = 0; index < 40; index++) {
        const result = measured(() => { editor.setText(`typed ${index}`); screen.renderNow(); });
        const data = terminal.take();
        if (index >= 10) samples.push({ wallMs: result.wallMs, cpuMs: result.cpuMs, bytes: Buffer.byteLength(data) });
      }
      report.stable.push({ mode, history, variant,
        ...Object.fromEntries(Object.keys(samples[0]).map(key => [key, summary(samples.map(sample => sample[key]))])) });
    } finally { owner.dispose(); footer.dispose(); screen.stop(); }
  }
}

async function writeStreams() {
  const content = code.repeat(4).slice(0, 256 * 1024);
  const raw = JSON.stringify({ path: 'fixture.ts', content });
  for (const parseJson of [false, true]) for (const variant of variants) {
    const samples = [];
    for (let round = 0; round < streamRounds; round++) {
      const owner = definitions(variant);
      const { screen, terminal } = makeScreen('regular');
      const { editor, footer, assistant } = chrome(variant, screen);
      const emulator = new HeadlessTerminal({ cols: width, rows: height, scrollback: 10000, logLevel: 'off' });
      const row = owner.row('write', { path: 'fixture.ts', content: '' }, screen);
      screen.addChild(assistant); screen.addChild(row); screen.addChild(editor); screen.addChild(footer);
      screen.renderNow(); await feed(emulator, terminal.take());
      const totals = { parseWallMs: 0, updateWallMs: 0, drawWallMs: 0, nodeCpuMs: 0, parserCpuMs: 0, bytes: 0, frames: 0, updates: 0 };
      try {
        const maximum = parseJson ? raw.length : content.length;
        for (let offset = 256; offset <= maximum + 255; offset += 256) {
          const end = Math.min(offset, maximum);
          let args;
          let phase = measured(() => {
            args = parseJson ? parseStreamingJson(raw.slice(0, end)) : { path: 'fixture.ts', content: content.slice(0, end) };
          });
          totals.parseWallMs += phase.wallMs; totals.nodeCpuMs += phase.cpuMs;
          phase = measured(() => row.updateArgs(args));
          totals.updateWallMs += phase.wallMs; totals.nodeCpuMs += phase.cpuMs; totals.updates++;
          if (totals.updates % 16 === 0 || end === maximum) {
            phase = measured(() => screen.renderNow());
            totals.drawWallMs += phase.wallMs; totals.nodeCpuMs += phase.cpuMs; totals.frames++;
            const data = terminal.take();
            totals.bytes += Buffer.byteLength(data);
            totals.parserCpuMs += (await feed(emulator, data)).cpuMs;
          }
        }
        const phase = measured(() => { row.setArgsComplete(); row.updateResult(textResult('Successfully wrote file.')); screen.renderNow(); });
        totals.drawWallMs += phase.wallMs; totals.nodeCpuMs += phase.cpuMs;
        const data = terminal.take(); totals.bytes += Buffer.byteLength(data);
        totals.parserCpuMs += (await feed(emulator, data)).cpuMs;
        totals.totalCpuMs = totals.nodeCpuMs + totals.parserCpuMs;
        if (round >= 1) samples.push(totals);
      } finally { owner.dispose(); footer.dispose(); screen.stop(); emulator.dispose(); }
    }
    report.streams.push({ tool: 'write', variant, parseJson, bytesOfContent: content.length, chunkCharacters: 256, drawEvery: 16,
      ...Object.fromEntries(Object.keys(samples[0]).map(key => [key, summary(samples.map(sample => sample[key]))])) });
    console.log(`Completed write stream: ${variant}/json-${parseJson}`);
  }
}

async function editStreams() {
  const oldText = code.repeat(2).slice(0, 128 * 1024);
  const newText = oldText.replace('value1 = 1;', 'value1 = 100;');
  const fixturePath = path.join(outputDirectory, 'edit-stream.ts');
  fs.writeFileSync(fixturePath, oldText);
  const raw = JSON.stringify({ path: fixturePath, edits: [{ oldText, newText }] });
  for (const parseJson of [false, true]) for (const variant of variants) {
    const samples = [];
    for (let round = 0; round < streamRounds; round++) {
      const owner = definitions(variant);
      const { screen, terminal } = makeScreen('regular');
      const emulator = new HeadlessTerminal({ cols: width, rows: height, scrollback: 10000, logLevel: 'off' });
      const row = owner.row('edit', { path: fixturePath, edits: [] }, screen);
      screen.addChild(row);
      screen.renderNow(); await feed(emulator, terminal.take());
      const totals = { parseWallMs: 0, updateWallMs: 0, drawWallMs: 0, previewWallMs: 0, updates: 0, frames: 0,
        nodeCpuMs: 0, parserCpuMs: 0, bytes: 0, fullRedraws: 0 };
      try {
        const maximum = parseJson ? raw.length : oldText.length + newText.length;
        for (let offset = 256; offset <= maximum + 255; offset += 256) {
          const end = Math.min(offset, maximum);
          const parsed = measured(() => parseJson ? parseStreamingJson(raw.slice(0, end)) : {
            path: fixturePath, edits: [{ oldText: oldText.slice(0, end), newText: newText.slice(0, Math.max(0, end - oldText.length)) }],
          });
          totals.parseWallMs += parsed.wallMs; totals.nodeCpuMs += parsed.cpuMs;
          const update = measured(() => row.updateArgs({ ...parsed.value, path: parsed.value.path ?? fixturePath }));
          totals.updateWallMs += update.wallMs; totals.nodeCpuMs += update.cpuMs; totals.updates++;
          if (totals.updates % 16 === 0 || end === maximum) {
            const previousRedraws = screen.fullRedraws;
            const draw = measured(() => screen.renderNow());
            totals.drawWallMs += draw.wallMs; totals.nodeCpuMs += draw.cpuMs;
            const data = terminal.take(); totals.frames++; totals.bytes += Buffer.byteLength(data);
            totals.fullRedraws += screen.fullRedraws - previousRedraws;
            totals.parserCpuMs += (await feed(emulator, data)).cpuMs;
          }
        }
        const start = performance.now();
        const previewCpu = cpuStart();
        row.setArgsComplete();
        // A valid native preview reads the dedicated fixture; it never modifies it.
        if (variant === 'native') {
          while (row.rendererState.callComponent?.previewPending) {
            if (performance.now() - start > 10000) throw new Error('Timed out waiting for native edit preview');
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
        const previousRedraws = screen.fullRedraws;
        screen.renderNow();
        totals.previewWallMs = performance.now() - start; totals.nodeCpuMs += cpuMilliseconds(previewCpu);
        totals.fullRedraws += screen.fullRedraws - previousRedraws;
        const data = terminal.take(); totals.bytes += Buffer.byteLength(data);
        totals.parserCpuMs += (await feed(emulator, data)).cpuMs;
        totals.totalCpuMs = totals.nodeCpuMs + totals.parserCpuMs;
        totals.totalWallMs = totals.parseWallMs + totals.updateWallMs + totals.drawWallMs + totals.previewWallMs;
        if (round >= 1) samples.push(totals);
      } finally { owner.dispose(); screen.stop(); emulator.dispose(); }
    }
    report.streams.push({ tool: 'edit', variant, parseJson, oldCharacters: oldText.length, newCharacters: newText.length,
      chunkCharacters: 256, drawEvery: 16,
      ...Object.fromEntries(Object.keys(samples[0]).map(key => [key, summary(samples.map(sample => sample[key]))])) });
    console.log(`Completed edit stream: ${variant}/json-${parseJson}`);
  }
}

try {
  const only = process.env.PI_PERF_ONLY;
  if (!only || only === 'cold') await cold();
  if (!only || only === 'interactions') await interactions();
  if (!only || only === 'stable') await stable();
  if (!only || only === 'pipeline') {
    for (const fixture of ['bash-lines-1800', 'bash-token-50k']) {
      for (const history of [0, 20]) {
        for (const event of ['tick', 'replace-tail', 'append']) await pipeline(fixture, 'regular', history, event);
        for (const event of ['tick', 'append']) await pipeline(fixture, 'regular', history, event, false);
      }
    }
  }
  if (!only || only === 'fullscreen') {
    for (const fixture of ['bash-lines-1800', 'bash-token-50k']) {
      for (const history of [0, 20]) await pipeline(fixture, 'fullscreen', history, 'tick');
    }
  }
  if (only === 'product') {
    await pipeline('bash-lines-1800', 'regular', 0, 'replace-tail');
    for (const event of ['tick', 'replace-tail', 'append']) await pipeline('bash-token-50k', 'regular', 20, event);
  }
  if (!only || only === 'streams') {
    await writeStreams();
    await editStreams();
  }
  const saved = save(`results-${process.env.PI_PERF_AGENT_VERSION}.json`, report);
  console.log(`Saved ${saved}`);
} finally { restoreClock(); }
