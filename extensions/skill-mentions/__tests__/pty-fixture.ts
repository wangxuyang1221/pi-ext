import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  const root = process.env.SKILL_PTY_ROOT!;
  const record = (type: string, data: unknown) => appendFileSync(join(root, "events.jsonl"), `${JSON.stringify({ type, data })}\n`);
  const faux = fauxProvider({ api: "skill-pty-faux" });
  faux.setResponses(Array.from({ length: 100 }, () => async (context, options) => {
    record("request", context.messages);
    const last = context.messages.at(-1);
    if (last?.role === "user" && JSON.stringify(last).includes("MCP_COMBINATION")) {
      return fauxAssistantMessage({ type: "toolCall", id: "local-echo", name: "mcp__local__echo", arguments: { text: "Tool literal $alpha" } }, { stopReason: "toolUse" });
    }
    // Keep a controlled request open for real TUI queue acceptance.
    if (JSON.stringify(context.messages.at(-1)).includes("QUEUE_HOLD")) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 4000);
        options?.signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    return fauxAssistantMessage("Fixture response");
  }));
  pi.registerProvider(faux.provider);
  pi.on("session_start", (event, ctx) => record("start", { reason: event.reason, mode: ctx.mode, pid: process.pid, tty: process.stdin.isTTY, session: ctx.sessionManager.getSessionFile() }));
  pi.on("resources_discover", () => { record("ready", true); });
  pi.on("input", event => { record("input", event); });
  pi.on("message_end", event => { if (event.message.role === "user") record("user", event.message); });
  pi.on("agent_settled", () => { record("settled", true); });
  pi.on("session_shutdown", event => { record("shutdown", event.reason); });
  pi.registerShortcut("f6", {
    handler: async ctx => {
      record("editor", { text: ctx.ui.getEditorText(), commands: pi.getCommands().map(command => ({ name: command.name, source: command.source, path: command.sourceInfo.path })), tools: pi.getAllTools().map(tool => ({ name: tool.name, path: tool.sourceInfo.path })) });
    },
  });
  pi.registerShortcut("f7", {
    handler: async ctx => { pi.sendUserMessage("/fixture-reload", { expandPromptTemplates: true }); },
  });
  pi.registerCommand("fixture-reload", {
    handler: async (_args, ctx) => { await ctx.reload(); },
  });
  pi.on("tool_execution_end", event => { record("tool", event); });
  pi.registerCommand("fixture-user", {
    handler: async () => {
      pi.sendUserMessage([
        { type: "text", text: "插件 $alpha，继续 $beta. $alpha!" },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==" },
      ]);
    },
  });
}
