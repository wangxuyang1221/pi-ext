import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { responseEvents } from "./budget-fixtures.mjs";
import { expectedPiVersion } from "../../../scripts/pi-host.mjs";

export const families = ["completions", "responses", "anthropic", "google", "codex", "custom"];
export const apiNames = { completions: "openai-completions", responses: "openai-responses", anthropic: "anthropic-messages", google: "google-generative-ai", codex: "openai-codex-responses", custom: "goal-accounting-custom" };
export const usage = (input = 3, output = 4, cacheWrite = 0, cacheRead = 0, reasoning = 0) => ({ input, output, cacheWrite, cacheRead, reasoning, totalTokens: input + output + cacheWrite + cacheRead, cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 } });
export const cacheOnly = usage(0, 0, 0, 20);
export const cache90 = usage(50, 10, 30, 20, 8);
export const text = (value = usage(), extra = {}) => ({ text: "Offline accounting progress", usage: value, ...extra });
export const tool = (name, args, value = cacheOnly, extra = {}) => ({ tool: { name, args }, usage: value, ...extra });

export async function loadSdk(path, expectedVersion = expectedPiVersion) {
  const root = await realpath(resolve(path ?? "node_modules/@earendil-works/pi-coding-agent"));
  const sdk = await import(pathToFileURL(join(root, "dist/index.js")));
  const aiRoot = resolve(root, "../pi-ai");
  const ai = await import(pathToFileURL(join(aiRoot, "dist/index.js")));
  const versions = Object.fromEntries(await Promise.all(["pi-coding-agent", "pi-ai", "pi-agent-core"].map(async name => [name, JSON.parse(await readFile(resolve(root, "..", name, "package.json"), "utf8")).version])));
  assert.equal(versions["pi-coding-agent"], expectedVersion, "Installed Pi accounting runtime version mismatch");
  assert.equal(new Set(Object.values(versions)).size, 1);
  return { root, sdk, ai, aiRoot, versions };
}

