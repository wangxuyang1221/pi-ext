import { zstdDecompressSync } from "node:zlib";
import { appendFile } from "node:fs/promises";
import { writeJsonAtomic } from "../../../../test-support/files.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createProvider } from "@earendil-works/pi-ai";
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inspectPiHost } from "../../../../scripts/pi-host.mjs";
import { responseEvents, textStep, toolStep } from "../../../goal/__tests__/budget-fixtures.mjs";

/** Replace only Codex HTTP transport, retaining its real request builder and SSE parser. */
export async function fastProvider(logPath: string, directory: string) {
  const adapter = await import(new URL("../../../../node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js", import.meta.url).href);
  const model = { id: "fast-fixture", name: "Offline Fast fixture", provider: "openai-codex", api: "openai-codex-responses",
    baseUrl: "https://offline.invalid", reasoning: true, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 };
  const key = `offline.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture" } })).toString("base64url")}.fixture`;
  const stream = (selected: any, context: any, options: any, simple = false) => {
    const user = context.messages.filter((message: any) => message.role === "user").at(-1);
    const text = typeof user?.content === "string" ? user.content : user?.content?.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") ?? "";
    const isToolTurn = context.messages.at(-1)?.role === "toolResult";
    const step = text.startsWith("spawn:") && !isToolTurn ? toolStep("subagent_spawn", JSON.parse(text.slice(6)))
      : text === "reject-fast" ? { error: "unsupported_service_tier" }
      : text === "other-error" ? { error: "HTTP 400 invalid input" }
      : textStep(`reply:${text}`);
    return (simple ? adapter.streamSimple : adapter.stream)(selected, context, { ...options, apiKey: key, transport: "sse", maxRetries: 0,
      fetch: async (_url: unknown, init: any) => {
        const payload = JSON.parse(new Headers(init.headers).get("content-encoding") === "zstd"
          ? zstdDecompressSync(init.body).toString("utf8") : String(init.body));
        await appendFile(logPath, JSON.stringify({ text, payload }) + "\n");
        const hold = !text.startsWith("spawn:") && /hold:([a-z]+)/u.exec(text)?.[1];
        while (hold && !existsSync(join(directory, `release-${hold}`))) await delay(20, undefined, { signal: options?.signal });
        return new Response(responseEvents(step, `fixture_${Date.now()}`).map((event: any) => `data: ${JSON.stringify(event)}\n\n`).join(""),
          { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
  };
  return { model, provider: createProvider({ id: model.provider, models: [model, { ...model, id: "role-fixture", name: "Offline role fixture" }],
    auth: { apiKey: { name: "Offline", resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: (selected: any, context: any, options: any) => stream(selected, context, options, true) } } as any) };
}

export default async function install(pi: ExtensionAPI): Promise<void> {
  const directory = process.env.HOME!;
  pi.registerProvider((await fastProvider(join(directory, `payload-${process.pid}.jsonl`), directory)).provider);
  pi.on("session_start", async (_event, ctx) => {
    const path = join(directory, `start-${process.pid}.json`);
    await writeJsonAtomic(path, { hostVersion: VERSION, versions: inspectPiHost().versions, sessionId: ctx.sessionManager.getSessionId(),
      entries: ctx.sessionManager.getEntries(), tools: pi.getAllTools(), launch: process.env.PI_SUBAGENT_LAUNCH,
      parent: process.env.PI_SUBAGENT_PARENT });
  });
}
