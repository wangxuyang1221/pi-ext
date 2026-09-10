import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.env.GOAL_UI_ROOT);
const phase = process.env.GOAL_UI_PHASE;
const codex = process.env.GOAL_UI_CODEX === "1";
const packageRoot = resolve(process.argv[2]);
for (const folder of ["home", "agent", "tmp", "sessions"]) await mkdir(join(root, folder), { recursive: true });
Object.assign(process.env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_OFFLINE: "1", PI_TELEMETRY: "0" });
delete process.env.PI_SUBAGENT_PARENT;
const log = (event, data = {}) => appendFileSync(join(root, `events-${phase}.jsonl`), JSON.stringify({ event, ...data }) + "\n");
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network disabled by goal UI fixture"); };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGPk0Y1iIAUwkaSaYVQDcYCJSHVwMKqBGEByKAEA9NsAs1GX4RQAAAAASUVORK5CYII=", "base64");
// Intercept every native clipboard operation before InteractiveMode loads. No
// real clipboard method can run, including unexpected text fallback or copy.
const { clipboard } = await import(pathToFileURL(join(packageRoot, "dist/utils/clipboard-native.js")).href);
assert.ok(clipboard, "Native clipboard test adapter must be available");
for (const name of Object.keys(clipboard)) if (typeof clipboard[name] === "function") clipboard[name] = () => { throw new Error(`Forbidden real clipboard operation: ${name}`); };
clipboard.hasImage = () => true;
clipboard.getImageBinary = async () => { log("fixture_clipboard_image"); return png; };
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(packageRoot, "../pi-ai/dist/index.js")).href);
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const { GoalContent } = await import("../dist/content.js");
const { default: codexUI } = await import("../../codex-ui/dist/index.js");
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
const store = new GoalStore(join(root, "goals"));
const content = new GoalContent(join(store.root, "content"), join(root, "tmp"));
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 100000 });
faux.setResponses([
  ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "complete" }, id: "complete" }, { stopReason: "toolUse" }),
  ai.fauxAssistantMessage("Offline goal UI fixture completed"),
]);
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false });
modelRuntime.registerNativeProvider(faux.provider);
let mode;
let originalEditor;
let originalFooter;
const observer = pi => {
  registerGoal(pi, store);
  pi.on("session_start", (_event, ctx) => log("ready", { version, codex, phase, mode: ctx.mode }));
  pi.on("agent_settled", () => log("settled", { calls: faux.state.callCount }));
  pi.registerCommand("probe-begin", { description: "Record original UI components", handler: async (_args, ctx) => {
    originalEditor = mode.editor;
    originalFooter = mode.customFooter ?? mode.footer;
    assert.ok(originalEditor && originalFooter);
    log("begin", { editor: originalEditor.constructor.name, footer: originalFooter.constructor.name });
    ctx.ui.notify("UI baseline recorded", "info");
  } });
  pi.registerCommand("probe-exit", { description: "Verify goal content and close fixture", handler: async (_args, ctx) => {
    const saved = (await store.records())[0];
    assert.equal(saved.goal.status, "paused");
    assert.ok(saved.goal.content);
    assert.ok([...saved.goal.objective].length <= 4000);
    const expanded = await content.expand(saved.goal);
    assert.ok(expanded.startsWith("GOAL_LONG_BEGIN"));
    assert.ok([...expanded].length > 4000);
    const attachments = await content.attachments(saved.goal);
    assert.equal(attachments.length, 1);
    assert.deepEqual(await readFile(attachments[0]), png);
    const result = await sdk.createReadTool(root).execute("read-persisted-image", { path: attachments[0] });
    assert.ok(result.content.some(part => part.type === "image"), "Native read must decode the copied image");
    assert.equal(mode.editor, originalEditor, "Goal dialogs must restore the same main editor");
    assert.equal(mode.customFooter ?? mode.footer, originalFooter, "Goal must not replace the footer");
    assert.equal(networkAttempts, 0);
    if (phase === "create") {
      const files = await import("node:fs/promises");
      const source = (await files.readdir(join(root, "tmp"))).filter(name => name.startsWith("pi-clipboard-"));
      assert.equal(source.length, 1, "Actual Pi paste must create one temporary image");
      await unlink(join(root, "tmp", source[0]));
      await writeFile(join(root, "saved.json"), JSON.stringify({ sessionFile: ctx.sessionManager.getSessionFile(), goal: saved.goal, expanded, attachments }));
    } else {
      const before = JSON.parse(await readFile(join(root, "saved.json"), "utf8"));
      assert.equal(saved.goal.goalId, before.goal.goalId);
      assert.equal(saved.goal.tokensUsed, before.goal.tokensUsed);
      assert.ok(expanded.includes("EDITED_AFTER_REOPEN"));
      assert.equal(await content.expand(before.goal), before.expanded);
      assert.notEqual(saved.goal.content.bundleId, before.goal.content.bundleId);
      assert.equal(faux.state.callCount, 0);
    }
    const footer = originalFooter.render(120);
    assert.ok(footer.join("\n").includes("Goal: paused"));
    log("result", { version, codex, phase, goal: saved.goal, expandedLength: [...expanded].length, attachments, nativeReadImage: true, sameEditor: true, sameFooter: true, footer, calls: faux.state.callCount, networkAttempts });
    ctx.shutdown();
  } });
};
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => "Offline UI fixture", extensionFactories: [...(codex ? [codexUI] : []), observer] } });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), tools: ["read", "get_goal", "create_goal", "update_goal"] }), services, diagnostics: services.diagnostics };
};
const sessionManager = phase === "create" ? sdk.SessionManager.create(root, join(root, "sessions")) : sdk.SessionManager.open(JSON.parse(await readFile(join(root, "saved.json"), "utf8")).sessionFile, join(root, "sessions"));
const runtime = await sdk.createAgentSessionRuntime(factory, { cwd: root, agentDir: join(root, "agent"), sessionManager });
mode = new sdk.InteractiveMode(runtime, { migratedProviders: [] });
const showEditor = mode.showExtensionEditor.bind(mode);
mode.showExtensionEditor = (title, prefill) => {
  log("native_editor", { title, prefill, length: [...prefill].length });
  return showEditor(title, prefill);
};
await mode.run();
