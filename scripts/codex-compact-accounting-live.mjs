import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createNativeCheckpoint } from "../extensions/codex-compact/dist/remote-compaction.js";
import * as native from "../extensions/codex-compact/dist/native-compaction.js";
import { scoreAnswer } from "./codex-compact-cases.mjs";

const root = path.resolve(".tmp/codex-accounting");
const previous = path.resolve(".tmp/codex-compact-window");
const config = JSON.parse(fs.readFileSync(path.join(previous, "configuration.json"), "utf8"));
const prepared = JSON.parse(fs.readFileSync(path.join(previous, "prepared.json"), "utf8"));
const snapshot = path.join(previous, "snapshot-sessions");
const files = fs.readdirSync(snapshot, { recursive: true }).filter((name) => name.endsWith(".jsonl") && name.includes(prepared.thread));
if (files.length !== 1) throw new Error("Expected one frozen precompaction rollout");
const events = fs.readFileSync(path.join(snapshot, files[0]), "utf8").trim().split("\n").map(JSON.parse);
if (events.some((event) => event.type === "compacted")) throw new Error("Snapshot already compacted");
const input = events.filter((event) => event.type === "response_item").map(({ payload }) => {
  const item = structuredClone(payload);
  delete item.id;
  delete item.internal_chat_message_metadata_passthrough;
  return item;
});
const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
if (digest !== prepared.historySha256) throw new Error("Snapshot history changed");
const instructions = events.find((event) => event.type === "session_meta").payload.base_instructions.text;
process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-home");
const runtime = await ModelRuntime.create({ authPath: path.join(root, "pi-home/auth.json"), modelsPath: null, modelsStorePath: path.join(root, "pi-home/models-store.json"), refreshOnCreate: false });
const registry = new ModelRegistry(runtime);
const model = runtime.getModel("openai-codex", "gpt-5.6-sol");
if (model?.contextWindow !== 272000) throw new Error("Unexpected model window");
const resultFile = path.join(root, "normal-results.jsonl");
if (fs.existsSync(resultFile)) throw new Error("Refusing to overwrite previous evaluation");
const record = (result) => {
  fs.appendFileSync(resultFile, JSON.stringify(result) + "\n");
  console.log(JSON.stringify(result));
};
for (let repetition = 1; repetition <= 3; repetition++) {
  const sessionId = randomUUID();
  const ctx = { model, thinkingLevel: "medium", cwd: root, isProjectTrusted: () => false, modelRegistry: registry, sessionManager: { getSessionId: () => sessionId }, getSystemPrompt: () => instructions };
  const start = performance.now();
  try {
    // Production entry: no preflight bypass, window override, or history suffix.
    const checkpoint = await createNativeCheckpoint({ ctx, model, input, allTools: [], activeToolNames: [], signal: AbortSignal.timeout(600000) });
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) throw new Error("Evaluation authentication unavailable");
    const response = await fetch(`${(auth.baseUrl ?? model.baseUrl).replace(/\/$/, "")}/codex/responses`, {
      method: "POST", headers: native.buildCodexHeaders({ apiKey: auth.apiKey, headers: auth.headers, sessionId }), signal: AbortSignal.timeout(600000),
      body: JSON.stringify({ model: model.id, instructions, input: [...checkpoint.details.replacementHistory, { type: "message", role: "user", content: [{ type: "input_text", text: config.question }] }], store: false, stream: true, tools: [], tool_choice: "auto", parallel_tool_calls: true, include: ["reasoning.encrypted_content"], reasoning: { effort: "medium", summary: "auto" }, text: { verbosity: "low" } }),
    });
    if (!response.ok) throw new Error(`Continuation HTTP ${response.status}`);
    const stream = (await response.text()).split(/\r?\n/).filter((line) => line.startsWith("data: ") && line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)));
    const completed = stream.findLast((event) => event.type === "response.completed");
    if (!completed) throw new Error("Continuation missing response.completed");
    const answer = stream.filter((event) => event.type === "response.output_text.delta").map((event) => event.delta).join("");
    record({ repetition, phase: "normal-entry", model: model.id, effort: "medium", inputHistorySha256: digest, inputItems: input.length, sourceServerUsage: prepared.lastUsage, autoLimit: 244800, effectiveWindow: 258400, localEstimate: native.approximateCompactionRequestTokens({ input, instructions, tools: [] }), compactionUsage: checkpoint.usage, continuationUsage: completed.response.usage, score: scoreAnswer(answer, config.expected), answer, elapsedMs: Math.round(performance.now() - start) });
  } catch (error) {
    record({ repetition, phase: "normal-entry", error: error.message, elapsedMs: Math.round(performance.now() - start) });
  }
}
