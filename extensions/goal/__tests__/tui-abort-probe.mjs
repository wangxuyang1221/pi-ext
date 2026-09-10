import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// Diagnostic for the planning candidate, not the product scheduler.
const root = resolve(process.env.GOAL_PROBE_ROOT);
await mkdir(root, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
const packageRoot = resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(packageRoot, "../pi-ai/dist/index.js")).href);
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network disabled by probe"); };
const log = (event, data = {}) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ event, ...data }) + "\n");
const faux = ai.fauxProvider({ provider: "goal-tui-probe", tokensPerSecond: 100000 });
faux.setResponses(Array.from({ length: 8 }, (_, index) => ai.fauxAssistantMessage(`Probe response ${index + 1}`)));
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
let ends = 0;
let paused = false;
let editorText;
let externalSeen = false;
let contextAbort = 0;
let runtime;
let resolveSettled;
const settled = new Promise(resolve => { resolveSettled = resolve; });
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({
    cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => "Offline TUI scheduling probe.",
      extensionFactories: [pi => {
        pi.on("session_start", (_event, ctx) => { log("ready", { version, mode: ctx.mode }); });
        pi.registerCommand("probe", { description: "Run the bounded queue diagnostic", handler: () => {
          pi.sendMessage({ customType: "probe-initial", content: "Initial diagnostic request", display: false }, { triggerTurn: true });
        } });
        pi.on("agent_end", (_event, ctx) => {
          ends++;
          log("agent_end", { ends, calls: faux.state.callCount });
          if (ends !== 1) return;
          pi.sendMessage({ customType: "probe-goal", content: "Continue the now stale goal", display: false }, { deliverAs: "followUp", triggerTurn: true });
          pi.sendMessage({ customType: "probe-other-extension", content: "OTHER_EXTENSION_MUST_SURVIVE", display: false }, { deliverAs: "followUp", triggerTurn: true });
          if (process.env.GOAL_PROBE_USER === "1") pi.sendUserMessage("USER_FOLLOWUP_MUST_SURVIVE", { deliverAs: "followUp" });
          paused = true;
          log("queued_then_paused", { hasPendingMessages: ctx.hasPendingMessages() });
        });
        pi.on("input", event => { log("input", { source: event.source, streamingBehavior: event.streamingBehavior, text: event.text }); });
        pi.on("context", async (event, ctx) => {
          const last = event.messages.at(-1);
          const types = event.messages.map(message => message.customType ?? message.role);
          if (types.includes("probe-other-extension")) externalSeen = true;
          log("context", { types });
          if (process.env.GOAL_PROBE_GUARD !== "0" && paused && last?.customType === "probe-goal") {
            if (process.env.GOAL_PROBE_TYPED === "1") {
              log("waiting_for_typed_followup");
              await new Promise(resolve => setTimeout(resolve, 1200));
            }
            contextAbort++;
            ctx.abort();
            log("context_abort");
          }
          return { messages: event.messages.filter(message => !paused || message.customType !== "probe-goal") };
        });
        pi.on("agent_settled", (_event, ctx) => {
          editorText = ctx.ui.getEditorText();
          log("settled", { calls: faux.state.callCount, ends, externalSeen, editorText, contextAbort, pending: ctx.hasPendingMessages(), networkAttempts });
          resolveSettled();
        });
        pi.registerCommand("probe-exit", { description: "Exit the queue diagnostic", handler: (_args, ctx) => {
          const messages = ctx.sessionManager.getEntries().map(entry => entry.customType ?? entry.message?.role ?? entry.type);
          log("result", { version, calls: faux.state.callCount, ends, externalSeen, editorText, contextAbort, messages, networkAttempts });
          assert.equal(networkAttempts, 0);
          ctx.shutdown();
        } });
      }],
    },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: "all" }), services, diagnostics: services.diagnostics };
};
runtime = await sdk.createAgentSessionRuntime(factory, { cwd: root, agentDir: join(root, "agent"), sessionManager: sdk.SessionManager.create(root, join(root, "sessions")) });
log("starting", { version, uiBinding: process.env.GOAL_PROBE_SDK === "1" ? "controlled-sdk" : "real-interactive-mode" });
if (process.env.GOAL_PROBE_SDK === "1") {
  await runtime.session.bindExtensions({ mode: "tui", uiContext: { notify() {}, getEditorText: () => "" }, onError: error => log("extension_error", { message: error.message }) });
  await runtime.session.prompt("/probe");
  await settled;
  await runtime.session.prompt("/probe-exit");
  await runtime.dispose();
} else {
  const mode = new sdk.InteractiveMode(runtime, { migratedProviders: [] });
  await mode.run();
}
