import assert from "node:assert/strict";

// Constructed Responses API fixtures, not captured paid model traffic. Both
// supported versions parse these through their actual installed Codex adapter.
export const rawUsage = (input = 120, cached = 40, output = 20, reasoning = 8) => ({ input_tokens: input, input_tokens_details: { cached_tokens: cached }, output_tokens: output, output_tokens_details: { reasoning_tokens: reasoning }, total_tokens: input + output });
export const textStep = (text, usage = rawUsage(7, 0, 3, 1), extra = {}) => ({ text, usage, ...extra });
export const toolStep = (name, args, usage = rawUsage(), extra = {}) => ({ tool: { name, args }, usage, ...extra });
export function responseEvents(step, id) {
  if (step.error) return [{ type: "error", code: step.error, message: step.error }];
  const item = step.tool
    ? { type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name: step.tool.name, arguments: JSON.stringify(step.tool.args), status: "completed" }
    : { type: "message", role: "assistant", id: `msg_${id}`, status: "completed", content: [{ type: "output_text", text: step.text ?? "", annotations: [] }] };
  return [
    { type: "response.created", response: { id, status: "in_progress" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, ...(step.tool ? { arguments: "" } : { content: [] }) } },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id, status: step.status ?? "completed", output: [item], ...(step.usage === null ? {} : { usage: step.usage }), ...(step.incompleteReason ? { incomplete_details: { reason: step.incompleteReason } } : {}) } },
  ];
}
export function offlineCodex(ai, adapter, steps, onCall = () => {}) {
  let calls = 0;
  const contexts = [];
  const fakeKey = `offline.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline-fixture" } })).toString("base64url")}.fixture`;
  const model = { id: "goal-budget-fixture", name: "Offline Codex budget fixture", provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://offline.invalid", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 };
  const stream = (requestModel, context, options) => {
    const index = calls++;
    const step = steps[index];
    assert.ok(step, `Unexpected model call ${index + 1}`);
    contexts.push(JSON.parse(JSON.stringify(context)));
    onCall(index, context, options);
    const result = adapter.stream(requestModel, context, { ...options, apiKey: fakeKey, transport: "sse", maxRetries: 0,
      fetch: async () => {
        if (step.wait) await step.wait(options?.signal);
        const events = responseEvents(step, step.id ?? `resp_fixture_${index + 1}`);
        return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    // A separate observer cannot consume this stream; SDK owns its iteration.
    return result;
  };
  const provider = ai.createProvider({ id: "openai-codex", models: [model], auth: { apiKey: { name: "Offline", resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } });
  return { provider, model, contexts, stream, calls: () => calls };
}
