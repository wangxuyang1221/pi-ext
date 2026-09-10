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
const scenario = process.env.GOAL_TUI_SCENARIO ?? "retry-c12";
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(packageRoot, "../pi-ai/dist/index.js")).href);
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const codexUI = process.env.GOAL_TUI_CODEX === "1" ? (await import("../../codex-ui/dist/index.js")).default : undefined;
const subagent = process.env.GOAL_TUI_CODEX === "1" ? (await import("../../subagent/dist/index.js")).default : undefined;
const store = new GoalStore(join(root, "goals"));
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network disabled by execution TUI test"); };
const log = (event, data = {}) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ event, ...data }) + "\n");
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: ["stream-interrupt", "stream-pause", "edit-cancel", "replace-cancel", "compact-cancel"].includes(scenario) ? 1000 : 100000 });
faux.setResponses([ai.fauxAssistantMessage("", { stopReason: "error", errorMessage: "500 Internal Server Error" }), ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "complete" }, id: "complete" }, { stopReason: "toolUse" }), ai.fauxAssistantMessage("Done")]);
if (scenario === "loop-pause") faux.setResponses(Array.from({ length: 178 }, (_, i) => ai.fauxAssistantMessage({ type: "toolCall", name: "bash", arguments: { command: "printf 'same report'" }, id: `repeat-${i}` }, { stopReason: "toolUse" })));
if (scenario === "tool-interrupt") faux.setResponses([ai.fauxAssistantMessage({ type: "toolCall", name: "bash", arguments: { command: "sleep 20" }, id: "cancel-tool" }, { stopReason: "toolUse" })]);
if (scenario.startsWith("input-")) faux.setResponses([
  ai.fauxAssistantMessage({ type: "toolCall", name: "bash", arguments: { command: "sleep 0.8; printf 'Executed tool'" }, id: "input-window" }, { stopReason: "toolUse" }),
  ai.fauxAssistantMessage("Processed current input"),
  ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "complete" }, id: "input-complete" }, { stopReason: "toolUse" }),
  ai.fauxAssistantMessage("Completed requested work"), ai.fauxAssistantMessage("Processed remaining explicit input"), ai.fauxAssistantMessage("Processed final explicit input")]);
if (scenario.startsWith("compact")) faux.setResponses([
  ai.fauxAssistantMessage("Progress before compaction"),
  ["compact-failure", "compact-manual"].includes(scenario) ? ai.fauxAssistantMessage("", { stopReason: "error", errorMessage: "Summarization failed" }) : ai.fauxAssistantMessage(scenario === "compact-cancel" ? "Summarizing progress. ".repeat(10000) : "Compacted summary"),
  ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "complete" }, id: "complete" }, { stopReason: "toolUse" }), ai.fauxAssistantMessage("Done")]);
