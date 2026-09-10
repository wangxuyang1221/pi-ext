import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { offlineCodex } from "./budget-fixtures.mjs";

const root = await mkdtemp(resolve(".goal-restore-test-"));
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0" });
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Restore fixture forbids network"); };
const sdkRoot = resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")));
const aiRoot = resolve(sdkRoot, "../pi-ai");
const ai = await import(pathToFileURL(join(aiRoot, "dist/index.js")));
const adapter = await import(pathToFileURL(join(aiRoot, "dist/api/openai-codex-responses.js")));
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const version = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8")).version;
const results = [];
try {
  for (const accept of [false, true]) {
    const cwd = await mkdtemp(join(root, "case-"));
    const store = new GoalStore(join(cwd, "goals"));
    let runtime, suppressAutomatic = true, initialized = false, discovering = false, confirmations = 0, accepted = false;
    const events = [], errors = [];
    const fixture = offlineCodex(ai, adapter, [{ error: "usage_limit_reached" }], () => {
      assert.equal(initialized, true, "Model launch must follow all session_start handlers");
      assert.equal(accepted, true, "Model launch requires accepted confirmation");
      events.push("model-request");
    });
    const models = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    models.registerNativeProvider(fixture.provider);
    const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime: models,
        settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
        resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
          extensionFactories: [pi => {
            pi.on("session_start", () => { initialized = false; discovering = false; events.push("initializing"); });
            pi.on("resources_discover", () => { discovering = true; events.push("resources-discover"); });
            registerGoal(new Proxy(pi, { get(target, name) {
              if (name === "sendMessage") return (...args) => {
                if (suppressAutomatic) return;
                assert.equal(initialized, true);
                assert.equal(accepted, true);
                return pi.sendMessage(...args);
              };
              return Reflect.get(target, name);
            } }), store);
          }, pi => {
            // A later extension initializes asynchronously after goal.session_start.
            pi.on("session_start", async () => {
              await new Promise(resolveTick => setTimeout(resolveTick, 5));
              assert.equal(discovering, false);
              assert.equal(fixture.calls(), accept && accepted ? 1 : 0);
              initialized = true; events.push("initialized");
            });
            pi.on("resources_discover", () => { discovering = false; });
          }],
        },
      });
      return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: fixture.model }), services, diagnostics: services.diagnostics };
    };
    const bind = session => session.bindExtensions({ mode: "tui", uiContext: {
      notify() {}, setStatus() {}, setWidget() {},
      confirm: async title => {
        assert.equal(title, "Resume saved goal?");
        assert.equal(initialized, true);
        assert.equal(discovering, true, "Confirmation must run in the SDK resources_discover phase");
        assert.equal(fixture.calls(), 0);
        confirmations++; events.push("confirm"); accepted = accept;
        return accept;
      },
    }, commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), reload: () => runtime.session.reload() }, onError: error => errors.push(error) });
    const start = async manager => {
      runtime = await sdk.createAgentSessionRuntime(create, { cwd, agentDir: join(root, "agent"), sessionManager: manager });
      runtime.setRebindSession(bind); await bind(runtime.session);
    };
    try {
      await start(sdk.SessionManager.create(cwd, join(cwd, "sessions")));
      await runtime.session.prompt("/goal Restore this offline fixture");
      await runtime.session.prompt("/goal pause");
      runtime.session.sessionManager.appendMessage(ai.fauxAssistantMessage("Persist fixture history"));
      const saved = (await store.records())[0];
      const path = runtime.session.sessionFile;
      assert.equal(saved.goal.status, "paused");
      assert.equal(fixture.calls(), 0);
      await runtime.session.reload();
      assert.equal(confirmations, 0, "Reload must not offer restoration");
      assert.equal(fixture.calls(), 0);
      await runtime.dispose();
      suppressAutomatic = false;
      events.length = 0;
      await start(sdk.SessionManager.open(path, join(cwd, "sessions")));
      await runtime.session.waitForIdle();
      assert.equal(confirmations, 1);
      assert.equal(fixture.calls(), accept ? 1 : 0);
      assert.deepEqual(events.slice(0, 4), ["initializing", "initialized", "resources-discover", "confirm"]);
      if (accept) assert.equal((await store.records())[0].goal.status, "usage_limited");
      else assert.deepEqual((await store.records())[0], saved, "Cancelled restore must not write the goal");
      await runtime.session.reload();
      await runtime.session.waitForIdle();
      assert.equal(confirmations, 1);
      assert.equal(fixture.calls(), accept ? 1 : 0);
      assert.deepEqual(errors, []);
      results.push({ accept, confirmations, calls: fixture.calls(), events });
    } finally { await runtime?.session.abort(); await runtime?.dispose(); }
  }
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ version, networkAttempts, results }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
