import { createProvider, createAssistantMessageEventStream, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Drive the lifecycle contract without credentials or a network transport. */
export default function lifecycleProvider(pi: ExtensionAPI): void {
  globalThis.fetch = async () => { throw new Error("Network disabled in lifecycle fixture"); };
  const stream = (_model: unknown, context: Context) => {
    const result = createAssistantMessageEventStream();
    const user = context.messages.filter(message => message.role === "user").at(-1);
    const text = typeof user?.content === "string" ? user.content : user?.content.filter(part => part.type === "text").map(part => part.text).join("\n") ?? "";
    const tool = /Call (integration_\w+) exactly once with marker (\w+)/.exec(text);
    const reply = /(?:reply|Reply) with exactly (\w+)/.exec(text)?.[1];
    const output: AssistantMessage = {
      role: "assistant", api: "lifecycle-fixture", provider: "lifecycle-fixture", model: "deterministic", timestamp: Date.now(),
      stopReason: tool && context.messages.at(-1)?.role !== "toolResult" ? "toolUse" : "stop",
      content: [], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    output.content = output.stopReason === "toolUse"
      ? [{ type: "toolCall", id: `call-${Date.now()}`, name: tool![1], arguments: { marker: tool![2] } }]
      : [{ type: "text", text: reply ?? "No lifecycle instruction" }];
    queueMicrotask(() => { result.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output }); result.end(); });
    return result;
  };
  pi.registerProvider(createProvider({ id: "lifecycle-fixture", models: [{ id: "deterministic", name: "Lifecycle fixture",
    provider: "lifecycle-fixture", api: "lifecycle-fixture", baseUrl: "https://offline.invalid", reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
    auth: { apiKey: { name: "Offline", resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
}
