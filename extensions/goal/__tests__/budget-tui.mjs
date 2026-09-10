import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { offlineCodex, rawUsage, textStep, toolStep } from "./budget-fixtures.mjs";
const root = resolve(process.env.GOAL_PROBE_ROOT);
await mkdir(join(root, "agent"), { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
const packageRoot = resolve(process.argv[2]);
const scenario = process.env.GOAL_BUDGET_SCENARIO ?? "soft";
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const aiRoot = resolve(packageRoot, "../pi-ai");
const ai = await import(pathToFileURL(join(aiRoot, "dist/index.js")).href);
const adapter = await import(pathToFileURL(join(aiRoot, "dist/api/openai-codex-responses.js")).href);
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const store = new GoalStore(join(root, "goals"));
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden by offline budget TUI acceptance"); };
const log = (event, data = {}) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ event, ...data }) + "\n");
await writeFile(join(root, "agent", "goal.json"), JSON.stringify({ maxGoalTokenBudget: 100 }));
const steps = [toolStep("get_goal", {}), textStep("Budget wrap-up completed. Remaining work is not claimed complete.")];
if (scenario === "baseline") steps.unshift(toolStep("create_goal", { objective: "Explicit baseline goal", token_budget: 100 }, rawUsage(900, 0, 100)));
if (scenario === "quota") steps[1] = { error: "insufficient_quota" };
if (scenario === "interrupt") steps[1] = textStep("Never delivered", rawUsage(7, 0, 3), { wait: signal => new Promise((resolve, reject) => {
  log("waiting_wrap");
  const timer = setTimeout(resolve, 15000);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Request was aborted")); }, { once: true });
}) });
const fixture = offlineCodex(ai, adapter, steps);
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(fixture.provider);
let readyCount = 0;
let settledCount = 0;
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => "Offline goal budget TUI acceptance.",
      extensionFactories: [pi => {
        registerGoal(pi, store, { configPath: join(root, "agent", "goal.json") });
        pi.on("session_start", (_event, ctx) => { log("ready", { version, scenario, mode: ctx.mode, readyCount: ++readyCount }); });
        pi.on("context", event => log("context", { messages: event.messages }));
        pi.on("message_end", event => { if (event.message.role === "assistant") log("assistant", { message: event.message }); });
        pi.on("agent_settled", async () => { log("settled", { settledCount: ++settledCount, goal: (await store.records())[0]?.goal, calls: fixture.calls() }); });
        pi.registerCommand("budget-exit", { description: "Exit isolated budget acceptance", handler: async (_args, ctx) => {
          const goal = (await store.records())[0]?.goal;
          log("result", { version, scenario, goal, calls: fixture.calls(), readyCount, networkAttempts, messages: ctx.sessionManager.getEntries() });
          assert.equal(networkAttempts, 0);
          ctx.shutdown();
        } });
      }],
    },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: fixture.model, tools: ["get_goal", "create_goal", "update_goal", "bash"] }), services, diagnostics: services.diagnostics };
};
const runtime = await sdk.createAgentSessionRuntime(factory, { cwd: root, agentDir: join(root, "agent"), sessionManager: sdk.SessionManager.create(root, join(root, "sessions")) });
log("starting", { version, uiBinding: "real-interactive-mode" });
await new sdk.InteractiveMode(runtime, { migratedProviders: [] }).run();
