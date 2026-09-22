import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SessionRuntimeHost } from "./runtime-host.js";

export const rejectionMessages = {
  authentication_unavailable: "Child authentication unavailable; configure credentials for the child's selected provider",
  authentication_failed: "Child authentication resolution failed; check the selected provider's authentication configuration",
  model_unavailable: "Child has no selected model",
} as const;
export type PromptRejectionCode = keyof typeof rejectionMessages;

/** Report only rejections that this handler actually prevents from submitting. */
export function installAuthenticationPreflight(pi: ExtensionAPI, host: SessionRuntimeHost): void {
  pi.on("input", async (event, ctx) => {
    if (!ctx.isIdle()) return;
    const pending = await host.pendingPrompt(event.text, ctx.sessionManager.getSessionId());
    if (!pending) return;
    let code: PromptRejectionCode | undefined;
    try {
      if (!ctx.model) code = "model_unavailable";
      else if (!ctx.modelRegistry.hasConfiguredAuth(ctx.model)
        && !await ctx.modelRegistry.getProviderAuth(ctx.model.provider)) code = "authentication_unavailable";
    } catch {
      // Provider exceptions may contain credentials or command output. Never persist them.
      code = "authentication_failed";
    }
    if (!code) return;
    try { await host.rejectPrompt(pending, code); }
    catch { /* Leave the delivery unknown if a receipt cannot be safely persisted. */ }
    return { action: "handled" };
  });
}
