import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { approximateCompactionRequestTokens, findNativeCheckpoint } from "../../../../extensions/codex-compact/dist/native-compaction.js";

// This fixture substitutes service responses, never production checkpoint logic.
export default function (pi) {
  const root = resolve(process.env.COMPACT_VERIFY_ROOT ?? "/invalid");
  assert.equal(process.env.PI_TEST_ISOLATED, "1");
  assert.equal(resolve(process.env.PI_CODING_AGENT_DIR), join(root, "agent"));
  const record = (type, data) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ type, pid: process.pid, data }) + "\n");
  const key = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline-verification" } })).toString("base64url")}.c`;
  const sse = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  const scenario = () => JSON.parse(readFileSync(join(root, "scenario.json"), "utf8"));
  let serial = 0;
  let ordinary = 0;
  let toolCalls = 0;
  let activeContext;
  const originalFetch = globalThis.fetch;
  const fixtureFetch = async (url, init = {}) => {
    const address = String(url);
    if (address.startsWith("https://chatgpt.com/backend-api/codex/models?")) {
      record("catalog", { url: address });
      return Response.json({ models: ["gpt-5.5", "fixture-same", "fixture-other", "fixture-small", "fixture-tight"].map(slug => ({ slug, comp_hash: slug === "fixture-other" || slug === "fixture-small" ? "2912" : "2911" })) });
    }
    assert.equal(address, "https://chatgpt.com/backend-api/codex/responses", "Unexpected network destination");
    const body = JSON.parse(new Headers(init.headers).get("content-encoding") === "zstd"
      ? zstdDecompressSync(init.body).toString("utf8") : String(init.body));
    const compact = body.input?.some(item => item.type === "compaction_trigger");
    record(compact ? "compact-request" : "provider-request", body);
    if (!compact && body.model === "fixture-tight") record("tight-request-budget", {
      tokens: approximateCompactionRequestTokens(body), effectiveWindow: 11400,
    });
    if (compact && scenario().compactFailure) return Response.json({ error: { code: "invalid_api_key", message: "Fixture authentication failure" } }, { status: 401 });
    if (!compact && scenario().normalFailure) return sse([{ type: "response.failed", response: { error: { code: "fixture_failure", message: "Fixture ordinary request failed" } } }]);
    if (!compact && scenario().overflow && (++ordinary === 1 || scenario().overflow === "repeat")) {
      return sse([{ type: "response.failed", response: { error: { code: "context_length_exceeded", message: "Context length exceeded" } } }]);
    }
    if (compact && scenario().holdCompact) {
      await new Promise((resume, reject) => {
        const timer = setInterval(() => {
          if (!scenario().holdCompact) {
            clearInterval(timer);
            init.signal?.removeEventListener("abort", cancel);
            record("compact-released", true);
            resume();
          }
        }, 25);
        const cancel = () => { clearInterval(timer); record("compact-cancelled", true); reject(new DOMException("Aborted", "AbortError")); };
        if (init.signal?.aborted) cancel();
        else init.signal?.addEventListener("abort", cancel, { once: true });
      });
    }
    const id = `${process.pid}-${++serial}`;
    const tool = !compact && scenario().callTool && toolCalls++ === 0;
    const inputTokens = compact ? 20 : scenario().usage ?? 20;
    const outputTokens = !compact && scenario().usage === 0 ? 0 : 5;
    const item = compact ? { type: "compaction", encrypted_content: `fixture-checkpoint-${id}` }
      : tool ? { type: "function_call", id: `fc-${id}`, call_id: `call-${id}`, name: "fixture_read", arguments: "{}" }
      : { type: "message", id: `msg-${id}`, role: "assistant", content: [{ type: "output_text", text: "Fixture continuation complete", annotations: [] }] };
    return sse([
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id, status: "completed", usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens } } },
    ]);
  };
  globalThis.fetch = fixtureFetch;
  const model = (id, contextWindow = 800000) => ({ id, name: id, reasoning: true, input: ["text", "image"],
    contextWindow, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } });
  const provider = models => ({
    api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api", apiKey: key,
    streamSimple: (model, context, options) => {
      record("adapter", { model: model.id, options: Object.keys(options ?? {}) });
      return streamSimple(model, context, { ...options, apiKey: key, transport: "sse", maxRetries: 0, fetch: fixtureFetch,
        onPayload: async (payload, selected) => {
          if (model.id === "fixture-tight") {
            const checkpoint = findNativeCheckpoint(activeContext.sessionManager.getBranch());
            assert.equal(checkpoint.status, "valid");
            record("tight-preparation-budget", {
              rawPayloadTokens: approximateCompactionRequestTokens(payload), effectiveWindow: 11400,
              tokens: approximateCompactionRequestTokens({ ...payload, input: checkpoint.checkpoint.details.replacementHistory }),
            });
          }
          let projected = payload;
          if (scenario().prefixMismatch) {
            // Model an incompatible adapter/extension projection before production validation.
            projected = { ...payload, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "INCOMPATIBLE_HISTORY_PREFIX" }] }, payload.input.at(-1)] };
            record("prefix-mismatch-injected", { model: model.id, originalInput: payload.input, projectedInput: projected.input });
          }
          return await options?.onPayload?.(projected, selected) ?? projected;
        },
      });
    },
    models,
  });
  pi.registerProvider("openai-codex", provider([model("gpt-5.5"), model("fixture-same"), model("fixture-other"), model("fixture-small", 400000), model("fixture-tight", 12000)]));
  pi.registerProvider("fixture-replay", provider([model("fixture-noncodex")]));
  pi.registerTool({ name: "fixture_read", label: "Fixture read", description: "Read fixed offline data", parameters: { type: "object", properties: {} },
    execute: async () => {
      record("tool-read", true);
      pi.registerTool({ name: "fixture_late", label: "Fixture late", description: "A newly available tool", parameters: { type: "object", properties: {} },
        execute: async () => { throw new Error("Unexpected late tool call"); } });
      pi.setActiveTools([...pi.getActiveTools(), "fixture_late"]);
      return { content: [{ type: "text", text: "FIXTURE_TOOL_RESULT" }], details: {} };
    } });
  pi.registerCommand("fixture-change-tools", { description: "Change declarations while the service response is pending", handler: async () => {
    pi.registerTool({ name: "fixture_changed", label: "Changed tool", description: "A declaration added during compaction", parameters: { type: "object", properties: {} },
      execute: async () => { throw new Error("Unexpected changed tool call"); } });
    pi.setActiveTools([...pi.getActiveTools(), "fixture_changed"]);
    record("tools-changed", true);
  } });
  pi.on("before_agent_start", () => scenario().systemPrompt ? { systemPrompt: scenario().systemPrompt } : undefined);
  pi.on("model_select", (event, ctx) => record("model-select", { model: ctx.model?.id, event }));
  pi.on("session_tree", (event, ctx) => record("tree", { leaf: ctx.sessionManager.getLeafId(), event }));
  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    pi.setActiveTools(scenario().emptyTools ? [] : [...new Set([...pi.getActiveTools(), "fixture_read"])]);
    record("start", { session: ctx.sessionManager.getSessionFile() });
  });
  pi.on("resources_discover", () => record("ready", true));
  pi.on("agent_settled", () => record("settled", true));
  pi.on("session_compact", (event, ctx) => record("compacted", { reason: event.reason, entries: ctx.sessionManager.getEntries().filter(entry => entry.type === "compaction") }));
  pi.on("session_shutdown", () => { record("shutdown", true); globalThis.fetch = originalFetch; });
  pi.registerCommand("fixture-history", {
    description: "Submit a fixed long user message and image for offline verification",
    handler: async () => pi.sendUserMessage([
      { type: "text", text: "BEGIN_RETAIN_" + "x".repeat(280000) + "_END_RETAIN" },
      { type: "text", text: "PICTURE_LABEL" },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==" },
    ]),
  });
}
