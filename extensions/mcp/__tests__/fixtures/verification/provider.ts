import { appendFileSync } from "node:fs";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Replaces only the model boundary while retaining native commands and tool execution. */
export default function verificationProvider(pi: ExtensionAPI): void {
  const record = (type: string, data: unknown) => appendFileSync(
    process.env.AUDIT_EVENTS!, `${JSON.stringify({ type, data })}\n`,
  );
  const faux = fauxProvider({ api: "mcp-verification-faux" });
  faux.setResponses(Array.from({ length: 100 }, () => async (context) => {
    record("request", context);
    const last = context.messages.at(-1);
    if (last?.role === "user") {
      const text = typeof last.content === "string" ? last.content : last.content
        .filter((block) => block.type === "text").map((block) => block.text).join("");
      const match = text.match(/^CALL (\S+) (.+)$/);
      if (match) return fauxAssistantMessage({
        type: "toolCall", id: `verification-${Date.now()}`, name: match[1], arguments: JSON.parse(match[2]),
      }, { stopReason: "toolUse" });
    }
    return fauxAssistantMessage("MCP RESPONSE COMPLETE");
  }));
  pi.registerProvider(faux.provider);
  pi.on("resources_discover", () => record("resources", true));
  pi.on("session_start", (_event, ctx) => {
    record("ready", { session: ctx.sessionManager.getSessionFile(), trusted: ctx.isProjectTrusted() });
    ctx.ui.notify("MCP VERIFICATION READY", "info");
  });
  pi.on("tool_execution_end", (event) => record("tool", event));
  pi.on("agent_settled", (_event, ctx) => record("settled", {
    session: ctx.sessionManager.getSessionFile(), leaf: ctx.sessionManager.getLeafId(),
  }));
}
