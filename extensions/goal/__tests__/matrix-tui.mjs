import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as sdk from "@earendil-works/pi-coding-agent";
import * as ai from "@earendil-works/pi-ai";
import { registerGoal } from "../dist/index.js";
import { GoalStore } from "../dist/storage.js";
const root = process.env.GOAL_AUDIT_ROOT;
const phase = process.env.GOAL_MATRIX_PHASE ?? "create";
const scenario = process.env.GOAL_MATRIX_SCENARIO;
const agentDir = join(root, "agent");
mkdirSync(agentDir, { recursive: true });
mkdirSync(join(root, "tmp"), { recursive: true });
const log = (event, data = {}) => appendFileSync(join(root, `events-${phase}.jsonl`), JSON.stringify({ event, ...data }) + "\n");
let networkAttempts = 0;
let releaseResponse;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden in goal matrix"); };
const store = new GoalStore(join(root, "goals"), scenario === "inheritance" ? () => 0 : undefined);
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 100000 });
const pause = () => [ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "paused" }, id: "pause" }, { stopReason: "toolUse" }), ai.fauxAssistantMessage("Matrix response settled")];
faux.setResponses(pause());
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const manager = phase.startsWith("reopen") ? sdk.SessionManager.open(JSON.parse(readFileSync(join(root, "session.json"), "utf8")).sessionFile, join(root, "sessions")) : sdk.SessionManager.create(root, join(root, "sessions"));
if (["inheritance", "time", "lifecycle"].includes(scenario) && phase === "create") {
  manager.appendMessage({ role: "user", content: "HISTORICAL_USER_FOR_FORK", timestamp: Date.now() });
  manager.appendMessage(ai.fauxAssistantMessage("Persistent history fixture"));
  const lease = await store.openSession({ ownerSessionId: manager.getSessionId(), cwd: root, sessionFile: manager.getSessionFile() });
  const record = await lease.replace(scenario === "lifecycle" ? "Goal details line. ".repeat(100) : "Seeded active goal with saved statistics", lease.snapshot, 1000000);
  record.goal.tokensUsed = 37;
  record.goal.elapsedSeconds = 12;
  record.continuationDeferral = true;
  await store.commit(record);
  await lease.close();
}
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir, modelRuntime, settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }), resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true, systemPromptOverride: () => "Offline goal verification matrix.", extensionFactories: [pi => {
    registerGoal(pi, store, { configPath: join(agentDir, "goal.json"), temporaryRoot: join(root, "tmp") });
    pi.on("session_start", (_, ctx) => log("ready", { phase, sessionId: ctx.sessionManager.getSessionId(), pid: process.pid }));
    pi.on("context", event => log("request", { messages: event.messages }));
    pi.on("message_end", event => log("message", { message: event.message }));
    pi.on("agent_settled", async () => log("settled", { calls: faux.state.callCount, records: await store.records() }));
    pi.registerCommand("matrix-seed", { description: "Configure synthetic provider responses", handler: async (name, ctx) => {
      let steps = pause();
      if (name === "gate") steps = [async () => { log("response_waiting"); await new Promise(resolve => { releaseResponse = resolve; }); return ai.fauxAssistantMessage("LATE_RESPONSE_BEFORE_ACTIVATION " + "x".repeat(8000)); }, ...pause()];
      else if (name === "complete") steps = [ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "complete" }, id: "complete" }, { stopReason: "toolUse" }), ai.fauxAssistantMessage("Completed")];
      else if (name === "hold") steps = [ai.fauxAssistantMessage("Held streaming response. ".repeat(30000))];
      else if (name === "text") steps = [ai.fauxAssistantMessage("Explicit history response")];
      else if (name === "empty") steps = Array.from({ length: 8 }, () => ai.fauxAssistantMessage(""));
      else if (["401", "length", "deferred", "quota"].includes(name)) steps = [ai.fauxAssistantMessage("", { stopReason: name === "401" || name === "quota" ? "error" : name, errorMessage: name === "quota" ? "insufficient_quota" : "401 Unauthorized" })];
      else if (name.startsWith("tools:")) {
        const specs = JSON.parse(name.slice(6));
        steps = specs.map((spec, index) => ai.fauxAssistantMessage({ type: "toolCall", name: spec.name, arguments: spec.args, id: `matrix-${index}` }, { stopReason: "toolUse" }));
        steps.push(ai.fauxAssistantMessage("Tool rejection matrix completed"));
      }
      faux.setResponses(steps);
      log("seeded", { name }); ctx.ui.notify("MATRIX_SEEDED", "info");
    } });
    pi.registerCommand("matrix-release", { description: "Release the isolated pending response", handler: async () => { releaseResponse?.(); log("response_released"); } });
    pi.registerCommand("matrix-storage", { description: "Inject a pre-rename disk failure", handler: async (name, ctx) => {
      store.beforeRename = name === "fail" ? () => { throw Object.assign(new Error("Injected isolated disk failure"), { code: "EIO" }); } : undefined;
      log("storage", { name }); ctx.ui.notify("MATRIX_STORAGE " + name, "info");
    } });
    pi.registerCommand("matrix-tools", { description: "Configure available tools", handler: async (name, ctx) => {
      pi.setActiveTools(name === "missing" ? ["read", "bash", "get_goal", "create_goal"] : ["read", "bash", "get_goal", "create_goal", "update_goal"]);
      log("tools", { name }); ctx.ui.notify("MATRIX_TOOLS " + name, "info");
    } });
    pi.registerCommand("matrix-snapshot", { description: "Observe authoritative goal and session", handler: async (label, ctx) => {
      log("snapshot", { label, sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(), records: await store.records(), calls: faux.state.callCount, entries: ctx.sessionManager.getEntries(), networkAttempts });
      ctx.ui.notify("MATRIX_SNAPSHOT " + label, "info");
    } });
    pi.registerCommand("matrix-exit", { description: "Exit isolated matrix", handler: async (_, ctx) => {
      writeFileSync(join(root, "session.json"), JSON.stringify({ sessionFile: ctx.sessionManager.getSessionFile() }));
      log("exit", { networkAttempts }); ctx.shutdown();
    } });
  }] } });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), tools: ["read", "bash", "get_goal", "create_goal", "update_goal"] }), services, diagnostics: services.diagnostics };
};
const runtime = await sdk.createAgentSessionRuntime(factory, { cwd: root, agentDir, sessionManager: manager });
await new sdk.InteractiveMode(runtime, { migratedProviders: [] }).run();
