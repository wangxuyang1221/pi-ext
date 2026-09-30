import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";

/** Exercises public session commands without model or network requests. */
export default function resumeFixture(pi: ExtensionAPI): void {
  pi.registerProvider("mcp-ui-host-fixture", {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "offline-fixture",
    models: [{ id: "ui-test", name: "UI test", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const done = context.messages.at(-1)?.role === "toolResult";
      const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider,
        model: model.id, timestamp: Date.now(), stopReason: done ? "stop" : "toolUse",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: "start", partial: message });
      if (done) {
        message.content.push({ type: "text", text: "MCP-LIVE-DONE" });
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({ type: "text_delta", contentIndex: 0, delta: "MCP-LIVE-DONE", partial: message });
        stream.push({ type: "text_end", contentIndex: 0, content: "MCP-LIVE-DONE", partial: message });
      } else {
        const toolCall = { type: "toolCall" as const, id: "live-call", name: "mcp__local__echo", arguments: { text: "live-result" } };
        message.content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
        stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(toolCall.arguments), partial: message });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
      }
      stream.push({ type: "done", reason: done ? "stop" : "toolUse", message });
      stream.end();
      return stream;
    },
  });
  pi.on("project_trust", (event) => ({ trusted: event.cwd === process.env.MCP_HISTORY_UNTRUSTED_CWD ? "no" : "yes" }));
  const ready = (ctx: ExtensionContext) => {
    if (process.env.MCP_HISTORY_READY) appendFileSync(process.env.MCP_HISTORY_READY,
      JSON.stringify({ sessionFile: ctx.sessionManager.getSessionFile(), cwd: ctx.cwd, mode: ctx.mode }) + "\n");
    if (ctx.cwd === process.env.MCP_HISTORY_UNTRUSTED_CWD) {
      if (ctx.isProjectTrusted()) throw new Error("Fixture target unexpectedly trusted");
      ctx.ui.notify("MCP-UNTRUSTED-READY", "info");
    }
    ctx.ui.notify("MCP UI host ready", "info");
  };
  pi.on("session_start", (_event, ctx) => ready(ctx));
  const withSession = (ctx: ExtensionContext) => ready(ctx);
  pi.on("input", () => ({ action: process.env.MCP_HISTORY_LIVE === "1" ? "continue" : "handled" }));
  pi.on("tool_result", (event) => {
    if (process.env.MCP_HISTORY_TRACE) appendFileSync(process.env.MCP_HISTORY_TRACE, JSON.stringify(event) + "\n");
  });
  pi.registerCommand("mcp-ui-quit", { handler: async (_args, ctx) => ctx.shutdown() });
  let cancelNext = false;
  pi.on("session_before_switch", () => {
    if (!cancelNext) return;
    cancelNext = false;
    return { cancel: true };
  });
  pi.registerCommand("fixture-cancel", { handler: async (path, ctx) => {
    cancelNext = true;
    const result = await ctx.switchSession(path);
    if (!result.cancelled) throw new Error("Expected cancelled fixture switch");
    ctx.ui.notify("MCP-SWITCH-CANCELLED", "info");
  } });
  pi.registerCommand("fixture-cross", { handler: async (path, ctx) => {
    delete process.env.PI_MCP_CONFIG;
    await ctx.switchSession(path, { withSession });
  } });
  pi.registerCommand("fixture-resume", { handler: async (path, ctx) => { await ctx.switchSession(path, { withSession }); } });
  pi.registerCommand("fixture-tree", { handler: async (id, ctx) => { await ctx.navigateTree(id, { summarize: false }); } });
  pi.registerCommand("fixture-clone-last", { handler: async (_args, ctx) => {
    await ctx.fork(ctx.sessionManager.getLeafId()!, { position: "at", withSession });
  } });
  pi.registerCommand("fixture-empty-fork", { handler: async (_args, ctx) => {
    const entry = ctx.sessionManager.getEntries().find((item) => item.type === "message" && item.message.role === "user");
    if (!entry) throw new Error("Missing fixture user entry");
    await ctx.fork(entry.id, { withSession });
  } });
  pi.registerCommand("fixture-clone", { handler: async (id, ctx) => { await ctx.fork(id, { position: "at", withSession }); } });
  pi.registerCommand("fixture-fork", { handler: async (id, ctx) => { await ctx.fork(id, { withSession }); } });
  pi.registerCommand("fixture-new", { handler: async (_args, ctx) => { await ctx.newSession({ withSession }); } });
}
