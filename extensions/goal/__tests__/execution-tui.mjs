import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.env.GOAL_PROBE_ROOT);
await mkdir(root, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
const packageRoot = resolve(process.argv[2]);
const scenario = process.env.GOAL_TUI_SCENARIO ?? "retry-escape";
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(packageRoot, "../pi-ai/dist/index.js")).href);
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const store = new GoalStore(join(root, "goals"));
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network disabled by execution TUI test"); };
const log = (event, data = {}) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ event, ...data }) + "\n");
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 100000 });
faux.setResponses([ai.fauxAssistantMessage("", { stopReason: "error", errorMessage: "500 Internal Server Error" }), ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "complete" }, id: "complete" }, { stopReason: "toolUse" }), ai.fauxAssistantMessage("Done")]);
if (scenario === "c11") faux.setResponses([ai.fauxAssistantMessage("Saved assistant history")]);
let firstEnd = true;
let settledEditorText;
let savedGoalId;
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({
    cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 10000 } }),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => "Offline goal execution TUI test.",
      extensionFactories: [pi => {
        pi.on("context", async event => {
          if (scenario === "c11" && event.messages.at(-1)?.customType === "pi-ext-goal-continuation" && (await store.records())[0]?.goal?.status === "paused") {
            log("waiting_for_typed_followup");
            await new Promise(resolve => setTimeout(resolve, 1200));
          }
        });
        registerGoal(pi, store);
        pi.on("agent_end", async () => {
          if (scenario !== "c11" || !firstEnd) return;
          firstEnd = false;
          savedGoalId = (await store.records())[0].goal.goalId;
          await runtime.session.prompt("/goal pause");
          pi.sendMessage({ customType: "other-extension", content: "OTHER_EXTENSION_ACCEPTED_LOSS", display: false }, { deliverAs: "followUp", triggerTurn: true });
          log("paused_with_queued_continuation");
        });
        pi.on("session_start", (_event, ctx) => {
          ctx.ui.onTerminalInput(data => {
            if (data === "\u001b") {
              const signal = ctx.signal;
              log("escape_before", { signalPresent: !!signal, aborted: signal?.aborted, idle: ctx.isIdle() });
              queueMicrotask(() => log("escape_after", { signalPresent: !!ctx.signal, aborted: signal?.aborted, idle: ctx.isIdle() }));
            }
          });
          log("ready", { version, mode: ctx.mode, scenario });
        });
        pi.on("context", event => log("context", { messages: event.messages }));
        pi.on("input", event => log("input", { source: event.source, streamingBehavior: event.streamingBehavior, text: event.text }));
        pi.on("agent_settled", async (_event, ctx) => {
          settledEditorText = ctx.ui.getEditorText();
          log("settled", { calls: faux.state.callCount, goal: (await store.records())[0]?.goal, editorText: settledEditorText });
        });
        pi.registerCommand("probe-dialog", { description: "Open an unrelated extension confirmation", handler: async (_args, ctx) => {
          log("dialog_open");
          const answer = await ctx.ui.confirm("Unrelated confirmation", "Escape closes this dialog without interrupting the goal.");
          log("dialog_closed", { answer, goal: (await store.records())[0]?.goal });
        } });
        pi.registerCommand("probe-exit", { description: "Exit the isolated execution test", handler: async (_args, ctx) => {
          const goal = (await store.records())[0]?.goal;
          log("result", { version, scenario, calls: faux.state.callCount, goal, savedGoalId, editorText: settledEditorText, messages: ctx.sessionManager.getEntries(), networkAttempts });
          assert.equal(networkAttempts, 0);
          ctx.shutdown();
        } });
      }],
    },
  });
  const created = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), tools: ["bash", "get_goal", "create_goal", "update_goal"] });
  created.session.subscribe(event => {
    if (event.type.startsWith("auto_retry") || event.type.startsWith("auto_compaction")) log(event.type, event);
  });
  return { ...created, services, diagnostics: services.diagnostics };
};
const runtime = await sdk.createAgentSessionRuntime(factory, { cwd: root, agentDir: join(root, "agent"), sessionManager: sdk.SessionManager.create(root, join(root, "sessions")) });
log("starting", { version, uiBinding: "real-interactive-mode" });
await new sdk.InteractiveMode(runtime, { migratedProviders: [] }).run();
