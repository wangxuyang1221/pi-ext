import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/codex-compact/dist/index.js";
import { WindowUsageAccounting } from "../extensions/codex-compact/dist/usage-accounting.js";
import { NATIVE_COMPACTION_KIND, approximateResponseItemTokens, effectiveInputForBranch, piContextInputForBranch, fullInputForBranch } from "../extensions/codex-compact/dist/native-compaction.js";
import { scoreAnswer } from "./codex-compact-cases.mjs";

const root = path.resolve(".tmp/codex-accounting");
const agentDir = path.join(root, "pi-home");
process.env.PI_CODING_AGENT_DIR = agentDir;
const source = path.resolve(".tmp/codex-compact-window");
const config = JSON.parse(fs.readFileSync(path.join(source, "configuration.json"), "utf8"));
const snapshot = path.join(source, "snapshot-sessions");
const file = fs.readdirSync(snapshot, { recursive: true }).find((file) => file.endsWith(".jsonl"));
const events = fs.readFileSync(path.join(snapshot, file), "utf8").trim().split("\n").map(JSON.parse);
const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: path.join(agentDir, "models-store.json"), refreshOnCreate: false });
const model = runtime.getModel("openai-codex", "gpt-5.6-sol");
if (model?.contextWindow !== 272000) throw new Error("Unexpected model window");
const manager = SessionManager.create(root, path.join(root, "sessions"));
manager.appendModelChange(model.provider, model.id);
manager.appendThinkingLevelChange("medium");
const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (content, stopReason = "stop") => ({ role: "assistant", content, provider: model.provider, model: model.id, api: model.api, stopReason, usage: zeroUsage, timestamp: Date.now() });
let imported = 0;
for (const { type, payload: item } of events) {
  if (type !== "response_item") continue;
  imported++;
  if (item.type === "message") {
    const text = item.content.map((part) => part.text ?? "").join("\n");
    if (item.role === "assistant") manager.appendMessage(assistant([{ type: "text", text, ...(item.id ? { textSignature: JSON.stringify({ v: 1, id: item.id, phase: item.phase }) } : {}) }]));
    else if (item.role === "user") manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
    else manager.appendCustomMessageEntry("reference-context", text, false);
  } else if (item.type === "reasoning") {
    manager.appendMessage(assistant([{ type: "thinking", thinking: "", thinkingSignature: JSON.stringify(item) }]));
  } else if (item.type === "custom_tool_call" || item.type === "function_call") {
    manager.appendMessage(assistant([{ type: "toolCall", id: `${item.call_id}|${item.id ?? "fc_imported"}`, name: item.name, arguments: item.type === "custom_tool_call" ? { input: item.input } : JSON.parse(item.arguments) }], "toolUse"));
  } else if (item.type === "custom_tool_call_output" || item.type === "function_call_output") {
    manager.appendMessage({ role: "toolResult", toolCallId: item.call_id, toolName: "exec", content: [{ type: "text", text: typeof item.output === "string" ? item.output : JSON.stringify(item.output) }], isError: false, timestamp: Date.now() });
  } else throw new Error(`Unsupported import item ${item.type}`);
}
const observations = [];
const estimate = WindowUsageAccounting.prototype.estimate;
WindowUsageAccounting.prototype.estimate = function (...args) {
  const result = estimate.apply(this, args);
  observations.push({ event: "accounting", accountedTokens: result ?? null, localHistoryTokens: approximateResponseItemTokens(args[1]) });
  return result;
};
const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: true } });
const loader = new DefaultResourceLoader({
  cwd: root, agentDir, settingsManager: settings,
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
  agentsFilesOverride: () => ({ agentsFiles: [] }),
  systemPromptOverride: () => events.find((event) => event.type === "session_meta").payload.base_instructions.text,
  extensionFactories: [(pi) => {
    pi.on("before_provider_request", (event, ctx) => {
      const input = event.payload.input;
      observations.push({ event: "incoming", items: input.length, candidates: [effectiveInputForBranch, piContextInputForBranch, fullInputForBranch].map((fn) => {
        const candidate = fn({ branch: ctx.sessionManager.getBranch(), model, tools: [] });
        const mismatch = candidate.findIndex((item, index) => !isDeepStrictEqual(item, input[index]));
        return { name: fn.name, items: candidate.length, mismatch, expected: JSON.stringify(candidate[mismatch])?.slice(0,200), actual: JSON.stringify(input[mismatch])?.slice(0,200) };
      }) });
    });
  }, extension, (pi) => {
    pi.on("before_provider_request", (event) => {
      observations.push({ event: "request", items: event.payload.input?.length, checkpoints: event.payload.input?.filter((item) => item.type === "compaction").length });
    });
  }],
});
await loader.reload();
const { session, extensionsResult } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: "medium", noTools: "all", sessionManager: manager, settingsManager: settings, resourceLoader: loader });
if (extensionsResult.errors.length) throw new Error("Extension loading failed");
const results = { piVersion: "0.87.0", model: model.id, effort: "medium", importedItems: imported, importIsNormalized: true, observations, answers: [] };
const timer = setTimeout(() => { void session.abort(); }, 900000);
try {
  for (const prompt of [config.question, "Return the same JSON answer again using only conversation context. Do not use tools."]) {
    await session.prompt(prompt);
    const response = session.messages.findLast((message) => message.role === "assistant");
    const answer = response.content.filter((part) => part.type === "text").map((part) => part.text).join("");
    results.answers.push({ stopReason: response.stopReason, usage: response.usage, score: scoreAnswer(answer, config.expected), answer });
  }
  results.checkpoints = manager.getBranch().filter((entry) => (entry.type === "custom" && entry.customType === NATIVE_COMPACTION_KIND) || (entry.type === "compaction" && entry.details?.kind === NATIVE_COMPACTION_KIND)).length;
  results.sessionFile = session.sessionFile;
} catch (error) {
  results.error = error.message;
} finally {
  clearTimeout(timer);
  session.dispose();
  WindowUsageAccounting.prototype.estimate = estimate;
  const output = path.join(root, `session-result-${Date.now()}.json`);
  fs.writeFileSync(output, JSON.stringify(results, null, 2) + "\n");
  console.log(output);
  console.log(JSON.stringify({ observations, checkpoints: results.checkpoints, scores: results.answers.map((answer) => answer.score), error: results.error }));
}
