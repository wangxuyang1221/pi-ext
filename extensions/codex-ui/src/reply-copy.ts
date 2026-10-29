import { copyToClipboard, type ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Copy the latest completed reply from the active context without display transforms. */
export async function copyLastReply(ctx: ExtensionContext): Promise<void> {
  const sessionId = ctx.sessionManager.getSessionId();
  try {
    const assistant = ctx.sessionManager.buildSessionProjection().messages
      .filter(message => message.role === "assistant")
      .reverse().find(message => message.stopReason !== "aborted" || message.content.length > 0);
    const text = assistant?.content.filter(block => block.type === "text").map(block => block.text).join("");
    if (!text?.trim()) {
      ctx.ui.notify("No agent messages to copy yet.", "error");
      return;
    }
    await copyToClipboard(text);
    if (ctx.sessionManager.getSessionId() === sessionId) {
      ctx.ui.notify("Copied last agent message to clipboard", "info");
    }
  } catch (error) {
    if (ctx.sessionManager.getSessionId() === sessionId) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }
}
