import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { offlineCodex, rawUsage, textStep, toolStep } from "./budget-fixtures.mjs";
import { registerGoal } from "../dist/index.js";
import { GoalStore } from "../dist/storage.js";
import subagent from "../../subagent/dist/index.js";
import { SessionStateStore } from "../../subagent/dist/state-store.js";
import { TmuxRuntime } from "../../subagent/dist/tmux-runtime.js";

const exec = promisify(execFile);
const root = resolve(process.env.GOAL_CHILD_EVIDENCE ?? `.scratch/goal-tmux-${Date.now()}`);
const scenario = process.env.GOAL_CHILD_SCENARIO ?? "budget";
const packageRoot = resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const agentDir = join(root, "agent");
if (existsSync(join(root, "child-requested"))) throw new Error("Use a fresh tmux evidence directory");
await mkdir(agentDir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")));
const aiRoot = resolve(packageRoot, "../pi-ai");
const ai = await import(pathToFileURL(join(aiRoot, "dist/index.js")));
const adapter = await import(pathToFileURL(join(aiRoot, "dist/api/openai-codex-responses.js")));
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Offline root fixture forbids network"); };
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const until = async predicate => { for (let i = 0; i < 800; i++) { if (await predicate()) return; await delay(25); } throw new Error("Tmux fixture timed out"); };
const quote = text => `'${text.replaceAll("'", `'"'"'`)}'`;
const socket = join(root, "tmux.sock");
const tmuxPath = join(root, "tmux");
const piPath = join(root, "pi");
const env = { PATH: process.env.PATH, HOME: root, SHELL: "/bin/sh", TERM: "xterm-256color", LANG: "en_US.UTF-8", TMPDIR: root,
  PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SUBAGENT_TMUX_PATH: tmuxPath };
const commandLog = [];
const execute = async (command, args) => {
  let result;
  try { result = { code: 0, ...await exec(command, args, { env, cwd: root, timeout: 5000 }) }; }
  catch (error) { if (typeof error.code !== "number") throw error; result = { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }; }
  commandLog.push({ command, args, ...result });
  return result;
};
const tmuxBinary = (await exec("/usr/bin/which", ["tmux"])).stdout.trim();
await writeFile(tmuxPath, `#!/bin/sh\nexec ${quote(tmuxBinary)} -S ${quote(socket)} -f /dev/null "$@"\n`);
await writeFile(piPath, `#!/bin/sh\nexport GOAL_CHILD_EVIDENCE=${quote(root)} GOAL_CHILD_PI=${quote(packageRoot)} GOAL_CHILD_SCENARIO=${quote(scenario)}\nexec ${quote(process.execPath)} ${quote(join(packageRoot, "dist/cli.js"))} --no-extensions --no-context-files --no-skills --no-prompt-templates --no-themes --no-builtin-tools --no-approve "$@"\n`);
await chmod(tmuxPath, 0o700); await chmod(piPath, 0o700);
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
const transport = new TmuxRuntime({ execute, tmuxPath, sessionName: "goal-direct-child", transferDirectory: join(root, "transfer") });
const pids = new Set();
const locators = [];
const launch = transport.launch.bind(transport);
transport.launch = async spec => {
  const locator = await launch(spec);
  locators.push(locator); pids.add(locator.panePid);
  const server = await execute(tmuxPath, ["display-message", "-p", "#{pid}"]);
  if (server.code === 0) pids.add(Number(server.stdout.trim()));
  await writeFile(join(root, "pids.json"), JSON.stringify([...pids]));
  return locator;
};
const states = new SessionStateStore(join(root, "subagents"));
const store = new GoalStore(join(root, "goals"));
const tools = new Map();
const contexts = [], errors = [], notices = [];
let runtime, observed, childEvidence, childState, previousGoal;
const spawnStep = toolStep("subagent_spawn", { task: "Offline child", name: "Budget child", model: "openai-codex/goal-budget-fixture" }, rawUsage(7, 0, 3));
const fixture = offlineCodex(ai, adapter, scenario === "pending"
  ? [spawnStep, textStep("Root turn ended; child is still running")]
  : [spawnStep, toolStep("fixture_observe", {}, rawUsage(7, 0, 3)), toolStep("update_goal", { status: "complete" }, rawUsage(7, 0, 3)), textStep("Done")]);
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(fixture.provider);
const factories = [pi => {
  registerGoal(pi, store, { config: { maxGoalTokenBudget: 100 } });
  const capture = new Proxy(pi, { get(target, property) {
    if (property === "registerTool") return definition => { tools.set(definition.name, definition); pi.registerTool(definition); };
    return Reflect.get(target, property);
  } });
  subagent(capture, { env, stateRoot: states.root, nativeSessionRoot: join(root, "native"), runtime: transport, piPath, extensionPath: resolve("extensions/goal/__tests__/child-tmux-fixture.mjs") });
  pi.on("context", event => { contexts.push(structuredClone(event.messages)); });
  const observe = async ctx => {
    await until(() => existsSync(join(root, "child-requested")));
    const spawned = runtime.session.messages.find(message => message.role === "toolResult" && message.toolName === "subagent_spawn");
    const agent = JSON.parse(spawned.content[0].text).agent;
    const waitArgs = { agentId: agent.agentId, afterSettled: agent.settledCursor, timeoutMs: 1 };
    const pending = await tools.get("subagent_wait").execute("wait-pending", waitArgs, undefined, undefined, ctx);
    assert.equal(JSON.parse(pending.content[0].text).outcome, "timeout");
    if (scenario === "late") {
      previousGoal = (await store.records())[0].goal;
      await runtime.session.prompt("/goal Replacement goal");
    }
    await writeFile(join(root, "child-release"), "release");
    await until(() => existsSync(join(root, "child-settled.json")));
    childEvidence = JSON.parse(await readFile(join(root, "child-settled.json"), "utf8"));
    childState = (await states.list()).find(state => state.parent);
    assert.ok(childState);
    assert.equal(childEvidence.networkAttempts, 0);
    const attributed = scenario === "late" ? previousGoal : (await store.records())[0].goal;
    const report = JSON.parse(await readFile(attributed.childUsage[0].reportPath, "utf8"));
    assert.equal(report.tokens, 100, "The late report must actually exist, not merely be absent from the new goal");
    assert.deepEqual(Object.keys(report).sort(), ["lastReceipt", "missing", "sourceId", "tokens"]);
    assert.equal(childEvidence.tools.includes("get_goal"), false);
    assert.equal(childEvidence.tools.includes("subagent_spawn"), false);
    assert.ok(childEvidence.entries.some(entry => entry.customType === "subagent_delivery"));
    const settled = await tools.get("subagent_wait").execute("wait-settled", waitArgs, undefined, undefined, ctx);
    assert.equal(JSON.parse(settled.content[0].text).outcome, "settled");
    const first = await tools.get("subagent_read").execute("read-1", { agentId: childState.sessionId, view: "recent_activity" }, undefined, undefined, ctx);
    const second = await tools.get("subagent_read").execute("read-2", { agentId: childState.sessionId, view: "recent_activity" }, undefined, undefined, ctx);
    assert.deepEqual(second, first);
    if (scenario !== "late") await until(async () => (await store.records())[0]?.goal?.tokensUsed === 120);
    await runtime.session.prompt("/goal");
    observed = (await store.records())[0].goal;
    assert.equal(observed.tokensUsed, scenario === "late" ? 0 : 120);
    assert.equal(await transport.isAlive(locators[0]), true, "Budget must not kill the child");
    await writeFile(join(root, "pane.txt"), await transport.capturePane(locators[0]));
    await tools.get("subagent_close").execute("close", { target: childState.sessionId }, undefined, undefined, ctx);
    assert.equal((await states.list()).filter(state => state.parent).length, 0);
    assert.equal(await transport.isAlive(locators[0]), false);
    return { content: [{ type: "text", text: "Child report retained after explicit close" }] };
  };
  pi.registerTool({ name: "fixture_observe", label: "Observe", description: "Real tmux accounting assertions", parameters: { type: "object", properties: {} }, execute: async (_id, _args, _signal, _update, ctx) => observe(ctx) });
  let observedEnd = false;
  pi.on("agent_end", async (_event, ctx) => {
    if (scenario !== "pending" || observedEnd) return;
    observedEnd = true;
    // The goal scheduler has already queued its owned continuation before this hook.
    await observe(ctx);
  });
}];
try {
  const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir, modelRuntime,
      settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: factories },
    });
    return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: fixture.model }), services, diagnostics: services.diagnostics };
  };
  runtime = await sdk.createAgentSessionRuntime(create, { cwd: root, agentDir, sessionManager: sdk.SessionManager.create(root, join(root, "sessions")) });
  const bind = session => session.bindExtensions({ mode: "tui", uiContext: { notify: (text, level) => notices.push({ text, level }), setStatus() {}, setWidget() {}, confirm: async () => true }, commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), reload: () => runtime.session.reload() }, onError: error => errors.push(error) });
  runtime.setRebindSession(bind); await bind(runtime.session);
  await runtime.session.prompt("/goal Managed tmux child budget");
  await runtime.session.waitForIdle();
  assert.deepEqual(errors, []);
  assert.deepEqual(runtime.session.messages.filter(message => message.role === "toolResult" && message.isError), [], "Fixture tool assertions must not be swallowed by the agent loop");
  const saved = (await store.records())[0];
  assert.equal(saved.goal.tokensUsed, scenario === "late" ? 10 : scenario === "pending" ? 120 : 130);
  assert.equal(saved.goal.status, scenario === "pending" ? "budget_limited" : "complete");
  assert.equal(fixture.calls(), scenario === "pending" ? 2 : 4);
  assert.equal(contexts.flat().filter(message => message.customType === "pi-ext-goal-budget").length, ["late", "pending"].includes(scenario) ? 0 : 1);
  if (scenario !== "late") {
    assert.equal(saved.goal.childUsage[0].tokens, 100);
    assert.equal(JSON.parse(await readFile(saved.goal.childUsage[0].reportPath, "utf8")).tokens, 100);
  }
  await runtime.session.prompt("/reload"); await runtime.session.prompt("/goal");
  assert.equal((await store.records())[0].goal.tokensUsed, saved.goal.tokensUsed);
  assert.deepEqual(errors, []);
  assert.equal(networkAttempts, 0);
  assert.deepEqual(await readdir(join(root, "transfer")), []);
  await writeFile(join(root, "results.json"), JSON.stringify({ passed: true, transport: "real-tmux-cli", version, scenario, saved, observed, previousGoal, childState, childEvidence, calls: fixture.calls(), contexts, errors, notices, networkAttempts }, null, 2));
} finally {
  await runtime?.session.abort(); await runtime?.dispose();
  for (const locator of locators) {
    if (await transport.isAlive(locator).catch(() => false)) await writeFile(join(root, "failure-pane.txt"), await transport.capturePane(locator));
  }
  await execute(tmuxPath, ["kill-server"]);
  await until(() => [...pids].every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }));
  const sessions = await execute(tmuxPath, ["list-sessions"]);
  assert.notEqual(sessions.code, 0);
  await writeFile(join(root, "cleanup.json"), JSON.stringify({ pids: [...pids], alivePids: [], socket, socketUnavailable: true, commandLog }, null, 2));
  await writeFile(join(root, "diagnostics.json"), JSON.stringify({ errors, notices, records: await store.records(), messages: runtime?.session.messages }, null, 2));
}
console.log(`Real tmux direct child acceptance passed on Pi ${version}: ${scenario}`);
