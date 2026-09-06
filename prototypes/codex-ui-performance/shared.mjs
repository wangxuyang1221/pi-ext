import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  initTheme, ToolExecutionComponent,
} from '@earendil-works/pi-coding-agent';
import { registerCodexTools as registerBefore } from './.generated/before/tools.js';
import { registerCodexTools as registerAfter } from './.generated/after/tools.js';
import { ToolRenderCache } from './.generated/after/render-cache.js';

export const directory = path.dirname(fileURLToPath(import.meta.url));
export const cwd = path.resolve(directory, '../..');
export const outputDirectory = path.join(directory, '.generated');
export const width = 120;
export const height = 40;
export const variants = (process.env.PI_PERF_VARIANTS ?? 'native,before,after').split(',');
if (variants.some(variant => !['native', 'before', 'after'].includes(variant))) throw new Error('Unknown benchmark variant');
const runId = process.env.PI_PERF_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-');
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) throw new Error('Invalid benchmark run ID');
export const runDirectory = path.join(directory, 'results', runId);
fs.mkdirSync(path.dirname(runDirectory), { recursive: true });
// A run may checkpoint its own report, but must not overwrite an earlier run.
fs.mkdirSync(runDirectory);
initTheme('dark', false);

const callbacks = new Map();
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const realNow = Date.now;
let now = 100000;
// Drive the actual lifecycle callbacks on a deterministic clock without leaving live intervals.
globalThis.setInterval = (fn, ms, ...args) => {
  const token = { unref() { return token; } };
  callbacks.set(token, { fn: () => fn(...args), ms, due: now + ms });
  return token;
};
globalThis.clearInterval = token => { callbacks.delete(token); };
Date.now = () => now;
export function advance(milliseconds) {
  now += milliseconds;
  for (const [token, callback] of [...callbacks]) {
    if (callbacks.has(token) && now >= callback.due) {
      callback.due = now + callback.ms;
      callback.fn();
    }
  }
}
export function restoreClock() {
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  Date.now = realNow;
}

const factories = { bash: createBashToolDefinition, edit: createEditToolDefinition,
  write: createWriteToolDefinition, read: createReadToolDefinition };
export function definitions(variant, services = {}) {
  const renderCache = variant === 'after' ? new ToolRenderCache(services.cacheBudget) : undefined;
  const tools = new Map();
  const events = new Map();
  if (variant === 'native') {
    for (const [name, factory] of Object.entries(factories)) tools.set(name, factory(cwd));
  } else {
    (variant === 'before' ? registerBefore : registerAfter)({
      registerTool(tool) { tools.set(tool.name, tool); },
      on(event, callback) {
        const handlers = events.get(event) ?? [];
        handlers.push(callback);
        events.set(event, handlers);
      },
    }, undefined, { ...services, renderCache });
  }
  const context = { mode: 'tui', sessionManager: { buildContextEntries: () => [] } };
  for (const handler of events.get('session_start') ?? []) handler({ reason: 'startup' }, context);
  const rows = [];
  return {
    stats: () => renderCache?.stats(),
    declareBashGroup(count) {
      const message = { role: 'assistant', content: Array.from({ length: count }, (_, index) => ({
        type: 'toolCall', id: `bench-${rows.length + index}`, name: 'bash', arguments: {},
      })) };
      for (const handler of events.get('message_start') ?? []) handler({ message }, { mode: 'tui' });
    },
    reset() { for (const handler of events.get('session_start') ?? []) handler({ reason: 'switch' }, context); },
    row(name, args = {}, ui = { requestRender() {} }) {
      const row = new ToolExecutionComponent(name, `bench-${rows.length}`, args,
        { showImages: false }, tools.get(name), ui, cwd);
      rows.push(row);
      return row;
    },
    dispose() {
      for (const row of rows) {
        if (row.executionStarted && row.isPartial) row.updateResult({ content: [], isError: false });
      }
      for (const handler of events.get('session_shutdown') ?? []) handler();
      rows.length = 0;
    },
  };
}

export function textResult(text, details) {
  return { content: [{ type: 'text', text }], details, isError: false };
}
export const shortOutput = Array.from({ length: 1800 }, (_, index) => `line ${String(index).padStart(4, '0')} completed work`).join('\n');
export const tokenOutput = 'x'.repeat(50 * 1024);
export const code = Array.from({ length: 3000 }, (_, index) => `export const value${index} = ${index};`).join('\n');
export function editFixture(lineCount) {
  const added = Array.from({ length: lineCount }, (_, index) => `export const value${index} = ${index};`);
  return {
    name: 'edit', args: { path: 'fixture.ts', edits: [{ oldText: 'export const oldValue = 1;', newText: added.join('\n') }] },
    result: textResult('Successfully applied edit.', {
      diff: ['-1 export const oldValue = 1;', ...added.map((line, index) => `+${index + 1} ${line}`)].join('\n'),
      patch: ['--- a/fixture.ts', '+++ b/fixture.ts', `@@ -1,1 +1,${lineCount} @@`, '-export const oldValue = 1;',
        ...added.map(line => `+${line}`)].join('\n'),
      firstChangedLine: 1,
    }),
  };
}
export const fixtures = [
  { id: 'bash-short-3', name: 'bash', args: { command: 'printf sample' }, result: textResult('one\ntwo\nthree') },
  { id: 'bash-lines-1800', name: 'bash', args: { command: 'pnpm test' }, result: textResult(shortOutput) },
  { id: 'bash-token-50k', name: 'bash', args: { command: 'printf large-token' }, result: textResult(tokenOutput) },
  { id: 'bash-cjk-50k', name: 'bash', args: { command: 'printf unicode' }, result: textResult('中文'.repeat(8533)) },
  { id: 'write-code-50k', name: 'write', args: { path: 'fixture.ts', content: code.slice(0, 50 * 1024) }, result: textResult('Successfully wrote file.') },
  { id: 'edit-1000', ...editFixture(1000) },
  { id: 'edit-10000', ...editFixture(10000) },
];

export function restoreRow(definitions, fixture, expanded, ui) {
  const row = definitions.row(fixture.name, fixture.args, ui);
  row.setExpanded(expanded);
  // A restored result already supplies the edit preview. Do not schedule an unrelated disk preview.
  row.updateResult(fixture.result);
  row.setArgsComplete();
  return row;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
export function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}
export function cpuMilliseconds(start) {
  const usage = process.cpuUsage(start);
  return (usage.user + usage.system) / 1000;
}
export function save(name, data) {
  if (process.env.PI_PERF_PROFILE === 'product') name = name.replace('results-', 'results-product-');
  fs.writeFileSync(path.join(runDirectory, name), JSON.stringify(data, null, 2) + '\n');
  return path.relative(directory, path.join(runDirectory, name));
}
