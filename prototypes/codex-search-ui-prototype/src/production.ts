// VERIFICATION: Real search execution and rendering; only auth and HTTP are fixture-backed.
import { setTimeout as delay } from "node:timers/promises";
import { createAssistantMessageEventStream, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import search from "../../../extensions/codex-search/src/index.js";
import { args } from "./lab.js";

export default function productionFixture(pi: ExtensionAPI): void {
  codexUi(pi);
  let scene = "success";
  const originalFetch = globalThis.fetch;
  const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.not-a-signature`;
  search(new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerTool") return (tool: ToolDefinition) => target.registerTool({
        ...tool,
        execute(id, params, signal, update, ctx) {
          const modelRegistry = new Proxy(ctx.modelRegistry, {
            get(registry, key) {
              if (key === "getApiKeyForProvider") return async () => token;
              const value = Reflect.get(registry, key, registry);
              return typeof value === "function" ? value.bind(registry) : value;
            },
          });
          return tool.execute(id, params, signal, update, { ...ctx, modelRegistry } as ExtensionContext);
        },
      });
      return Reflect.get(target, property, receiver);
    },
  }));
  pi.on("session_start", () => {
    globalThis.fetch = async (input, init) => {
      if (String(input) !== "https://search-fixture.invalid/codex/responses") throw new Error("Unexpected network request in fixture.");
      const request = JSON.parse(String(init?.body));
      const query = String(request.input[0].content[0].text);
      const second = query.includes("platform.openai.com");
      const requestScene = scene;
      await delay(second ? 4000 : 2000, undefined, { signal: init?.signal ?? undefined });
      if (requestScene === "error" || requestScene === "partial" && second) return new Response("Fixture transport failure", { status: 503 });
      const citations = Array.from({ length: second ? 1 : 2 }, (_, i) => ({ type: "url_citation", title: "Fixture source", url: `https://example.com/${second ? 2 : i}` }));
      const output = [
        ...Array.from({ length: second ? 2 : 3 }, (_, i) => ({ type: "web_search_call", id: `fixture-${second}-${i}`, status: "completed", action: { type: "search", query } })),
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Fixture search result. No external request was made.", annotations: citations }] },
      ];
      const sse = output.map(item => `event: response.output_item.done\ndata: ${JSON.stringify({ item })}\n\n`).join("") +
        `event: response.completed\ndata: ${JSON.stringify({ response: { model: "fixture", usage: { total_tokens: 1 } } })}\n\n`;
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    };
    pi.setActiveTools(["codex_search"]);
  });
  pi.on("session_shutdown", () => { globalThis.fetch = originalFetch; });
  pi.on("input", event => {
    if (!["success", "partial", "error"].includes(event.text.trim())) return { action: "handled" };
    scene = event.text.trim();
    return { action: "continue" };
  });
  pi.registerCommand("production-search", {
    description: "Run the production search against success, partial, or error HTTP fixtures",
    handler: async (value, ctx) => {
      if (!["success", "partial", "error"].includes(value.trim())) { ctx.ui.notify("Use /production-search success|partial|error", "warning"); return; }
      pi.sendUserMessage(value.trim());
    },
  });
  pi.on("tool_call", event => event.toolName === "codex_search" ? undefined : ({ block: true, reason: "Only fixture search is allowed." }));
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this fixture.", exitCode: 1, cancelled: false, truncated: false } }));
  pi.registerProvider("search-ui-fixture", {
    api: "openai-responses", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-not-a-secret",
    models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1 }],
    streamSimple(model, context: Context) {
      const stream = createAssistantMessageEventStream();
      let lastUser = context.messages.length - 1;
      while (lastUser >= 0 && context.messages[lastUser].role !== "user") lastUser--;
      const finished = context.messages.slice(lastUser + 1).some(message => message.role === "toolResult");
      const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        timestamp: Date.now(), stopReason: finished ? "stop" : "toolUse" };
      stream.push({ type: "start", partial: message });
      if (!finished) {
        const toolCall = { type: "toolCall" as const, id: `production-${Date.now()}`, name: "codex_search", arguments: structuredClone(args) };
        message.content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
        stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(args), partial: message });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
      }
      stream.push({ type: "done", reason: finished ? "stop" : "toolUse", message });
      stream.end();
      return stream;
    },
  });
}
