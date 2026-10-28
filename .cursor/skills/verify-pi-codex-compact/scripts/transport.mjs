import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";

// This fixture substitutes service responses, never production checkpoint logic.
export default function (pi) {
  const root = resolve(process.env.COMPACT_VERIFY_ROOT ?? "/invalid");
  assert.equal(process.env.PI_TEST_ISOLATED, "1");
  assert.equal(resolve(process.env.PI_CODING_AGENT_DIR), join(root, "agent"));
  const record = (type, data) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ type, pid: process.pid, data }) + "\n");
  const key = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline-verification" } })).toString("base64url")}.c`;
  const sse = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  let serial = 0;
  const originalFetch = globalThis.fetch;
  const fixtureFetch = async (url, init = {}) => {
    const address = String(url);
    if (address.startsWith("https://chatgpt.com/backend-api/codex/models?")) {
      record("catalog", { url: address });
      return Response.json({ models: [{ slug: "gpt-5.5", comp_hash: "2911" }] });
    }
    assert.equal(address, "https://chatgpt.com/backend-api/codex/responses", "Unexpected network destination");
    const body = JSON.parse(new Headers(init.headers).get("content-encoding") === "zstd"
      ? zstdDecompressSync(init.body).toString("utf8") : String(init.body));
    const compact = body.input?.some(item => item.type === "compaction_trigger");
    record(compact ? "compact-request" : "provider-request", body);
    if (compact && JSON.parse(readFileSync(join(root, "scenario.json"), "utf8")).holdCompact) {
      await new Promise((_, reject) => {
        const cancel = () => { record("compact-cancelled", true); reject(new DOMException("Aborted", "AbortError")); };
        if (init.signal?.aborted) cancel();
        else init.signal?.addEventListener("abort", cancel, { once: true });
      });
    }
    const id = `${process.pid}-${++serial}`;
    const item = compact ? { type: "compaction", encrypted_content: `fixture-checkpoint-${id}` }
      : { type: "message", id: `msg-${id}`, role: "assistant", content: [{ type: "output_text", text: "Fixture continuation complete", annotations: [] }] };
    return sse([
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id, status: "completed", usage: { input_tokens: 20, output_tokens: 5 } } },
    ]);
  };
  globalThis.fetch = fixtureFetch;
  pi.registerProvider("openai-codex", {
    api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api", apiKey: key,
    streamSimple: (model, context, options) => streamSimple(model, context, { ...options, apiKey: key, transport: "sse", maxRetries: 0, fetch: fixtureFetch }),
    models: [{ id: "gpt-5.5", name: "Offline Codex verification", reasoning: true, input: ["text", "image"],
      contextWindow: 800000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } }],
  });
  pi.on("session_start", (_event, ctx) => record("start", { session: ctx.sessionManager.getSessionFile() }));
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
