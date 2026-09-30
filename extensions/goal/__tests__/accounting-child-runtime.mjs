import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSdk, offlineModels, usage, cache90, cacheOnly, text, tool } from "./accounting-fixtures.mjs";

const childMode = process.argv.includes("--child");
const root = childMode ? process.env.GOAL_ACCOUNTING_ROOT : await mkdtemp(resolve(".goal-accounting-child-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1"; process.env.PI_TELEMETRY = "0";
if (!childMode) delete process.env.PI_SUBAGENT_PARENT;
const loaded = await loadSdk(childMode ? process.env.GOAL_ACCOUNTING_SDK : process.argv[2]);
const { sdk, ai, versions } = loaded;
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const { default: subagent } = await import("../../subagent/dist/index.js");
const delay = ms => new Promise(r => setTimeout(r, ms));
const until = async predicate => { for (let i = 0; i < 800; i++) { if (await predicate()) return; await delay(10); } throw new Error("Managed accounting fixture timed out"); };
async function runtimeFor(cwd, manager, fixture, family, factories, mode) {
  const notices = [], errors = [];
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  for (const provider of fixture.providers) modelRuntime.registerNativeProvider(provider);
  const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime, settingsManager: sdk.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } }), resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: factories } });
    return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: fixture.models[family], noTools: "builtin" }), services, diagnostics: services.diagnostics };
  };
  const runtime = await sdk.createAgentSessionRuntime(create, { cwd, agentDir: join(root, "agent"), sessionManager: manager });
  const bind = session => session.bindExtensions({ mode, uiContext: { notify: (message, level) => notices.push({ message, level }), setStatus() {}, setWidget() {}, getEditorComponent: () => undefined, setEditorComponent() {}, confirm: async () => true }, commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), reload: () => runtime.session.reload() }, onError: error => errors.push(error) });
  runtime.setRebindSession(bind); await bind(runtime.session);
  return { runtime, notices, errors, modelRuntime };
}
if (childMode) {
  const spec = JSON.parse(process.env.GOAL_ACCOUNTING_LAUNCH);
  const config = JSON.parse(process.env.GOAL_ACCOUNTING_CASE);
  const gates = new Map();
  const wait = stage => async () => { process.send({ type: "waiting", stage }); await new Promise(r => gates.set(stage, r)); };
  const fixture = await offlineModels(loaded);
  let values;
  if (config.kind === "freeze") values = [tool("fixture_noop", {}, usage(6, 4), { wait: wait(1) }), tool("fixture_noop", {}, usage(36, 4), { wait: wait(2) }), text(usage(6, 4), { wait: wait(3) })];
  else if (config.kind === "duplicate") values = [tool("fixture_noop", {}, cache90, { id: "replayed-child" }), text(cache90, { id: "replayed-child" })];
  else if (config.kind === "gap") values = [{ ...tool("fixture_noop", {}), usage: config.missing === "invalid" ? usage(0, -1) : config.missing === "zero" ? usage(0, 0) : undefined }, text(usage())];
  else values = [text(config.kind === "combined" ? usage(26, 4) : config.kind === "cache-only" ? cacheOnly : config.family === "google" ? usage(80, 10, 0, 20, 8) : cache90)];
  fixture.setSteps(values);
  const locator = { sessionName: "accounting-process", windowId: `@${process.pid}`, paneId: `%${process.pid}`, panePid: process.pid };
  const normalized = [];
  const { runtime, notices, errors } = await runtimeFor(spec.cwd, sdk.SessionManager.open(spec.args[spec.args.indexOf("--session") + 1]), fixture, config.family, [pi => {
    subagent(pi, { env: { ...spec.environment, TMUX_PANE: locator.paneId }, stateRoot: spec.environment.PI_SUBAGENT_STATE_ROOT, runtime: { locatePane: async () => locator } });
    pi.registerTool({ name: "fixture_noop", label: "Noop", description: "Offline accounting gate", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "Continue" }] }) });
    pi.on("message_end", event => { if (event.message.role === "assistant") normalized.push(event.message); });
    pi.on("agent_settled", () => process.send({ type: "settled" }));
  }], "json");
  process.on("message", async message => {
    if (message.type === "release") gates.get(message.stage)?.();
    if (message.type === "prompt") { process.send({ type: "delivered", text: message.text }); await runtime.session.prompt(message.text); }
    if (message.type === "close") {
      await runtime.session.abort(); await runtime.dispose(); fixture.verify();
      await writeFile(join(root, `child-${process.pid}.json`), JSON.stringify({ versions, pid: process.pid, requests: fixture.requests, wire: fixture.wire, normalized, entries: runtime.session.sessionManager.getEntries(), notices, errors, networkAttempts: fixture.networkAttempts }, null, 2));
      process.disconnect();
    }
  });
  const initialCommand = spec.args.at(-1);
  assert.match(initialCommand, /^\/subagent-runtime-ready /, "Missing managed child readiness command");
  await runtime.session.prompt(initialCommand);
  process.send({ type: "ready", locator });
} else {
  const results = [], processes = [];
  async function scenario(config) {
    const cwd = await mkdtemp(join(root, "case-"));
    const store = new GoalStore(join(cwd, "goals"));
    const tools = new Map(), observations = [];
    const fixture = await offlineModels(loaded);
    let entry, handle;
    const transport = {
      async launch(spec) {
        const worker = fork(fileURLToPath(import.meta.url), ["--child"], { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, GOAL_ACCOUNTING_ROOT: root, GOAL_ACCOUNTING_SDK: loaded.root, GOAL_ACCOUNTING_LAUNCH: JSON.stringify(spec), GOAL_ACCOUNTING_CASE: JSON.stringify(config) }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
        entry = { worker, waiting: 0, ready: false, settled: false, delivered: "", stderr: "" }; processes.push(entry);
        worker.stdout.on("data", () => {}); worker.stderr.on("data", data => { entry.stderr += data; });
        worker.on("message", message => { if (message.type === "ready") { entry.ready = true; entry.locator = message.locator; } if (message.type === "waiting") entry.waiting = message.stage; if (message.type === "settled") entry.settled = true; if (message.type === "delivered") entry.delivered = message.text; });
        await until(() => entry.ready || worker.exitCode !== null); assert.equal(worker.exitCode, null, entry.stderr); return entry.locator;
      },
      async sendPrompt(_locator, text) { entry.worker.send({ type: "prompt", text }); },
      async capturePane() { return `Steering: ${entry.delivered}`; },
      async isAlive() { return entry.worker.exitCode === null && entry.worker.signalCode === null; },
      async close() { const exited = once(entry.worker, "exit"); entry.worker.send({ type: "close" }); await exited; },
    };
    const goal = async () => (await store.records()).find(record => record.ownerSessionId === handle.runtime.session.sessionId).goal;
    const inspect = async ctx => {
      const result = await tools.get("get_goal").execute("observe", {}, undefined, undefined, ctx);
      const saved = await goal(); observations.push({ goal: saved, toolResult: result }); return saved;
    };
    const rootFamily = config.family === "completions" ? "anthropic" : "completions";
    fixture.setSteps([tool("subagent_spawn", { task: "Offline direct child accounting", model: `${config.family === "codex" ? "openai-codex" : `goal-${config.family}`}/accounting-fixture` }, config.kind === "combined" ? usage(6, 4) : cacheOnly), tool("fixture_observe", {}), ...(config.kind === "combined" ? [text(cacheOnly, { text: "Root history ".repeat(1000), wait: async () => { handle.runtime.session.setActiveToolsByName(handle.runtime.session.getActiveToolNames().filter(t => t !== "create_goal")); } })] : [tool("update_goal", { status: "paused" }), text(cacheOnly)])]);
    handle = await runtimeFor(cwd, sdk.SessionManager.create(cwd, join(cwd, "sessions")), fixture, rootFamily, [pi => {
      const capture = new Proxy(pi, { get(target, property) { if (property === "registerTool") return definition => { tools.set(definition.name, definition); pi.registerTool(definition); }; return Reflect.get(target, property); } });
      registerGoal(capture, store, { config: config.budget ? { maxGoalTokenBudget: config.budget } : {}, temporaryRoot: cwd });
      subagent(capture, { env: { PATH: process.env.PATH }, stateRoot: join(cwd, "subagents"), nativeSessionRoot: join(cwd, "native"), runtime: transport });
      pi.registerTool({ name: "fixture_observe", label: "Observe", description: "Assert managed process report boundaries", parameters: { type: "object", properties: {} }, execute: async (_id, _args, _signal, _update, ctx) => {
        if (config.kind === "freeze") {
          await until(() => entry.waiting === 1); entry.worker.send({ type: "release", stage: 1 });
          await until(() => entry.waiting === 2); await until(async () => (await inspect(ctx)).tokensUsed === 10);
          await handle.runtime.session.prompt("/goal pause");
          entry.worker.send({ type: "release", stage: 2 }); await until(() => entry.waiting === 3);
          await until(async () => (await inspect(ctx)).childUsage[0].tokens === 50);
          assert.equal((await goal()).tokensUsed, 10);
          await handle.runtime.session.prompt("/goal resume");
          assert.equal((await goal()).childUsage[0].tokens, 50); assert.equal((await goal()).tokensUsed, 10);
          entry.worker.send({ type: "release", stage: 3 });
        }
        await until(() => entry.settled);
        const expected = config.kind === "freeze" ? 20 : config.kind === "gap" ? 7 : config.kind === "combined" ? 40 : config.kind === "cache-only" ? 0 : 90;
        await until(async () => (await inspect(ctx)).tokensUsed === expected);
        const saved = await goal(); assert.equal(!!saved.usageIncomplete, config.kind === "gap");
        assert.ok(entry.delivered.includes("Offline direct child accounting"));
        const report = JSON.parse(await readFile(saved.childUsage[0].reportPath, "utf8"));
        assert.equal(report.tokens, config.kind === "freeze" ? 60 : config.kind === "combined" ? 30 : expected);
        const again = await inspect(ctx); assert.equal(again.tokensUsed, expected);
        const spawned = handle.runtime.session.messages.find(message => message.role === "toolResult" && message.toolName === "subagent_spawn");
        const agentId = JSON.parse(spawned.content[0].text).agent.agentId;
        await tools.get("subagent_close").execute("close-child", { target: agentId }, undefined, undefined, ctx);
        assert.equal(entry.worker.exitCode, 0, entry.stderr);
        return { content: [{ type: "text", text: "Managed direct child verified" }] };
      } });
    }], "tui");
    try {
      await handle.runtime.session.prompt("/goal Managed cross-provider accounting"); await handle.runtime.session.waitForIdle();
      assert.deepEqual(handle.errors, []);
      assert.deepEqual(handle.runtime.session.messages.filter(m => m.role === "toolResult" && m.isError), []);
      if (config.kind === "combined") {
        const session = handle.runtime.session;
        assert.equal((await goal()).tokensUsed, 40);
        await session.setModel(fixture.models.anthropic);
        fixture.setSteps([text(usage(12, 8), { family: "anthropic", text: "Compaction summary" })]);
        await session.compact(); assert.equal((await goal()).tokensUsed, 60);
        await session.setModel(fixture.models.google);
        fixture.setSteps([text(usage(6, 4), { family: "google", text: "Branch summary" })]);
        await session.navigateTree(session.sessionManager.getEntries().find(e => e.type === "custom_message").id, { summarize: true });
        assert.equal((await goal()).tokensUsed, 70);
        observations.push({ combinedBeforeBudget: await goal() });
        session.setActiveToolsByName(["create_goal", "get_goal", "update_goal"]);
        await session.setModel(fixture.models.completions);
        fixture.setSteps([text(usage(26, 4)), text(usage(6, 4))]);
        await session.prompt("/goal resume"); await session.waitForIdle();
        assert.equal((await goal()).tokensUsed, 110); assert.equal((await goal()).status, "budget_limited");
        assert.equal(session.messages.filter(m => m.customType === "pi-ext-goal-budget").length, 1);
      } else assert.equal((await goal()).tokensUsed, config.kind === "freeze" ? 20 : config.kind === "gap" ? 7 : config.kind === "cache-only" ? 0 : 90);
      const beforeReload = await goal();
      await handle.runtime.session.reload();
      assert.equal((await goal()).tokensUsed, beforeReload.tokensUsed);
      assert.equal((await goal()).usageIncomplete, beforeReload.usageIncomplete);
      const inherited = await store.openSession({ ownerSessionId: "inherited-child-snapshot", cwd, sessionFile: join(cwd, "inherited.jsonl") });
      try { await inherited.inherit((await store.records()).find(r => r.ownerSessionId === handle.runtime.session.sessionId)); assert.equal(inherited.snapshot.goal.tokensUsed, beforeReload.tokensUsed); assert.equal(inherited.snapshot.goal.usageIncomplete, beforeReload.usageIncomplete); assert.equal(inherited.snapshot.goal.childUsage, undefined); } finally { await inherited.close(); }
      if (config.kind === "gap") assert.equal(handle.notices.filter(n => n.level === "warning" && n.message.includes("managed child")).length, 1);
      const child = JSON.parse(await readFile(join(root, `child-${entry.worker.pid}.json`), "utf8"));
      assert.ok(child.entries.some(e => e.customType === "subagent_delivery")); assert.deepEqual(child.errors, []); assert.equal(child.networkAttempts, 0);
      fixture.verify();
      results.push({ config, rootFamily, rootRequests: fixture.requests, notices: handle.notices, observations, goal: await goal(), child, process: { pid: entry.worker.pid, exitCode: entry.worker.exitCode, delivered: true } });
      console.error(`PASS ${versions["pi-coding-agent"]} managed ${JSON.stringify(config)}`);
    } finally { await handle.runtime.session.abort(); await handle.runtime.dispose(); }
  }
  try {
    for (const family of ["completions", "responses", "anthropic", "google", "codex", "custom"]) await scenario({ family, kind: "cache90" });
    await scenario({ family: "anthropic", kind: "duplicate" });
    for (const missing of ["zero", "missing", "invalid"]) for (const budget of [undefined, 1000]) await scenario({ family: "responses", kind: "gap", missing, budget });
    await scenario({ family: "google", kind: "freeze" });
    await scenario({ family: "google", kind: "cache-only" });
    await scenario({ family: "responses", kind: "combined", budget: 100 });
  } finally {
    for (const entry of processes) if (entry.worker.exitCode === null && entry.worker.signalCode === null) { const exited = once(entry.worker, "exit"); entry.worker.kill("SIGKILL"); await exited; }
    await rm(root, { recursive: true, force: true });
  }
  const report = { versions, offline: true, results, cleanup: { temporaryRootRemoved: true, pids: processes.map(e => ({ pid: e.worker.pid, exitCode: e.worker.exitCode, signal: e.worker.signalCode })), listeningPorts: [] } };
  if (process.env.GOAL_CHILD_ACCOUNTING_EVIDENCE) await writeFile(resolve(process.env.GOAL_CHILD_ACCOUNTING_EVIDENCE), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ versions, scenarios: results.length, childProcesses: processes.length, passed: true }));
}