if (["stream-interrupt", "stream-pause", "edit-cancel", "replace-cancel"].includes(scenario)) faux.setResponses([ai.fauxAssistantMessage("Still working. ".repeat(scenario === "stream-interrupt" ? 10000 : 1000)), ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "complete" }, id: "after-dialog" }, { stopReason: "toolUse" }), ai.fauxAssistantMessage("Done")]);
if (scenario === "c11") faux.setResponses([ai.fauxAssistantMessage("Saved assistant history")]);
let firstEnd = true;
let settledEditorText;
let savedGoalId;
let settledCount = 0;
let streamingLogged = false;
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({
    cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ compaction: scenario.startsWith("compact") ? { enabled: true, reserveTokens: 16384, keepRecentTokens: 1 } : { enabled: false }, retry: { enabled: !scenario.startsWith("compact"), maxRetries: 1, baseDelayMs: 10000 } }),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => "Offline goal execution TUI test.",
      extensionFactories: [...(codexUI ? [codexUI, subagent] : []), pi => {
        pi.on("context", async event => {
          if (scenario === "c11" && event.messages.at(-1)?.customType === "pi-ext-goal-continuation" && (await store.records())[0]?.goal?.status === "paused") {
            log("waiting_for_typed_followup");
            await new Promise(resolve => setTimeout(resolve, 1200));
          }
        });
        registerGoal(pi, store);
        pi.on("tool_execution_start", event => {
          if (scenario === "tool-interrupt" && event.toolName === "bash") log("model_streaming");
          if (scenario.startsWith("input-") && event.toolName === "bash") {
            pi.sendMessage({ customType: "other-extension", content: "OTHER_EXTENSION_PRESERVED", display: false }, { deliverAs: "followUp", triggerTurn: true });
            log("input_window");
          }
        });
        let forced = false;
        pi.on("message_end", event => {
          if (!scenario.startsWith("compact") || forced || event.message.role !== "assistant" || event.message.stopReason !== "stop") return;
          forced = true;
          return { message: { ...event.message, usage: { ...event.message.usage, input: 130000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 130001 } } };
        });
        pi.on("session_compact", event => log("compact_succeeded", { reason: event.reason }));
        pi.on("session_compact_failed", event => log("compact_failed", { reason: event.reason, aborted: event.aborted }));
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
          settledCount++;
          const goal = (await store.records())[0]?.goal;
          log("settled", { settledCount, calls: faux.state.callCount, goal, editorText: settledEditorText });
          if (["compact-failure", "compact-cancel", "compact-manual"].includes(scenario) && settledCount === 1) {
            assert.equal(goal.status, scenario === "compact-cancel" ? "paused" : "blocked");
            faux.setResponses([ai.fauxAssistantMessage("Recovered summary"), ai.fauxAssistantMessage("Explicit user request completed"), ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "complete" }, id: "resume-complete" }, { stopReason: "toolUse" }), ai.fauxAssistantMessage("Done")]);
          }
          if (["retry-c12", "stream-interrupt", "stream-pause", "tool-interrupt", "loop-pause"].includes(scenario) && settledCount === 1) {
            assert.equal(goal.status, scenario === "retry-c12" ? "blocked" : "paused");
            assert.ok(goal.tokensUsed >= 37);
            assert.ok(goal.elapsedSeconds >= 11);
            faux.setResponses([ai.fauxAssistantMessage({ type: "toolCall", name: "update_goal", arguments: { status: "complete" }, id: "resume-complete" }, { stopReason: "toolUse" }), ai.fauxAssistantMessage("Resumed and completed")]);
          }
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
    if (event.type === "message_update" && ["stream-interrupt", "stream-pause", "edit-cancel", "replace-cancel"].includes(scenario) && !streamingLogged) { streamingLogged = true; log("model_streaming"); }
    if (event.type.startsWith("auto_retry") || event.type.startsWith("compaction_")) log(event.type, event);
  });
  return { ...created, services, diagnostics: services.diagnostics };
};
const sessionManager = sdk.SessionManager.create(root, join(root, "sessions"));
if (["retry-c12", "stream-interrupt", "stream-pause", "tool-interrupt", "loop-pause", "edit-cancel", "replace-cancel"].includes(scenario) || scenario.startsWith("compact")) {
  const lease = await store.openSession({ ownerSessionId: sessionManager.getSessionId(), cwd: root, sessionFile: sessionManager.getSessionFile() });
  const saved = await lease.replace("Exercise interruption and resume", lease.snapshot);
  saved.goal.tokensUsed = 37;
  saved.goal.elapsedSeconds = 11;
  await store.commit(saved);
  savedGoalId = saved.goal.goalId;
  await lease.close();
}
const runtime = await sdk.createAgentSessionRuntime(factory, { cwd: root, agentDir: join(root, "agent"), sessionManager });
log("starting", { version, uiBinding: "real-interactive-mode", codexUI: !!codexUI, subagent: !!subagent });
await new sdk.InteractiveMode(runtime, { migratedProviders: [] }).run();
