import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

/** Substitute only the remote model/summary, retaining the real session and tool paths. */
export default function workingProvider(pi: ExtensionAPI): void {
  const root = process.env.LOCAL_REFRESH_EVIDENCE!;
  const record = (type: string, data: unknown) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ type, data, at: performance.now() }) + "\n");
  let attempt = 0;
  let scenario = "";
  const faux = fauxProvider({ tokensPerSecond: 200, tokenSize: { min: 2, max: 2 }, models: [{ id: "faux-1", reasoning: true, contextWindow: 128000, maxTokens: 2048 }] });
  faux.setResponses(Array.from({ length: 300 }, () => async context => {
    const plan = JSON.parse(readFileSync(join(root, "plan.json"), "utf8")) as { kind: string; id: string };
    if (scenario !== plan.id) { scenario = plan.id; attempt = 0; }
    attempt++;
    record("request", { kind: plan.kind, attempt, last: context.messages.at(-1)?.role });
    if (plan.kind === "retry" && attempt === 1) return fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 rate limit fixture" });
    if (plan.kind === "compact" && attempt === 1) return fauxAssistantMessage("", { stopReason: "error", errorMessage: "maximum context length exceeded" });
    if (plan.kind === "error") return fauxAssistantMessage("FINAL-ERROR", { stopReason: "error", errorMessage: "Nonretryable fixture failure" });
    if ((plan.kind === "tool" || plan.kind === "cancel") && context.messages.at(-1)?.role === "user") {
      return fauxAssistantMessage([{ type: "toolCall", id: `working-${plan.id}`, name: "bash", arguments: {
        command: plan.kind === "cancel" ? "printf CANCEL-TOOL-ENTERED; sleep 30; printf LATE > should-not-exist.txt" : "printf TOOL-ENTERED; sleep 3; printf TOOL-FINISHED > tool-proof.txt",
      } }], { stopReason: "toolUse" });
    }
    if (plan.kind === "stream") return fauxAssistantMessage([
      { type: "thinking", thinking: "VISIBLE-THINKING " + "reasoning 中文 ".repeat(80) },
      { type: "text", text: "VISIBLE-TEXT " + "received output 中文. ".repeat(2500) },
    ]);
    await delay(2500);
    return fauxAssistantMessage(`DONE-${plan.kind}`);
  }));
  pi.registerProvider(faux.provider);
  pi.on("session_start", (event, ctx) => {
    ctx.ui.setStatus("goal", "Goal: active | Keep the second footer row intact");
    record("start", { reason: event.reason, pid: process.pid, tty: process.stdin.isTTY, session: ctx.sessionManager.getSessionFile() });
  });
  pi.on("agent_start", event => record("agent_start", event));
  pi.on("agent_end", event => record("agent_end", event));
  pi.on("agent_settled", event => record("agent_settled", event));
  pi.on("ui_prompt_start", event => record("ui_prompt_start", event));
  pi.on("ui_prompt_end", event => record("ui_prompt_end", event));
  pi.on("tool_execution_start", event => record("tool_execution_start", event));
  pi.on("tool_execution_update", event => record("tool_execution_update", event));
  pi.on("tool_execution_end", event => record("tool_execution_end", event));
  pi.on("session_compact", event => record("session_compact", event));
  pi.on("session_compact_failed", event => record("session_compact_failed", event));
  pi.on("session_shutdown", event => record("session_shutdown", event));
  pi.on("session_before_compact", async (event, ctx) => {
    record("compaction", { reason: event.reason, willRetry: event.willRetry });
    await delay(3000, undefined, { signal: event.signal });
    const first = ctx.sessionManager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "user");
    if (!first) return { cancel: true };
    return { compaction: { summary: "Offline summary for working lifecycle", firstKeptEntryId: first.id, tokensBefore: event.preparation.tokensBefore } };
  });
  pi.registerShortcut("f6", { handler: async ctx => record("editor", ctx.ui.getEditorText()) });
  pi.registerShortcut("f7", { handler: async ctx => {
    await ctx.ui.custom<void>((_tui, _theme, _keys, done) => ({ render: () => ["WORKING OVERLAY", "Type q to close"], invalidate() {},
      handleInput(data: string) { if (data === "q" || matchesKey(data, "escape")) done(); },
    }), { overlay: true, overlayOptions: { width: 32 } });
    record("overlayClosed", true);
  } });
  pi.registerShortcut("f8", { handler: async ctx => { await ctx.ui.input("WORKING INPUT", "Type answer"); record("inputClosed", true); } });
  pi.registerShortcut("f9", { handler: async ctx => { record("theme", ctx.ui.setTheme(ctx.ui.theme.name === "light" ? "codex-pi" : "light")); } });
  pi.registerCommand("fixture-reload", { handler: async (_args, ctx) => { await ctx.reload(); } });
}
