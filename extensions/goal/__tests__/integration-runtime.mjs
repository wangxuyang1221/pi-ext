import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { offlineCodex, rawUsage, textStep } from "./budget-fixtures.mjs";

const root = resolve(process.env.GOAL_INTEGRATION_EVIDENCE);
const sdkRoot = resolve(process.argv[2]);
const distribution = resolve(process.argv[3] ?? ".");
for (const folder of ["home", "tmp", "agent", "sessions"]) await mkdir(join(root, folder), { recursive: true });
Object.assign(process.env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_OFFLINE: "1", PI_TELEMETRY: "0" });
for (const key of Object.keys(process.env)) if (key.startsWith("PI_SUBAGENT_")) delete process.env[key];
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Integration fixture forbids network"); };
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")));
const ai = await import(pathToFileURL(resolve(sdkRoot, "../pi-ai/dist/index.js")));
const adapter = await import(pathToFileURL(resolve(sdkRoot, "../pi-ai/dist/api/openai-codex-responses.js")));
const themes = await import(pathToFileURL(join(sdkRoot, "dist/modes/interactive/theme/theme.js")));
themes.initTheme("dark", false);
const { GoalStore } = await import(pathToFileURL(join(distribution, "extensions/goal/dist/storage.js")));
const { GoalContent } = await import(pathToFileURL(join(distribution, "extensions/goal/dist/content.js")));
const version = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8")).version;
const manifest = JSON.parse(await readFile(join(distribution, "package.json"), "utf8"));
const settingsPath = join(root, "agent/settings.json");
// An installed settings entry is kept, so this also exercises native discovery.
if (!existsSync(settingsPath)) await writeFile(settingsPath, JSON.stringify({ packages: [distribution], compaction: { enabled: false }, retry: { enabled: false }, enableInstallTelemetry: false }));
await writeFile(join(root, "agent/goal.json"), JSON.stringify({ maxGoalTokenBudget: 100 }));
const store = new GoalStore(join(root, "agent/goals"));
const content = new GoalContent(join(store.root, "content"), join(root, "tmp"));
const unsupported = ai.fauxProvider({ provider: "offline-unsupported", tokensPerSecond: 100000 });
let waiting;
const reached = new Promise(resolveReached => { waiting = resolveReached; });
const fixture = offlineCodex(ai, adapter, [
  textStep("First response before interruption", rawUsage(70, 20, 10)),
  textStep("Must be interrupted", null, { wait: signal => new Promise((_, reject) => {
    waiting();
    const abort = () => reject(new Error("Interrupted integration fixture"));
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  }) }),
  textStep("Finish inherited work", rawUsage()),
  textStep("Budget wrap-up", rawUsage(7, 0, 3)),
]);
const models = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false });
models.registerNativeProvider(unsupported.provider);
models.registerNativeProvider(fixture.provider);
const errors = [], notices = [], contexts = [], stages = [];
let runtime, selectedModel = unsupported.getModel(), editorValue;
let suppressAutomatic = true;
let previousEditor;
const original = "INTEGRATION_LONG_OBJECTIVE " + "界😀".repeat(2400);
const observer = pi => {
  pi.on("context", event => { contexts.push(structuredClone(event.messages)); });
};
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime: models,
    settingsManager: sdk.SettingsManager.create(cwd, join(root, "agent")),
    resourceLoaderOptions: { noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
      systemPromptOverride: () => "Offline integration fixture", extensionFactories: [observer] },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: selectedModel }), services, diagnostics: services.diagnostics };
};
const bind = session => {
  const sendCustomMessage = session.sendCustomMessage.bind(session);
  // The pre-reply recovery stage intentionally creates no model request.
  session.sendCustomMessage = (message, options) => suppressAutomatic && message.customType?.startsWith("pi-ext-goal-")
    ? Promise.resolve() : sendCustomMessage(message, options);
  return session.bindExtensions({ mode: "tui", uiContext: {
  theme: themes.theme, getAllThemes: () => [], getTheme: () => themes.loadThemeFromPath(join(distribution, "themes/codex-pi.json")), setTheme: () => ({ success: true }),
  notify: (text, level) => notices.push({ text, level }), setStatus() {}, setWidget() {}, setFooter() {}, setHeader() {}, setTitle() {},
  setEditorComponent() {}, getEditorComponent: () => undefined, setEditorText() {}, getEditorText: () => "",
  setWorkingMessage() {}, setWorkingIndicator() {}, setWorkingVisible() {},
  confirm: async title => title !== "Resume saved goal?",
  select: async (title, choices) => title === "Inherit current goal" ? choices[1] : choices[0],
  editor: async (_title, prefill) => { previousEditor = prefill; return editorValue; },
}, commandContextActions: {
  newSession: options => runtime.newSession(options), switchSession: (path, options) => runtime.switchSession(path, options),
  fork: (id, options) => runtime.fork(id, options), navigateTree: (id, options) => runtime.session.navigateTree(id, options),
  waitForIdle: () => runtime.session.waitForIdle(), reload: () => runtime.session.reload(),
}, onError: error => errors.push(error) });
};
const start = async manager => {
  runtime = await sdk.createAgentSessionRuntime(factory, { cwd: root, agentDir: join(root, "agent"), sessionManager: manager });
  runtime.setRebindSession(bind); await bind(runtime.session);
  const loaded = runtime.session.resourceLoader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  for (const entry of manifest.pi.extensions) assert.ok(loaded.extensions.some(extension => extension.path === resolve(distribution, entry)), `Missing installed entry ${entry}`);
  const tools = runtime.session.getAllTools().map(tool => tool.name);
  for (const tool of ["get_goal", "create_goal", "update_goal", "subagent_spawn", "subagent_close"]) assert.ok(tools.includes(tool));
};
const current = async () => (await store.records()).find(record => record.ownerSessionId === runtime.session.sessionId);
try {
  await start(sdk.SessionManager.create(root, join(root, "sessions")));
  await runtime.session.prompt(`/goal ${original}`);
  assert.equal(await current(), undefined);
  assert.ok(runtime.session.getActiveToolNames().includes("get_goal"));
  assert.ok(!runtime.session.getActiveToolNames().includes("create_goal"));
  selectedModel = fixture.model;
  await runtime.session.setModel(fixture.model);
  await runtime.session.prompt(`/goal ${original}`);
  const first = await current();
  assert.equal(existsSync(runtime.session.sessionFile), false);
  assert.equal(first.goal.tokenBudget, 100);
  assert.equal(await content.expand(first.goal), original);
  assert.equal(fixture.calls(), 0);
  await runtime.dispose();
  await start(sdk.SessionManager.create(root, join(root, "sessions")));
  await runtime.session.prompt("/goal-recover");
  const recovered = await current();
  assert.equal(recovered.recordId, first.recordId);
  assert.notEqual(recovered.ownerSessionId, first.ownerSessionId);
  assert.deepEqual(recovered.goal, first.goal);
  assert.equal((await store.records()).length, 1);
  assert.equal(fixture.calls(), 0);
  stages.push("pre-reply-long-content-recovery-with-unique-record-and-budget");
  await runtime.session.prompt("/goal pause");
  selectedModel = fixture.model;
  await runtime.session.setModel(fixture.model);
  assert.equal(fixture.calls(), 0);
  suppressAutomatic = false;
  await runtime.session.prompt("/goal resume");
  await reached;
  await runtime.session.abort();
  await runtime.session.waitForIdle();
  const interrupted = await current();
  assert.equal(interrupted.goal.status, "paused");
  assert.equal(interrupted.goal.tokensUsed, 60);
  assert.equal(interrupted.goal.usageIncomplete, true);
  assert.equal(await content.expand(interrupted.goal), original);
  assert.equal(fixture.calls(), 2);
  stages.push("real-adapter-interruption-retains-content-and-observed-budget");
  const sourceFile = runtime.session.sessionFile;
  await runtime.session.prompt("/goal-fork");
  const inherited = await current();
  assert.notEqual(inherited.recordId, interrupted.recordId);
  assert.deepEqual(inherited.goal, interrupted.goal);
  assert.equal(inherited.continuationDeferral, true);
  assert.equal(fixture.calls(), 2);
  editorValue = original + " CHILD_EDIT";
  await runtime.session.prompt("/goal edit");
  assert.equal(previousEditor, original);
  const edited = await current();
  assert.equal(await content.expand(edited.goal), editorValue);
  assert.equal(await content.expand(interrupted.goal), original);
  assert.notEqual(edited.goal.content.bundleId, interrupted.goal.content.bundleId);
  assert.equal(edited.goal.tokensUsed, 60);
  const childFile = runtime.session.sessionFile;
  await runtime.dispose();
  await start(sdk.SessionManager.open(childFile, join(root, "sessions")));
  assert.equal(fixture.calls(), 2);
  assert.equal((await current()).continuationDeferral, true);
  await runtime.session.prompt("/goal resume");
  await runtime.session.waitForIdle();
  const finished = await current();
  assert.equal(finished.goal.status, "budget_limited");
  assert.equal(finished.goal.tokensUsed, 170);
  assert.equal(finished.goal.tokenBudget, 100);
  assert.equal(fixture.calls(), 4);
  assert.equal(contexts.flat().filter(message => message.customType === "pi-ext-goal-budget").length, 1);
  assert.deepEqual(await store.read(interrupted.recordId), interrupted);
  stages.push("content-edit-and-reopen-of-inherited-paused-goal-then-soft-budget-overrun");
  await runtime.switchSession(sourceFile);
  assert.equal((await current()).goal.tokensUsed, 60);
  assert.equal((await current()).goal.status, "paused");
  assert.equal(await content.expand((await current()).goal), original);
  assert.equal(fixture.calls(), 4);
  assert.deepEqual(errors, []);
  assert.equal(networkAttempts, 0);
  assert.equal(unsupported.state.callCount, 0);
  await writeFile(join(root, "results.json"), JSON.stringify({ passed: true, version, distribution, pid: process.pid, stages,
    loadedEntries: manifest.pi.extensions, first, recovered, interrupted, inherited, edited, finished,
    calls: fixture.calls(), networkAttempts, errors, notices, contexts }, null, 2));
  console.log(`Integrated package lifecycle passed on Pi ${version}`);
} finally {
  await runtime?.session.abort(); await runtime?.dispose();
}
