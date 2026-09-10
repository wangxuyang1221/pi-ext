import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSdk, offlineModels, usage, cacheOnly, text, tool } from "./accounting-fixtures.mjs";

const loaded = await loadSdk(process.argv[2]);
const distribution = resolve(process.argv[3]);
const output = resolve(process.argv[4]);
const manifest = JSON.parse(await readFile(join(distribution, "package.json"), "utf8"));
const root = await mkdtemp(resolve(".goal-package-provider-"));
const agentDir = join(root, "agent");
await mkdir(agentDir);
Object.assign(process.env, { HOME: root, TMPDIR: root, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_OFFLINE: "1", PI_TELEMETRY: "0" });
for (const key of Object.keys(process.env)) if (key.startsWith("PI_SUBAGENT_")) delete process.env[key];
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [distribution], compaction: { enabled: false }, retry: { enabled: false }, enableInstallTelemetry: false }));
const { sdk, ai } = loaded;
const themes = await import(pathToFileURL(join(loaded.root, "dist/modes/interactive/theme/theme.js")));
themes.initTheme("dark", false);
const { GoalStore } = await import(pathToFileURL(join(distribution, "extensions/goal/dist/storage.js")));
const store = new GoalStore(join(agentDir, "goals"));
const fixture = await offlineModels(loaded);
const models = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false });
for (const provider of fixture.providers) models.registerNativeProvider(provider);
const results = [], errors = [], notices = [];
let runtime;
try {
  for (const family of ["completions", "responses", "anthropic", "google"]) {
    fixture.setSteps([tool("get_goal", {}, usage()), tool("update_goal", { status: "paused" }), text(cacheOnly)]);
    const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await sdk.createAgentSessionServices({ cwd, agentDir, modelRuntime: models,
        settingsManager: sdk.SettingsManager.create(cwd, agentDir),
        resourceLoaderOptions: { noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
          systemPromptOverride: () => "Offline installed package fixture" },
      });
      return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: fixture.models[family] }), services, diagnostics: services.diagnostics };
    };
    runtime = await sdk.createAgentSessionRuntime(factory, { cwd: root, agentDir, sessionManager: sdk.SessionManager.create(root, join(root, "sessions")) });
    const bind = session => session.bindExtensions({ mode: "tui", uiContext: {
      theme: themes.theme, getAllThemes: () => [], getTheme: () => themes.loadThemeFromPath(join(distribution, "themes/codex-pi.json")), setTheme: () => ({ success: true }),
      notify: (message, level) => notices.push({ message, level }), setStatus() {}, setWidget() {}, setFooter() {}, setHeader() {}, setTitle() {},
      setEditorComponent() {}, getEditorComponent: () => undefined, setEditorText() {}, getEditorText: () => "",
      setWorkingMessage() {}, setWorkingIndicator() {}, setWorkingVisible() {}, confirm: async () => false,
    }, commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), reload: () => runtime.session.reload() }, onError: error => errors.push(error) });
    runtime.setRebindSession(bind); await bind(runtime.session);
    const extensions = runtime.session.resourceLoader.getExtensions();
    assert.deepEqual(extensions.errors, []);
    const paths = extensions.extensions.map(extension => extension.path);
    for (const entry of manifest.pi.extensions) assert.ok(paths.includes(resolve(distribution, entry)), `Installed entry was not loaded: ${entry}`);
    const names = runtime.session.getAllTools().map(t => t.name);
    for (const name of ["get_goal", "create_goal", "update_goal", "subagent_spawn", "subagent_close"]) assert.ok(names.includes(name));
    await runtime.session.prompt(`/goal Installed ${family} goal`);
    await runtime.session.waitForIdle();
    const paused = (await store.records()).find(record => record.ownerSessionId === runtime.session.sessionId);
    assert.equal(paused.goal.status, "paused"); assert.equal(paused.goal.tokensUsed, 7);
    assert.ok(runtime.session.messages.some(message => message.role === "toolResult" && message.toolName === "get_goal" && !message.isError));
    fixture.setSteps([tool("update_goal", { status: "complete" }), text(cacheOnly)]);
    await runtime.session.prompt("/goal resume"); await runtime.session.waitForIdle();
    const complete = await store.read(paused.recordId);
    assert.equal(complete.goal.status, "complete"); assert.equal(complete.goal.tokensUsed, 7);
    assert.deepEqual(runtime.session.messages.filter(message => message.role === "toolResult" && message.isError), []);
    results.push({ family, loadedEntries: paths, tools: names, paused, complete });
    await runtime.dispose(); runtime = undefined;
    fixture.verify();
  }
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({ passed: true, versions: loaded.versions, distribution, pid: process.pid, results, requests: fixture.requests, wire: fixture.wire, errors, notices, networkAttempts: fixture.networkAttempts }, null, 2));
  console.log(`Extracted package passed: ${results.length} native non-Codex families, seven installed entries, ${fixture.requests.length} requests on Pi ${loaded.versions["pi-coding-agent"]}`);
} finally {
  await runtime?.session.abort(); await runtime?.dispose();
  await rm(root, { recursive: true, force: true });
}
