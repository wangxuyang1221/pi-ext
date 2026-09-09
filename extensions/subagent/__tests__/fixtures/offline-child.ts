import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createProvider, createAssistantMessageEventStream, type AssistantMessage, type Model, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentExtension from "../../src/index.js";

export default function offlineChild(pi: ExtensionAPI): void {
  // This fixture has no network transport and cannot use stored credentials.
  globalThis.fetch = async () => { throw new Error("Network disabled in offline fixture"); };
  const model: Model<any> = { id: "deterministic", name: "Offline fixture", provider: "subagent-fixture",
    api: "subagent-fixture", baseUrl: "https://offline.invalid", reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 };
  const stream = (_model: Model<any>, context: Context, options?: SimpleStreamOptions) => {
    const result = createAssistantMessageEventStream();
    void (async () => {
      const user = context.messages.filter((message) => message.role === "user").at(-1);
      const text = typeof user?.content === "string" ? user.content : user?.content
        .filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
      const output: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider,
        model: model.id, timestamp: Date.now(), stopReason: "stop",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      try {
        result.push({ type: "start", partial: output });
        const hold = /hold:([a-z]+)/u.exec(text)?.[1];
        if (hold) {
          await writeFile(join(process.env.HOME!, `started-${hold}`), "ready");
          while (!existsSync(join(process.env.HOME!, `release-${hold}`))) {
            await delay(10, undefined, { signal: options?.signal });
          }
        }
        if (text.includes("fail-fixture")) throw new Error("HTTP 401: offline fixture error");
        output.content = [{ type: "text", text: `reply:${text}` }];
        result.push({ type: "done", reason: "stop", message: output });
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? "aborted" : "error";
        output.errorMessage = error instanceof Error ? error.message : String(error);
        result.push({ type: "error", reason: output.stopReason, error: output });
      } finally { result.end(); }
    })();
    return result;
  };
  pi.registerProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: "Offline", resolve: async () => ({ auth: {} }) } },
    api: { stream, streamSimple: stream } }));
  subagentExtension(pi);
}
