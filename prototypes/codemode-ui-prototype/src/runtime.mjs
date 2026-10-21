import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CallStore } from './model.mjs';
import { LAYOUTS, renderRow, renderInspector } from './renderers.mjs';
import { SCENARIOS, scriptFor } from './fixtures.mjs';

const root = process.env.CODEMODE_UI_ROOT;
if (!root) throw new Error('Start with pnpm run prototype:codemode-ui.');
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('Network disabled in codemode UI prototype.'); };
const sdk = await import('@earendil-works/pi-coding-agent');
const ai = await import('@earendil-works/pi-ai');
const { matchesKey, visibleWidth, truncateToWidth } = await import('@earendil-works/pi-tui');
const codexUi = (await import(pathToFileURL(join(root, 'runtime/codex-ui/index.js')))).default;
const workspace = join(root, 'workspace');
const smoke = process.argv.includes('--smoke');
const store = new CallStore();
const nativeTools = new Map();
const childViews = new Map();
const redraw = new Map();
let layout = Number(process.argv[process.argv.indexOf('--layout') + 1]) || 6;
if (layout < 1 || layout > 6) throw new Error('Layout must be 1 through 6.');
let serial = 0;
let queued = false;
let releaseHeld;
let allowedScript;
const faux = ai.fauxProvider({ provider: 'openai-codex', tokensPerSecond: 3000, tokenSize: { min: 16, max: 16 } });
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const guide = 'Codemode UI · OFFLINE FIXTURES · Real QuickJS\n/layout 1..6: Compact / Tree / Flat / Inspector / Outcome / Hybrid\n/play success|partial|error|running|many|empty · /finish · /stop\nCtrl+O: expand · /inspect: Calls / Script / Output\n/theme light|codex-pi · /guide · /quit';
const text = value => ({ content: [{ type: 'text', text: value }], details: {} });
store.listeners.add(() => { for (const invalidate of redraw.values()) invalidate(); });

async function resetFixture() {
  await writeFile(join(workspace, 'package.json'), '{"name":"codemode-fixture","scripts":{"test":"fixture-only"}}\n');
  await writeFile(join(workspace, '配置.ts'), 'export const enabled = false;\n');
}
function prepareRun(scenario) {
  allowedScript = scriptFor(scenario);
  const id = `codemode-fixture-${++serial}`;
  faux.setResponses([
    ai.fauxAssistantMessage([
      { type: 'toolCall', id: `context-${serial}`, name: 'read', arguments: { path: 'package.json' } },
      { type: 'toolCall', id, name: 'codemode', arguments: { code: allowedScript } },
    ], { stopReason: 'toolUse' }),
    ai.fauxAssistantMessage(`Playback complete: ${scenario}. Change /layout 1..6 to compare the same execution.`),
  ]);
  return id;
}

function nativeChild(call, width, expanded, theme) {
  const definition = nativeTools.get(call.name);
  if (!definition?.renderCall || !call.result) return undefined;
  let view = childViews.get(call.id);
  if (!view) { view = { state: {} }; childViews.set(call.id, view); }
  const context = { toolCallId: call.id, state: view.state, args: call.args, cwd: workspace, executionStarted: true, argsComplete: true,
    isPartial: call.status === 'running', expanded, showImages: false, isError: ['error', 'cancelled'].includes(call.status), durationMs: call.durationMs, outputPad: 0, invalidate: () => {} };
  view.call = definition.renderCall(call.args, theme, { ...context, lastComponent: view.call });
  view.result = definition.renderResult?.(call.result, { expanded, isPartial: context.isPartial }, theme, { ...context, lastComponent: view.result });
  return [...(view.call?.render(width) ?? []), ...(view.result?.render(width) ?? [])];
}

