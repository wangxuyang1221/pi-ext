import { writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Local model fixture: one real MCP echo call, then sustained assistant output. */
export default function fixture(pi: ExtensionAPI): void {
  pi.registerProvider("mcp-render-fixture", {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "offline-fixture",
    models: [{ id: "render-test", name: "Render test", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 4096 }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const afterTool = context.messages.at(-1)?.role === "toolResult";
      const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider,
        model: model.id, timestamp: Date.now(), stopReason: afterTool ? "stop" : "toolUse",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, total: 0, cacheWrite: 0 } } };
      stream.push({ type: "start", partial: message });
      if (!afterTool) {
        const toolCall = { type: "toolCall" as const, id: "live-render-call", name: "mcp__local__echo", arguments: { text: "MCP-TRANSPORT-OK" } };
        message.content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
        stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(toolCall.arguments), partial: message });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
        stream.push({ type: "done", reason: "toolUse", message });
        stream.end();
      } else {
        const block = { type: "text" as const, text: "" };
        message.content.push(block);
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        void (async () => {
          const deadline = Date.now() + 20000;
          for (let i = 0; Date.now() < deadline && !options?.signal?.aborted; i++) {
            const delta = i === 0 ? "STREAMING-START " : `output-${i} 中文🙂 `;
            block.text += delta;
            stream.push({ type: "text_delta", contentIndex: 0, delta, partial: message });
            await new Promise(resolve => setTimeout(resolve, 40));
          }
          block.text += "\nSTREAMING-DONE\n";
          stream.push({ type: "text_delta", contentIndex: 0, delta: "\nSTREAMING-DONE\n", partial: message });
          stream.push({ type: "text_end", contentIndex: 0, content: block.text, partial: message });
          stream.push({ type: "done", reason: "stop", message });
          stream.end();
        })();
      }
      return stream;
    },
  });
  let profiler: Session | undefined;
  pi.registerCommand("render-profile-start", { handler: async (_args, ctx) => {
    if (!process.env.MCP_RENDER_PROFILE || profiler) throw new Error("Profile path required; only one capture is allowed");
    profiler = new Session();
    profiler.connect();
    await new Promise<void>((resolve, reject) => profiler!.post("Profiler.enable", error => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => profiler!.post("Profiler.start", error => error ? reject(error) : resolve()));
    ctx.ui.notify("RENDER-PROFILE-READY", "info");
  } });
  pi.on("session_shutdown", async () => {
    const session = profiler;
    profiler = undefined;
    if (!session) return;
    try {
      const profile = await new Promise<unknown>((resolve, reject) => session.post("Profiler.stop", (error, result) => error ? reject(error) : resolve(result.profile)));
      writeFileSync(process.env.MCP_RENDER_PROFILE!, JSON.stringify(profile));
    } finally { session.disconnect(); }
  });
  pi.on("session_start", (_event, ctx) => ctx.ui.notify("RENDER-HOST-READY", "info"));
  pi.registerCommand("render-quit", { handler: async (_args, ctx) => ctx.shutdown() });
}
