import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(resolve(".goal-runtime-test-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
const sdkRoot = resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(sdkRoot, "../pi-ai/dist/index.js")).href);
const { registerGoal, GOAL_MIRROR } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const version = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8")).version;
const disk = new GoalStore(join(root, "goals"));
const { ModelRuntime, SettingsManager, SessionManager, createAgentSessionServices, createAgentSessionFromServices, createAgentSessionRuntime } = sdk;
const faux = ai.fauxProvider({ provider: "goal-storage-test" });
const modelRuntime = await ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const notices = [];
const errors = [];
let mirrorFailure = false;
let confirm = true;
let select = true;
let runtime;
const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({
    cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [pi => {
        const proxy = new Proxy(pi, { get(target, name) {
          if (name === "appendEntry") return (...args) => { if (mirrorFailure) throw new Error("Injected mirror failure"); return pi.appendEntry(...args); };
          return Reflect.get(target, name);
        } });
        registerGoal(proxy, disk);
      }],
    },
  });
  return { ...await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: "all" }), services, diagnostics: services.diagnostics };
};
const bind = async session => session.bindExtensions({ mode: "tui", uiContext: {
  notify: (text, level) => notices.push({ text, level }),
  confirm: async () => confirm,
  select: async (_title, choices) => select ? choices[0] : undefined,
  setStatus() {}, setWidget() {},
}, commandContextActions: {
  newSession: options => runtime.newSession(options),
  switchSession: (path, options) => runtime.switchSession(path, options),
  fork: (id, options) => runtime.fork(id, options),
  navigateTree: (id, options) => runtime.session.navigateTree(id, options),
  waitForIdle: () => runtime.session.waitForIdle(),
  reload: () => runtime.session.reload(),
}, onError: error => errors.push(error.message) });
async function start(manager) {
  runtime = await createAgentSessionRuntime(createRuntime, { cwd: root, agentDir: join(root, "agent"), sessionManager: manager });
  runtime.setRebindSession(bind);
  await bind(runtime.session);
}
const results = [];
try {
  await start(SessionManager.create(root, join(root, "sessions")));
  const oldId = runtime.session.sessionId;
  const absentPath = runtime.session.sessionFile;
  await runtime.session.prompt("/goal Persist before the first reply");
  assert.equal(existsSync(absentPath), false);
  const first = (await disk.records())[0];
  assert.equal(first.goal.objective, "Persist before the first reply");
  assert.equal(faux.state.callCount, 0);
  await runtime.dispose();
  results.push("pre-reply-authoritative-save");

  await start(SessionManager.create(root, join(root, "sessions")));
  select = false;
  await runtime.session.prompt("/goal-recover");
  assert.deepEqual((await disk.records())[0], first);
  select = true;
  confirm = false;
  await runtime.session.prompt("/goal-recover");
  assert.deepEqual((await disk.records())[0], first);
  confirm = true;
  await runtime.session.prompt("/goal-recover");
  const recovered = (await disk.records())[0];
  assert.equal(recovered.recordId, first.recordId);
  assert.notEqual(recovered.ownerSessionId, oldId);
  assert.equal(recovered.ownerSessionId, runtime.session.sessionId);
  assert.deepEqual(recovered.goal, first.goal);
  await runtime.session.prompt("/goal");
  assert.ok(notices.at(-1).text.includes(first.goal.objective));
  assert.equal(faux.state.callCount, 0);
  results.push("missing-session-recovery-cancellation-and-fresh-context-rebind");

  runtime.session.sessionManager.appendMessage(ai.fauxAssistantMessage("Fixture response for persistence"));
  const savedPath = runtime.session.sessionFile;
  assert.equal(existsSync(savedPath), true);
  const persistedId = runtime.session.sessionId;
  await runtime.dispose();
  await start(SessionManager.create(root, join(root, "sessions")));
  await runtime.session.prompt("/goal-recover");
  assert.equal(runtime.session.sessionId, persistedId);
  await runtime.session.prompt("/goal");
  assert.ok(notices.at(-1).text.includes(first.goal.objective));
  results.push("existing-session-recovery-via-real-runtime-switch");

  mirrorFailure = true;
  await runtime.session.prompt("/goal Replaced with failing mirror");
  assert.equal((await disk.records())[0].goal.objective, "Replaced with failing mirror");
  assert.ok(notices.some(notice => notice.level === "warning" && notice.text.includes("mirror failed")));
  mirrorFailure = false;
  await runtime.session.prompt("/goal");
  const revision = (await disk.records())[0].revision;
  assert.ok(runtime.session.sessionManager.getEntries().some(entry => entry.type === "custom" && entry.customType === GOAL_MIRROR && entry.data.revision === revision));
  results.push("mirror-failure-authority-and-checkpoint-repair");

  const beforeFailure = (await disk.records())[0];
  disk.beforeRename = () => { throw new Error("Injected write failure"); };
  await runtime.session.prompt("/goal Must not commit");
  assert.deepEqual((await disk.records())[0], beforeFailure);
  assert.equal(notices.at(-1).level, "error");
  disk.beforeRename = undefined;
  results.push("write-failure-does-not-confirm-success");

  await runtime.session.prompt("/goal clear");
  await runtime.session.reload();
  await runtime.session.prompt("/goal");
  assert.ok(notices.at(-1).text.startsWith("No goal set"));
  await runtime.dispose();
  await start(SessionManager.open(savedPath, join(root, "sessions")));
  await runtime.session.prompt("/goal");
  assert.ok(notices.at(-1).text.startsWith("No goal set"));
  assert.equal((await disk.records())[0].goal, null);
  assert.equal(faux.state.callCount, 0);
  assert.deepEqual(errors, []);
  results.push("clear-tombstone-survives-reload-and-restart");
  console.log(JSON.stringify({ version, results, modelRequests: faux.state.callCount, extensionErrors: errors }, null, 2));
} finally {
  await runtime?.dispose();
  await rm(root, { recursive: true, force: true });
  assert.equal(existsSync(root), false);
}