const extension = pi => {
  const proxy = new Proxy(pi, { get(target, key) {
    // Keep the six-way design comparison independent of the adopted production renderer.
    if (key === 'registerToolRenderer') return resolver => pi.registerToolRenderer((name, next) => name === 'codemode' ? next() : resolver(name, next));
    if (key === 'registerCommand') return (name, options) => { if (name !== 'inspect') pi.registerCommand(name, options); };
    if (key === 'registerTool') return definition => {
      nativeTools.set(definition.name, definition);
      pi.registerTool({ ...definition, execute: async (id, args, signal, onUpdate, ctx) => {
        assert.equal(resolve(ctx.cwd), resolve(workspace));
        if (definition.name === 'read') {
          assert.ok(['package.json', '配置.ts'].includes(args.path));
          await delay(smoke ? 1 : 250, undefined, { signal });
          return definition.execute(id, args, signal, onUpdate, ctx);
        }
        if (definition.name === 'edit') {
          assert.deepEqual(args, { path: '配置.ts', edits: [{ oldText: 'false', newText: 'true' }] });
          return definition.execute(id, args, signal, onUpdate, ctx);
        }
        if (definition.name === 'bash') {
          assert.ok(['fixture-test-pass', 'fixture-test-fail', 'fixture-hold'].includes(args.command));
          onUpdate?.(text('Fixture runner: checking configuration…'));
          if (args.command === 'fixture-hold') await new Promise((done, reject) => {
            const abort = () => { releaseHeld = undefined; reject(new Error('Command aborted')); };
            releaseHeld = () => { signal?.removeEventListener('abort', abort); releaseHeld = undefined; done(); };
            if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
          });
          else await delay(smoke ? 5 : 1400, undefined, { signal });
          if (args.command === 'fixture-test-fail') throw new Error('Fixture assertion failed\n\nCommand exited with code 1');
          return { ...text('42 tests passed · offline fixture'), structuredContent: { output: '42 tests passed', truncated: false, exit_code: 0, wall_time_seconds: 1.4 } };
        }
        throw new Error('Writes outside the named fixture are disabled.');
      } });
    };
    return Reflect.get(target, key);
  } });
  codexUi(proxy);
  // This gate also protects the real QuickJS executor from arbitrary terminal input.
  pi.on('tool_call', event => {
    if (event.toolName === 'codemode' && event.input.code !== allowedScript) return { block: true, reason: 'Only named fixture scripts are allowed.' };
  });
  for (const event of ['tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'message_end']) pi.on(event, value => store.observe(value));
  pi.registerToolRenderer((name, next) => name !== 'codemode' ? next() : {
    renderShell: 'self',
    renderCall(args, theme, context) {
      const row = store.ensure(context.toolCallId, args.code);
      redraw.set(row.id, context.invalidate);
      const component = context.lastComponent ?? { invalidate() {}, render() { return []; } };
      component.render = width => renderRow(row, { layout, expanded: context.expanded, theme, width, nativeChild });
      return component;
    },
    renderResult(result, options, _theme, context) {
      const row = store.get(context.toolCallId);
      if (!row?.startedAt) store.restore(context.toolCallId, context.args.code, result, context.isError);
      return { render: () => [], invalidate() {} };
    },
  });
  async function play(scenario, ctx) {
    if (!SCENARIOS.includes(scenario)) { ctx.ui.notify(guide, 'info'); return; }
    if (queued || !ctx.isIdle()) { ctx.ui.notify('Playback active. Use /finish or /stop.', 'warning'); return; }
    queued = true;
    try { await resetFixture(); prepareRun(scenario); pi.sendUserMessage(`Offline codemode fixture: ${scenario}`); }
    finally { queued = false; }
  }
  pi.registerCommand('play', { description: 'Replay an offline codemode scenario', handler: async (args, ctx) => play(args.trim() || 'partial', ctx) });
  pi.registerCommand('layout', { description: 'Switch all codemode rows to layout 1 through 6', handler: async (args, ctx) => {
    const value = Number(args.trim());
    if (!Number.isInteger(value) || value < 1 || value > 6) { ctx.ui.notify(guide, 'info'); return; }
    layout = value; childViews.clear(); store.notify();
    ctx.ui.setStatus('codemode-layout', `Layout ${layout}: ${LAYOUTS[layout - 1]}`);
    ctx.ui.notify(`Layout ${layout}: ${LAYOUTS[layout - 1]}`, 'info');
  } });
  pi.registerCommand('finish', { description: 'Complete the held fixture', handler: async (_args, ctx) => {
    if (releaseHeld) releaseHeld(); else ctx.ui.notify('No held fixture. /play running first.', 'info');
  } });
  pi.registerCommand('stop', { description: 'Cancel the active real codemode script', handler: async (_args, ctx) => {
    const row = store.latest();
    if (row?.status === 'running') { row.stopRequested = true; ctx.abort(); }
    else ctx.ui.notify('No running script.', 'info');
  } });
  pi.registerCommand('inspect', { description: 'Inspect the latest codemode execution', handler: async (_args, ctx) => {
    const row = store.latest();
    if (!row) return;
    await ctx.ui.custom((tui, theme, _keys, done) => {
      let tab = 'Calls', selected = 0, scroll = 0;
      const refresh = () => tui.requestRender();
      store.listeners.add(refresh);
      return {
        invalidate() {}, dispose() { store.listeners.delete(refresh); },
        render(width) {
          const inner = Math.max(1, width - 4);
          const content = renderInspector(row, { theme, width: inner, height: Math.max(4, Math.min(30, tui.terminal.rows - 8)), selected, tab, scroll, nativeChild });
          const border = theme.fg('borderMuted', `┌${'─'.repeat(Math.max(0, width - 2))}┐`);
          const body = content.map(line => theme.bg('toolPendingBg', `│ ${line}${' '.repeat(Math.max(0, inner - visibleWidth(line)))} │`));
          return [border, ...body, theme.fg('borderMuted', `└${'─'.repeat(Math.max(0, width - 2))}┘`)].map(line => truncateToWidth(line, width));
        },
        handleInput(data) {
          if (matchesKey(data, 'escape')) { done(); return; }
          if (matchesKey(data, 'tab')) { tab = ['Calls', 'Script', 'Output'][(['Calls', 'Script', 'Output'].indexOf(tab) + 1) % 3]; scroll = 0; }
          if (matchesKey(data, 'down')) { selected = Math.min(row.calls.length - 1, selected + 1); scroll = 0; }
          if (matchesKey(data, 'up')) { selected = Math.max(0, selected - 1); scroll = 0; }
          if (matchesKey(data, 'pageDown')) scroll += 5;
          if (matchesKey(data, 'pageUp')) scroll = Math.max(0, scroll - 5);
          tui.requestRender();
        },
      };
    }, { overlay: true, overlayOptions: { width: '95%', maxHeight: '90%', anchor: 'center' } });
  } });
  pi.registerCommand('guide', { description: 'Show prototype controls', handler: async (_args, ctx) => ctx.ui.notify(guide, 'info') });
  pi.registerCommand('theme', { description: 'Switch prototype theme', handler: async (args, ctx) => {
    if (['light', 'codex-pi'].includes(args.trim())) { childViews.clear(); ctx.ui.setTheme(args.trim()); store.notify(); }
  } });
  pi.on('session_start', (_event, ctx) => {
    pi.setActiveTools([...new Set([...pi.getActiveTools(), 'codemode'])]);
    if (ctx.mode === 'tui') { ctx.ui.setToolsExpanded(false); ctx.ui.setStatus('codemode-layout', `Layout ${layout}: ${LAYOUTS[layout - 1]}`); }
  });
  pi.on('input', (event, ctx) => {
    if (event.source === 'extension') return { action: 'continue' };
    ctx.ui.notify('Offline prototype: use /play or /guide.', 'info'); return { action: 'handled' };
  });
  pi.on('user_bash', () => ({ result: { output: 'Shell disabled in prototype.', exitCode: 0, cancelled: false, truncated: false } }));
  pi.on('session_before_compact', () => ({ cancel: true }));
  pi.on('session_shutdown', () => { releaseHeld?.(); redraw.clear(); childViews.clear(); });
};

const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, 'agent'), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ quietStartup: true, theme: 'codex-pi', defaultTools: ['+codemode'], retry: { enabled: false }, compaction: { enabled: false }, terminal: { showImages: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalThemePaths: [join(root, 'runtime/codex-pi.json')], systemPromptOverride: () => 'Offline UI fixture only', extensionFactories: [sdk.createCodemodeExtension({ models: false }), extension] },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: 'builtin' }), services, diagnostics: services.diagnostics };
};
const sessions = sdk.SessionManager.create(workspace, join(root, 'sessions'));
sessions.appendMessage({ role: 'user', content: 'Compare six codemode layouts in the real terminal.', timestamp: Date.now() });
sessions.appendMessage({ ...ai.fauxAssistantMessage(guide), timestamp: Date.now() });
const runtime = await sdk.createAgentSessionRuntime(create, { cwd: workspace, agentDir: join(root, 'agent'), sessionManager: sessions });
try {
  if (smoke) {
    await runtime.session.bindExtensions({});
    // Extension input gating intentionally accepts only extension-origin prompts.
    for (const scenario of ['success', 'partial', 'error', 'many', 'empty']) {
      await resetFixture();
      const id = prepareRun(scenario);
      await runtime.session.prompt(`Offline fixture: ${scenario}`, { source: 'extension' });
      const row = store.get(id);
      assert.ok(row, `Missing real codemode event for ${scenario}`);
      assert.equal(row.status, scenario === 'error' ? 'failed' : 'completed', row.output);
      if (['partial', 'error'].includes(scenario)) {
        assert.ok(row.calls.some(call => call.status === 'error'), JSON.stringify(row));
        assert.match(await readFile(join(workspace, '配置.ts'), 'utf8'), /true/);
      }
      if (scenario === 'many') assert.equal(row.calls.length, 24, JSON.stringify(row.calls.map(({ id, name, status }) => ({ id, name, status }))));
      if (scenario === 'empty') assert.equal(row.calls.length, 0);
      assert.ok(runtime.session.messages.some(message => message.role === 'toolResult' && message.toolCallId === id));
      console.log(`PASS real QuickJS: ${scenario}, ${row.calls.length} calls, ${row.status}`);
    }
  } else {
    await new sdk.InteractiveMode(runtime, { migratedProviders: [], initialMessage: '/play partial', tuiMode: process.argv.includes('--fullscreen') ? 'fullscreen' : 'regular' }).run();
  }
} finally {
  releaseHeld?.(); await runtime.session.abort(); runtime.session.dispose();
  assert.equal(networkAttempts, 0, 'Prototype must not attempt network access');
}