// These functions generate wire samples. Only the installed native adapters
// decode them into Pi Usage. Google has no cache-write field in these versions.
export function wireUsage(family, value) {
  if (value === undefined) return undefined;
  if (family === "custom") return value;
  const { input, output, cacheWrite = 0, cacheRead = 0, reasoning = 0 } = value;
  if (family === "anthropic") return { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens_details: { thinking_tokens: reasoning } };
  if (family === "google") {
    assert.equal(cacheWrite, 0, "Google wire samples must not invent cache-write metadata");
    return { promptTokenCount: input + cacheRead, candidatesTokenCount: output - reasoning, cachedContentTokenCount: cacheRead, thoughtsTokenCount: reasoning, totalTokenCount: input + output + cacheRead };
  }
  if (family === "completions") return { prompt_tokens: input + cacheRead + cacheWrite, completion_tokens: output, prompt_tokens_details: { cached_tokens: cacheRead, cache_write_tokens: cacheWrite }, completion_tokens_details: { reasoning_tokens: reasoning }, total_tokens: input + cacheRead + cacheWrite + output };
  return { input_tokens: input + cacheRead + cacheWrite, output_tokens: output, input_tokens_details: { cached_tokens: cacheRead, cache_write_tokens: cacheWrite }, output_tokens_details: { reasoning_tokens: reasoning }, total_tokens: input + cacheRead + cacheWrite + output };
}
export function wireEvents(family, step, id) {
  const raw = Object.hasOwn(step, "raw") ? step.raw : wireUsage(family, step.usage);
  const call = step.tool;
  if (family === "responses" || family === "codex") return responseEvents({ ...step, usage: raw ?? null }, id);
  if (family === "completions") return [
    { id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", ...(call ? { tool_calls: [{ index: 0, id: `call_${id}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: step.text }) }, finish_reason: null }] },
    { id, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] },
    ...(raw === undefined ? [] : [{ id, choices: [], usage: raw }]),
  ];
  if (family === "anthropic") return [
    { type: "message_start", message: { id, type: "message", role: "assistant", content: [], model: "accounting-fixture", stop_reason: null, usage: raw ?? {} } },
    { type: "content_block_start", index: 0, content_block: call ? { type: "tool_use", id: `call_${id}`, name: call.name, input: {} } : { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: call ? { type: "input_json_delta", partial_json: JSON.stringify(call.args) } : { type: "text_delta", text: step.text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: call ? "tool_use" : "end_turn", stop_sequence: null }, ...(raw === undefined ? {} : { usage: raw }) },
    { type: "message_stop" },
  ];
  return [{ responseId: id, candidates: [{ index: 0, content: { role: "model", parts: [call ? { functionCall: { id: `call_${id}`, name: call.name, args: call.args } } : { text: step.text }] }, finishReason: "STOP" }], ...(raw === undefined ? {} : { usageMetadata: raw }) }];
}

export async function offlineModels(loaded, onCall = () => {}) {
  const { ai, aiRoot } = loaded;
  const requests = [], wire = [];
  let steps = [], unexpectedRequests = 0, networkAttempts = 0, googleFetch;
  globalThis.fetch = async (url, init) => {
    const address = String(url?.url ?? url);
    if (address.startsWith("https://goal-google.invalid/") && googleFetch) return googleFetch(url, init);
    networkAttempts++;
    throw new Error("Unexpected network request in offline accounting fixture");
  };
  const models = {}, providers = [];
  for (const family of families) {
    const provider = family === "codex" ? "openai-codex" : `goal-${family}`;
    const model = models[family] = { provider, id: "accounting-fixture", name: "Offline accounting fixture", api: apiNames[family], baseUrl: `https://goal-${family}.invalid/v1`, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 };
    const adapter = family === "custom" ? undefined : await import(pathToFileURL(join(aiRoot, "dist/api", `${apiNames[family]}.js`)));
    const stream = (requestModel, context, options) => {
      const index = requests.length + 1;
      const queued = steps.shift();
      if (!queued) { unexpectedRequests++; throw new Error(`Unexpected accounting request ${index}`); }
      const step = typeof queued === "function" ? queued({ family, index, context }) : queued;
      assert.equal(typeof step?.then, "undefined", "Use step.wait for asynchronous gates");
      if (step.family) assert.equal(family, step.family);
      const id = step.id ?? `accounting_${index}`;
      requests.push({ index, family, api: requestModel.api, provider: requestModel.provider, tools: (context.tools ?? ai.getCurrentTools(context.messages)).map(t => t.name) });
      onCall({ family, index, context, options, step });
      if (family === "custom") {
        const result = ai.createAssistantMessageEventStream();
        void (async () => {
          await step.wait?.(options?.signal);
          const content = step.tool ? [{ type: "toolCall", id: `call_${id}`, name: step.tool.name, arguments: step.tool.args }] : [{ type: "text", text: step.text }];
          const message = { role: "assistant", api: requestModel.api, provider, model: model.id, timestamp: Date.now(), responseId: id, content, stopReason: step.tool ? "toolUse" : "stop", usage: step.usage };
          result.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
          result.push({ type: "done", reason: message.stopReason, message }); result.end(message);
        })();
        return result;
      }
      const fetch = async () => {
        await step.wait?.(options?.signal);
        const events = wireEvents(family, step, id);
        wire.push({ index, family, events });
        const data = events.map(event => `${family === "anthropic" ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join("") + (family === "completions" ? "data: [DONE]\n\n" : "");
        return new Response(data, { status: 200, headers: { "content-type": "text/event-stream" } });
      };
      if (family === "google") googleFetch = fetch;
      const apiKey = family === "codex" ? `offline.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline-fixture" } })).toString("base64url")}.invalid` : "offline-invalid-fixture";
      const onPayload = async payload => {
        const replacement = await options?.onPayload?.(payload, requestModel);
        const sent = replacement ?? payload;
        const definitions = family === "google" ? (sent.config?.tools ?? []).flatMap(t => t.functionDeclarations ?? []) : (sent.tools ?? []).map(t => t.function ?? t);
        const names = definitions.map(t => t.name);
        for (const expected of context.tools ?? ai.getCurrentTools(context.messages)) assert.ok(names.includes(expected.name), `Native ${family} request omitted function tool ${expected.name}`);
        requests.at(-1).serializedTools = names;
        return replacement;
      };
      return adapter.stream(requestModel, context, { ...options, apiKey, onPayload, maxRetries: 0, transport: "sse", ...(family === "google" ? {} : { fetch }) });
    };
    providers.push(ai.createProvider({ id: provider, models: [model], auth: { apiKey: { name: "Offline", resolve: async () => ({ auth: { apiKey: "offline-invalid-fixture" } }) } }, api: { stream, streamSimple: stream } }));
  }
  return { models, providers, requests, wire, setSteps: values => { steps = [...values]; }, verify: () => { assert.equal(unexpectedRequests, 0); assert.equal(networkAttempts, 0); assert.equal(steps.length, 0); }, get networkAttempts() { return networkAttempts; } };
}
