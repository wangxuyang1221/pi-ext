import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { offlineCodex, rawUsage, textStep, toolStep } from "./budget-fixtures.mjs";

const childMode = process.argv.includes("--child");
const scenario = process.env.GOAL_CHILD_SCENARIO ?? "budget";
const root = resolve(process.env.GOAL_CHILD_EVIDENCE ?? `.scratch/goal-child-${Date.now()}`);
await mkdir(root, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
const packageRoot = resolve(process.env.GOAL_CHILD_PI ?? process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")));
const aiRoot = resolve(packageRoot, "../pi-ai");
const ai = await import(pathToFileURL(join(aiRoot, "dist/index.js")));
const adapter = await import(pathToFileURL(join(aiRoot, "dist/api/openai-codex-responses.js")));
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const { default: subagent } = await import("../../subagent/dist/index.js");
const { SessionStateStore } = await import("../../subagent/dist/state-store.js");
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Offline managed fixture forbids network"); };
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const until = async predicate => { for (let i = 0; i < 400; i++) { if (await predicate()) return; await delay(25); } throw new Error("Managed fixture timed out"); };

async function makeRuntime(cwd, manager, fixture, factories, mode) {
  const errors = [], notices = [];
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(fixture.provider);
  const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
      settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: factories },
    });
    return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: fixture.model }), services, diagnostics: services.diagnostics };
  };
  const runtime = await sdk.createAgentSessionRuntime(create, { cwd, agentDir: join(root, "agent"), sessionManager: manager });
  const bind = session => session.bindExtensions({ mode, uiContext: { notify: (text, level) => notices.push({ text, level }), setStatus() {}, setWidget() {}, confirm: async () => true }, commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), reload: () => runtime.session.reload() }, onError: error => errors.push(error) });
  runtime.setRebindSession(bind);
  await bind(runtime.session);
  return { runtime, errors, notices };
}

