// Offline provider only. Tools, QuickJS, hooks, MCP stdio, persistence and UI are real.
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.env.CODEMODE_UI_ROOT;
if (!root) throw new Error('Use codemode-cli.mjs');
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('Network disabled in codemode acceptance'); };
const sdk = await import('@earendil-works/pi-coding-agent');
const ai = await import('@earendil-works/pi-ai');
const codexUi = (await import('../../dist/index.js')).default;
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const cwd = join(root, 'workspace');
const resume = process.env.CODEMODE_RESUME === '1';
const smoke = process.argv.includes('--smoke');
const faux = ai.fauxProvider({ provider: 'openai-codex', tokensPerSecond: 8000, tokenSize: { min: 32, max: 32 } });
const models = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
models.registerNativeProvider(faux.provider);
let serial = 0, code, busy = false, savedLeaf;
const events = [];
const scenarios = ['success', 'partial', 'error', 'running', 'timeout', 'permission', 'nested', 'mcp', 'many', 'empty'];
const scriptFor = scenario => {
  if (scenario === 'empty') return 'text("No calls required");';
  if (scenario === 'many') return 'await Promise.allSettled(Array.from({length:24}, () => tools.read({path:"package.json"}))); text("Read 24 files");';
  if (scenario === 'permission') return 'await Promise.allSettled([tools.bash({command:"printf forbidden"})]); text("Permission failure handled");';
  if (scenario === 'nested') return 'text(await tools.fixture_outer({}));';
  if (scenario === 'mcp') return 'text(await tools.mcp__local__echo({text:"LOCAL-MCP-RESULT"}));';
  if (scenario === 'timeout') return '// @options: {"timeout_ms":300}\nawait tools.bash({command:"sleep 3"});';
  if (scenario === 'running') return 'await tools.bash({command:"printf RUNNING-MARKER; sleep 20"});';
  return [
    'await Promise.allSettled([tools.read({path:"package.json"}),tools.read({path:"配置.ts"})]);',
    'await tools.edit({path:"配置.ts",edits:[{oldText:"false",newText:"true"}]});',
    'await tools.write({path:"created.txt",content:"created by real write\\n"});',
    `await Promise.allSettled([tools.bash({command:${JSON.stringify(scenario === 'success' ? "printf '42 tests passed\\n'" : "printf 'fixture failure\\n'; exit 7")}})]);`,
    'text("PAYLOAD-FROM-SCRIPT");',
    ...(scenario === 'error' ? ['throw new Error("Post-processing failed; earlier edit remains applied");'] : []),
  ].join('\n');
};
async function prepare(scenario) {
  assert.ok(scenarios.includes(scenario));
  await writeFile(join(cwd, 'package.json'), '{"name":"acceptance"}\n');
  await writeFile(join(cwd, '配置.ts'), 'export const enabled = false;\n');
  code = scriptFor(scenario);
  const id = `production-${++serial}-${Date.now()}`;
  faux.setResponses([ai.fauxAssistantMessage([{ type: 'toolCall', name: 'codemode', id, arguments: { code } }], { stopReason: 'toolUse' }), ai.fauxAssistantMessage(`ACCEPTANCE-DONE: ${scenario}`)]);
  return id;
}
const extension = pi => {
  codexUi(pi);
  pi.registerMcpServer('local', { command: process.execPath, args: [join(repo, 'extensions/mcp/__tests__/fixtures/stdio-mcp-server.mjs')], exposure: 'codemode' });
  pi.registerTool({ name: 'fixture_outer', label: 'Nested fixture', description: 'Real nested tool calls', parameters: { type: 'object', properties: {} },
    execute: async (_id, _args, signal, _update, ctx) => (await ctx.executeTool('read', { path: 'package.json' }, { signal })).result });
  pi.on('tool_call', event => {
    if (event.toolName === 'codemode') return event.input.code === code ? undefined : { block: true, reason: 'Only fixture scripts are allowed' };
    if (event.toolName === 'bash' && event.input.command === 'printf forbidden') return { block: true, reason: 'Fixture permission denied' };
    if (['read', 'write', 'edit'].includes(event.toolName) && !['package.json', '配置.ts', 'created.txt'].includes(event.input.path)) return { block: true, reason: 'Outside fixture workspace' };
  });
  for (const event of ['tool_execution_start', 'tool_execution_update', 'tool_execution_end']) pi.on(event, value => events.push(value));
  pi.on('session_start', (_event, ctx) => { pi.setActiveTools([...new Set([...pi.getActiveTools(), 'codemode'])]); if (ctx.mode === 'tui') ctx.ui.setToolsExpanded(false); });
  pi.registerCommand('play', { description: 'Run an offline acceptance scenario', async handler(args, ctx) {
    const scenario = args.trim() || 'partial';
    if (busy || !ctx.isIdle() || !scenarios.includes(scenario)) return;
    busy = true; try { await prepare(scenario); pi.sendUserMessage(`Acceptance fixture: ${scenario}`); } finally { busy = false; }
  } });
  pi.registerCommand('stop', { description: 'Abort real execution', handler: async (_args, ctx) => ctx.abort() });
  pi.registerCommand('fixture-tree', { description: 'Switch real history branches', async handler(args, ctx) {
    if (args.trim() === 'cut') {
      savedLeaf = ctx.sessionManager.getLeafId();
      const target = ctx.sessionManager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user');
      await ctx.navigateTree(target.id, { summarize: false });
      ctx.ui.notify('TREE-CUT', 'info');
    } else { await ctx.navigateTree(savedLeaf, { summarize: false }); ctx.ui.notify('TREE-BACK', 'info'); }
  } });
  pi.registerCommand('fixture-restored', { description: 'Confirm process restart', handler: async (_args, ctx) => ctx.ui.notify('PRODUCTION-RESTORED', 'info') });
  pi.registerCommand('theme', { description: 'Change test theme', handler: async (args, ctx) => { if (['light', 'codex-pi'].includes(args.trim())) ctx.ui.setTheme(args.trim()); } });
  pi.on('session_compact', (_event, ctx) => { if (ctx.mode === 'tui') ctx.ui.notify('COMPACTED', 'info'); });
  pi.on('session_before_compact', (event, ctx) => {
    const target = ctx.sessionManager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'user');
    return { compaction: { summary: 'Codemode acceptance compacted', firstKeptEntryId: target.id, tokensBefore: event.preparation.tokensBefore } };
  });
  pi.on('input', (event, ctx) => { if (event.source === 'extension') return { action: 'continue' }; ctx.ui.notify('Use /play for offline acceptance', 'info'); return { action: 'handled' }; });
  pi.on('user_bash', () => ({ result: { output: 'User shell disabled', exitCode: 0, cancelled: false, truncated: false } }));
};
const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, 'agent'), modelRuntime: models,
    settingsManager: sdk.SettingsManager.inMemory({ quietStartup: true, theme: 'codex-pi', defaultTools: ['+codemode'], retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 128 }, terminal: { showImages: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalThemePaths: [join(repo, 'themes/codex-pi.json')],
      systemPromptOverride: () => 'Offline acceptance only', extensionFactories: [sdk.createCodemodeExtension({ models: false }), sdk.createMcpExtension(), extension] },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: 'builtin' }), services, diagnostics: services.diagnostics };
};
const sessions = resume ? sdk.SessionManager.continueRecent(cwd, join(root, 'sessions')) : sdk.SessionManager.create(cwd, join(root, 'sessions'));
if (!resume) sessions.appendMessage({ role: 'user', content: 'Inspect the production codemode call tree.', timestamp: Date.now() });
const runtime = await sdk.createAgentSessionRuntime(create, { cwd, agentDir: join(root, 'agent'), sessionManager: sessions });
try {
  if (smoke) {
    await runtime.session.bindExtensions({});
    for (const scenario of scenarios.filter(item => item !== 'running')) {
      const id = await prepare(scenario);
      await runtime.session.prompt(`Acceptance: ${scenario}`, { source: 'extension' });
      const result = runtime.session.messages.find(message => message.role === 'toolResult' && message.toolCallId === id);
      assert.ok(result, `Missing parent result: ${scenario}`);
      assert.equal(result.isError, ['error', 'timeout'].includes(scenario), JSON.stringify(result));
      if (scenario === 'partial' || scenario === 'permission') assert.ok(result.nestedCalls.calls.some(call => call.status === 'error'));
      if (scenario === 'nested') assert.ok(result.nestedCalls.calls.some(call => call.id === `${id}/1/1`));
      if (scenario === 'mcp') assert.match(JSON.stringify(result.content), /LOCAL-MCP-RESULT/);
      if (scenario === 'many') assert.equal(result.nestedCalls.calls.length, 24);
      if (scenario === 'error') assert.match(await readFile(join(cwd, '配置.ts'), 'utf8'), /true/);
      console.log(`PASS production real execution: ${scenario}`);
    }
    assert.ok(events.some(event => event.parentToolCallId));
  } else await new sdk.InteractiveMode(runtime, { migratedProviders: [], initialMessage: resume ? '/fixture-restored' : '/play partial', tuiMode: process.argv.includes('--fullscreen') ? 'fullscreen' : 'regular' }).run();
} finally {
  await runtime.session.abort(); await runtime.dispose();
  assert.equal(networkAttempts, 0);
}
