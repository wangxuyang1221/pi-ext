import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { scoreAnswer } from "./codex-compact-cases.mjs";

// Diagnostic only: call the unchanged remote protocol helpers without the
// createNativeCheckpoint local estimated-window rejection. Never install this
// bypass into the extension or change the model window to make a test pass.
const root = path.resolve(".tmp/codex-compact-window");
process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-home");
const config = JSON.parse(fs.readFileSync(path.join(root, "configuration.json"), "utf8"));
const runtime = await ModelRuntime.create({ authPath: path.join(root, "pi-home/auth.json"), modelsPath: null, modelsStorePath: path.join(root, "pi-home/models-store.json"), refreshOnCreate: false });
const registry = new ModelRegistry(runtime);
const model = runtime.getModel("openai-codex", config.model);
const modules = Object.fromEntries(await Promise.all(["old", "new"].map(async (variant) => [variant, await import(path.join(root, `${variant}-dist/native-compaction.js`))])));
const record = (row) => { fs.appendFileSync(path.join(root, "remote-results.jsonl"), JSON.stringify(row) + "\n"); console.log(JSON.stringify(row)); };
function data(repetition) {
  const base = path.join(root, `cli-home-${repetition}/sessions`);
  const file = fs.readdirSync(base, { recursive: true }).find((f) => f.endsWith(".jsonl"));
  const events = fs.readFileSync(path.join(base, file), "utf8").trim().split("\n").map(JSON.parse);
  const input = [];
  for (const event of events) {
    if (event.type === "compacted") return { input, replacement: event.payload.replacement_history, instructions: events[0].payload.base_instructions.text };
    if (event.type === "response_item") { const item = structuredClone(event.payload); delete item.id; delete item.internal_chat_message_metadata_passthrough; input.push(item); }
  }
  throw new Error("No real CLI checkpoint");
}
async function authHeaders(module) {
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) throw new Error("Evaluation authentication unavailable");
  const sessionId = randomUUID();
  return { sessionId, url: `${(auth.baseUrl ?? model.baseUrl).replace(/\/$/, "")}/codex/responses`, headers: module.buildCodexHeaders({ apiKey: auth.apiKey, headers: auth.headers, sessionId }) };
}
async function answer(input, instructions) {
  const { headers, url } = await authHeaders(modules.new);
  const response = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(600000), body: JSON.stringify({ model: config.model, instructions, input: [...input, { type: "message", role: "user", content: [{ type: "input_text", text: config.question }] }], store: false, stream: true, tools: [], tool_choice: "auto", parallel_tool_calls: true, include: ["reasoning.encrypted_content"], reasoning: { effort: "medium", summary: "auto" }, text: { verbosity: "low" } }) });
  if (!response.ok) throw new Error(`Continuation HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const events = (await response.text()).split(/\r?\n/).filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
  const completed = events.findLast((e) => e.type === "response.completed");
  if (!completed) throw new Error("Continuation missing response.completed");
  const text = events.filter((e) => e.type === "response.output_text.delta").map((e) => e.delta).join("");
  return { answer: text, score: scoreAnswer(text, config.expected), inputTokens: completed.response.usage.input_tokens, outputTokens: completed.response.usage.output_tokens };
}
for (let repetition = 1; repetition <= 3; repetition++) {
  const { input, replacement, instructions } = data(repetition);
  for (const [variant, module] of Object.entries(modules)) {
    try {
      const { sessionId, headers, url } = await authHeaders(module);
      const started = performance.now();
      const body = module.buildCompactionRequestBody({ model, input, instructions, tools: [], sessionId, basePayload: { reasoning: { effort: "medium", summary: "auto" } } });
      const remote = await module.callRemoteCompaction({ url, headers, body, model, signal: AbortSignal.timeout(600000) });
      const history = module.buildReplacementHistory(input, remote.compactionItem);
      record({ diagnostic: "remote-only", phase: "compact", repetition, variant, elapsedMs: Math.round(performance.now() - started), sentInputItems: input.length, inputTokens: remote.usage ? remote.usage.input + remote.usage.cacheRead + remote.usage.cacheWrite : undefined, usage: remote.usage });
      record({ diagnostic: "remote-only", phase: "continue", repetition, variant, ...await answer(history, instructions) });
    } catch (error) { record({ diagnostic: "remote-only", repetition, variant, error: error.message }); }
  }
  try { record({ diagnostic: "reference-continuation-recheck", repetition, variant: "cli", ...await answer(replacement, instructions) }); }
  catch (error) { record({ diagnostic: "reference-continuation-recheck", repetition, variant: "cli", error: error.message }); }
}
console.log("Remote diagnostic finished");