if (childMode) {
  const spec = JSON.parse(process.env.GOAL_CHILD_LAUNCH);
  let release;
  const gate = new Promise(resolveGate => { release = resolveGate; });
  const childSteps = scenario === "duplicate"
    ? [toolStep("bash", { command: "printf offline" }, rawUsage(), { wait: () => gate, id: "child-response" }), textStep("Repeated receipt", rawUsage(), { id: "child-response" })]
    : [textStep("Child done", rawUsage(), { wait: () => gate, id: "child-response" })];
  const fixture = offlineCodex(ai, adapter, childSteps, () => process.send?.({ type: "request" }));
  const locator = { sessionName: "sdk-managed-fixture", windowId: `@${process.pid}`, paneId: `%${process.pid}`, panePid: process.pid };
  const manager = sdk.SessionManager.open(spec.args[spec.args.indexOf("--session") + 1]);
  const transport = { locatePane: async () => locator };
  const { runtime, errors, notices } = await makeRuntime(spec.cwd, manager, fixture, [pi => {
    subagent(pi, { env: { ...spec.environment, TMUX_PANE: locator.paneId }, stateRoot: spec.environment.PI_SUBAGENT_STATE_ROOT, runtime: transport });
    pi.on("agent_settled", () => process.send?.({ type: "settled" }));
  }], "json");
  process.on("message", async message => {
    if (message.type === "release") release();
    if (message.type === "prompt") {
      process.send?.({ type: "queued", text: message.text });
      await runtime.session.prompt(message.text);
    }
    if (message.type === "close") {
      await runtime.session.abort();
      await runtime.dispose();
      await writeFile(join(root, `child-${process.pid}.json`), JSON.stringify({ version, calls: fixture.calls(), messages: runtime.session.messages, errors, notices, networkAttempts }, null, 2));
      process.disconnect();
    }
  });
  process.send?.({ type: "ready", locator });
} else {
  const stateRoot = join(root, "subagents");
  const states = new SessionStateStore(stateRoot);
  const store = new GoalStore(join(root, "goals"));
  const workers = new Map();
  const processes = [];
  const tools = new Map();
  let lastCtx;
  const transport = {
    async launch(spec) {
      const worker = fork(fileURLToPath(import.meta.url), ["--child"], { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: root, GOAL_CHILD_EVIDENCE: root, GOAL_CHILD_SCENARIO: scenario, GOAL_CHILD_PI: packageRoot, GOAL_CHILD_LAUNCH: JSON.stringify(spec) }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      const entry = { worker, ready: false, requested: false, settled: false, text: "", stdout: "", stderr: "" };
      processes.push(entry);
      worker.stdout.on("data", data => { entry.stdout += data; }); worker.stderr.on("data", data => { entry.stderr += data; });
      worker.on("message", message => {
        if (message.type === "ready") { entry.ready = true; entry.locator = message.locator; workers.set(message.locator.windowId, entry); }
        if (message.type === "request") entry.requested = true;
        if (message.type === "settled") entry.settled = true;
        if (message.type === "queued") entry.text = message.text;
      });
      await until(() => entry.ready || worker.exitCode !== null);
      assert.equal(worker.exitCode, null, entry.stderr);
      return entry.locator;
    },
    async sendPrompt(locator, text) { workers.get(locator.windowId).worker.send({ type: "prompt", text }); },
    async capturePane(locator) { return `Steering: ${workers.get(locator.windowId).text}`; },
    async isAlive(locator) { const child = workers.get(locator.windowId)?.worker; return !!child && child.exitCode === null && child.signalCode === null; },
    async close(locator) {
      const child = workers.get(locator.windowId).worker;
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit"); child.send({ type: "close" }); await exited;
    },
  };
  const fixture = offlineCodex(ai, adapter, [
    toolStep("subagent_spawn", { task: "Offline child", name: "Budget child" }, rawUsage(7, 0, 3)),
    toolStep("fixture_observe", {}, rawUsage(7, 0, 3)),
    toolStep("update_goal", { status: "complete" }, rawUsage(7, 0, 3)),
    textStep("Done"),
  ]);
  const contexts = [];
  let observed;
  const { runtime, errors, notices } = await makeRuntime(root, sdk.SessionManager.create(root, join(root, "sessions")), fixture, [pi => {
    registerGoal(pi, store, { config: { maxGoalTokenBudget: 100 } });
    const capture = new Proxy(pi, { get(target, property) {
      if (property === "registerTool") return definition => { tools.set(definition.name, definition); pi.registerTool(definition); };
      return Reflect.get(target, property);
    } });
    subagent(capture, { env: { PATH: process.env.PATH }, stateRoot, nativeSessionRoot: join(root, "native"), runtime: transport });
    pi.on("context", (event, ctx) => { lastCtx = ctx; contexts.push(structuredClone(event.messages)); });
    pi.registerTool({ name: "fixture_observe", label: "Observe", description: "Offline managed process assertions", parameters: { type: "object", properties: {} }, execute: async (_id, _args, _signal, _update, ctx) => {
      const entry = processes[0];
      await until(() => entry.requested);
      if (scenario === "late") await runtime.session.prompt("/goal Replacement goal");
      entry.worker.send({ type: "release" });
      await until(() => entry.settled);
      const child = (await states.list()).find(state => state.parent);
      assert.ok(child);
      const read = tools.get("subagent_read");
      const first = await read.execute("read-1", { agentId: child.sessionId, view: "recent_activity" }, undefined, undefined, ctx);
      const second = await read.execute("read-2", { agentId: child.sessionId, view: "recent_activity" }, undefined, undefined, ctx);
      assert.deepEqual(second, first);
      if (scenario !== "late") await until(async () => (await store.records())[0]?.goal?.tokensUsed === 120);
      await runtime.session.prompt("/goal");
      observed = (await store.records())[0].goal;
      if (scenario === "late") assert.equal(observed.tokensUsed, 0);
      await tools.get("subagent_close").execute("close", { target: child.sessionId }, undefined, undefined, ctx);
      assert.equal((await states.list()).filter(state => state.parent).length, 0);
      assert.equal(entry.worker.exitCode, 0);
      return { content: [{ type: "text", text: "Child closed after durable report" }] };
    } });
  }], "tui");
  try {
    await runtime.session.prompt("/goal Managed direct child budget");
    await runtime.session.waitForIdle();
    const saved = (await store.records())[0];
    assert.deepEqual(errors, []);
    assert.deepEqual(runtime.session.messages.filter(message => message.role === "toolResult" && message.isError), [], "Fixture tool assertions must not be swallowed by the agent loop");
    assert.equal(saved.goal.tokensUsed, scenario === "late" ? 10 : 130);
    assert.equal(saved.goal.status, "complete");
    if (scenario === "late") assert.equal(saved.goal.childUsage, undefined);
    else assert.equal(saved.goal.childUsage[0].tokens, 100);
    assert.equal(observed.status, scenario === "late" ? "active" : "budget_limited");
    assert.equal(fixture.calls(), 4);
    assert.equal(contexts.flat().filter(message => message.customType === "pi-ext-goal-budget").length, scenario === "late" ? 0 : 1);
    await runtime.session.prompt("/reload");
    await runtime.session.prompt("/goal");
    assert.equal((await store.records())[0].goal.tokensUsed, scenario === "late" ? 10 : 130);
    assert.deepEqual(errors, []);
    assert.equal(networkAttempts, 0);
    await writeFile(join(root, "results.json"), JSON.stringify({ passed: true, version, scenario, saved, observed, calls: fixture.calls(), contexts, errors, notices, networkAttempts, pids: processes.map(entry => entry.worker.pid) }, null, 2));
  } finally {
    await runtime.session.abort(); await runtime.dispose();
    for (const entry of processes) {
      if (entry.worker.exitCode === null && entry.worker.signalCode === null) {
        entry.worker.kill("SIGKILL"); await once(entry.worker, "exit");
      }
    }
    await writeFile(join(root, "cleanup.json"), JSON.stringify(processes.map(entry => ({ pid: entry.worker.pid, exitCode: entry.worker.exitCode, signal: entry.worker.signalCode, stdout: entry.stdout, stderr: entry.stderr })), null, 2));
    await writeFile(join(root, "diagnostics.json"), JSON.stringify({ errors, notices, contexts, records: await store.records() }, null, 2));
  }
  console.log(`Managed direct child acceptance passed on Pi ${version}`);
}
