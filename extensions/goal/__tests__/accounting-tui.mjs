import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { appendFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadSdk, offlineModels, cacheOnly, usage, text, tool } from "./accounting-fixtures.mjs";

const root = resolve(process.env.GOAL_PROBE_ROOT);
const source = process.env.GOAL_USAGE_SOURCE ?? "root";
const freeze = source.startsWith("freeze-");
const freezeStatus = source.slice(7);
await mkdir(join(root, "agent"), { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(root, "agent"); process.env.PI_OFFLINE = "1"; process.env.PI_TELEMETRY = "0";
delete process.env.PI_SUBAGENT_PARENT;
const loaded = await loadSdk(process.argv[2]);
const { sdk, ai, versions } = loaded;
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const { default: subagent } = await import("../../subagent/dist/index.js");
const store = new GoalStore(join(root, "goals"));
const log = (event, data = {}) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ event, ...data }) + "\n");
const waitFor = async predicate => { for (let i = 0; i < 600; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error("TUI child timed out"); };
let child, childState = {}, readyCount = 0, settledCount = 0;
const transport = {
  async launch(spec) {
    child = fork(resolve("extensions/goal/__tests__/accounting-child-runtime.mjs"), ["--child"], { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, GOAL_ACCOUNTING_ROOT: root, GOAL_ACCOUNTING_SDK: loaded.root, GOAL_ACCOUNTING_LAUNCH: JSON.stringify(spec), GOAL_ACCOUNTING_CASE: JSON.stringify({ family: "google", kind: freeze ? "freeze" : "gap", missing: "missing" }) }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    child.stderr.on("data", data => log("child-stderr", { text: String(data) }));
    child.on("message", message => { if (message.type === "ready") childState.locator = message.locator; if (message.type === "settled") childState.settled = true; if (message.type === "delivered") childState.delivered = message.text; if (message.type === "waiting") { childState.waiting = message.stage; log("child-waiting", { stage: message.stage }); } });
    await waitFor(() => childState.locator || child.exitCode !== null); assert.equal(child.exitCode, null); log("child-started", { pid: child.pid }); return childState.locator;
  },
  async sendPrompt(_locator, text) { child.send({ type: "prompt", text }); },
  async capturePane() { return `Steering: ${childState.delivered ?? ""}`; },
  async isAlive() { return child?.exitCode === null && child.signalCode === null; },
  async close() { if (child.exitCode !== null || child.signalCode !== null) return; const exited = once(child, "exit"); child.send({ type: "close" }); await exited; assert.equal(child.exitCode, 0); log("child-closed", { pid: child.pid, exitCode: child.exitCode }); },
};
const fixture = await offlineModels(loaded);
const first = source === "root"
  ? [{ ...tool("get_goal", {}), usage: undefined }, text(usage()), tool("update_goal", { status: "paused" }), text(cacheOnly)]
  : [tool("subagent_spawn", { task: "Offline TUI child usage", model: "goal-google/accounting-fixture" }), tool("fixture_observe", {}), tool("get_goal", {}), tool("update_goal", { status: "paused" }), text(cacheOnly)];
if (freeze) fixture.setSteps([tool("subagent_spawn", { task: "Offline child freeze boundaries", model: "goal-google/accounting-fixture" }), tool("fixture_initial", {}), ...(freezeStatus === "usage_limited" ? [{ error: "insufficient_quota" }] : [tool("update_goal", { status: freezeStatus }), text(cacheOnly)])]);
else fixture.setSteps([...first, tool("get_goal", {}), tool("update_goal", { status: "paused" }), text(cacheOnly)]);
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
for (const provider of fixture.providers) modelRuntime.registerNativeProvider(provider);
const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime, settingsManager: sdk.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }), resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: [pi => {
    registerGoal(pi, store, { temporaryRoot: root, config: process.env.GOAL_TUI_BUDGET ? { maxGoalTokenBudget: 1000 } : {} });
    if (source === "child" || freeze) subagent(pi, { env: { PATH: process.env.PATH }, stateRoot: join(root, "subagents"), nativeSessionRoot: join(root, "native"), runtime: transport });
    if (freeze) {
      pi.registerTool({ name: "fixture_initial", label: "Observe first child checkpoint", description: "Wait for the first child boundary", parameters: { type: "object", properties: {} }, execute: async () => { await waitFor(() => childState.waiting === 2); log("initial-child-observed"); return { content: [{ type: "text", text: "Initial child usage observed" }] }; } });
      pi.registerTool({ name: "fixture_final", label: "Observe resumed child checkpoint", description: "Wait for final child accounting", parameters: { type: "object", properties: {} }, execute: async () => { log("final-child-waiting"); await waitFor(() => childState.settled); await transport.close(); return { content: [{ type: "text", text: "Final child usage observed" }] }; } });
      pi.registerCommand("freeze-release", { description: "Release an isolated child response", handler: async (stage) => { child.send({ type: "release", stage: Number(stage) }); } });
      pi.registerCommand("freeze-responses", { description: "Set the isolated root resume responses", handler: async () => { fixture.setSteps([tool("fixture_final", {}), tool("get_goal", {}), tool("update_goal", { status: "paused" }), text(cacheOnly)]); log("resume-responses"); } });
      pi.registerCommand("freeze-snapshot", { description: "Observe child baseline and goal", handler: async (label) => log("snapshot", { label, goal: (await store.records())[0]?.goal }) });
    }
    pi.registerTool({ name: "fixture_observe", label: "Observe child", description: "Wait for offline child accounting", parameters: { type: "object", properties: {} }, execute: async () => {
      await waitFor(() => childState.settled); await transport.close();
      log("child-evidence", { report: JSON.parse(await readFile(join(root, `child-${child.pid}.json`), "utf8")) });
      return { content: [{ type: "text", text: "Managed child finished" }] };
    } });
    pi.on("session_start", (_event, ctx) => { log("ready", { versions, source, mode: ctx.mode, readyCount: ++readyCount }); ctx.ui.setToolsExpanded(true); });
    pi.on("tool_result", event => log("tool-result", { name: event.toolName, isError: event.isError, content: event.content, details: event.details }));
    pi.on("agent_settled", async () => log("settled", { settledCount: ++settledCount, goal: (await store.records())[0]?.goal }));
    pi.registerCommand("accounting-exit", { description: "Exit isolated accounting TUI fixture", handler: async (_args, ctx) => {
      fixture.verify(); log("result", { versions, source, readyCount, settledCount, goal: (await store.records())[0]?.goal, requests: fixture.requests, networkAttempts: fixture.networkAttempts }); ctx.shutdown();
    } });
  }] } });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: freeze ? fixture.models.codex : fixture.models.anthropic, noTools: "builtin" }), services, diagnostics: services.diagnostics };
};
const runtime = await sdk.createAgentSessionRuntime(create, { cwd: root, agentDir: join(root, "agent"), sessionManager: sdk.SessionManager.create(root, join(root, "sessions")) });
try { await new sdk.InteractiveMode(runtime, { migratedProviders: [] }).run(); }
finally { if (child?.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; } }
