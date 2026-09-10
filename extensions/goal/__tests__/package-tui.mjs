import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.env.GOAL_PACKAGE_EVIDENCE);
const sdkRoot = resolve(process.argv[2]);
const distribution = resolve(process.argv[3]);
for (const folder of ["home", "tmp", "agent", "sessions"]) await mkdir(join(root, folder), { recursive: true });
Object.assign(process.env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_OFFLINE: "1", PI_TELEMETRY: "0" });
for (const key of Object.keys(process.env)) if (key.startsWith("PI_SUBAGENT_")) delete process.env[key];
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Package TUI forbids network"); };
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")));
const ai = await import(pathToFileURL(resolve(sdkRoot, "../pi-ai/dist/index.js")));
const version = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8")).version;
const manifest = JSON.parse(await readFile(join(distribution, "package.json"), "utf8"));
const log = (event, data = {}) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ event, ...data }) + "\n");
const provider = ai.fauxProvider({ provider: "offline-package-ui" });
const models = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false });
models.registerNativeProvider(provider.provider);
let mode, runtime;
const observer = pi => {
  pi.on("session_start", () => log("ready", { version }));
  pi.registerCommand("package-verify", { description: "Check installed package UI", handler: async (_args, ctx) => {
    const extensions = runtime.session.resourceLoader.getExtensions();
    assert.deepEqual(extensions.errors, []);
    for (const entry of manifest.pi.extensions) assert.ok(extensions.extensions.some(extension => extension.path === resolve(distribution, entry)), `Missing package entry ${entry}`);
    const tools = pi.getAllTools().map(tool => tool.name);
    for (const name of ["get_goal", "create_goal", "update_goal", "subagent_spawn", "subagent_close"]) assert.ok(tools.includes(name));
    assert.equal(mode.editor.constructor.name, "CodexEditor");
    assert.equal(mode.customFooter.constructor.name, "CodexFooter");
    const footer = mode.customFooter.render(120);
    assert.ok(footer.join("\n").includes("Goal: paused"));
    assert.equal(provider.state.callCount, 0);
    assert.equal(networkAttempts, 0);
    log("result", { passed: true, version, pid: process.pid, distribution, tools, footer, editor: mode.editor.constructor.name, footerType: mode.customFooter.constructor.name, entries: manifest.pi.extensions, networkAttempts });
    ctx.shutdown();
  } });
};
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime: models,
    settingsManager: sdk.SettingsManager.create(cwd, join(root, "agent")),
    resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noContextFiles: true, extensionFactories: [observer] } });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: provider.getModel() }), services, diagnostics: services.diagnostics };
};
runtime = await sdk.createAgentSessionRuntime(factory, { cwd: root, agentDir: join(root, "agent"), sessionManager: sdk.SessionManager.create(root, join(root, "sessions")) });
mode = new sdk.InteractiveMode(runtime, { migratedProviders: [] });
await mode.run();
