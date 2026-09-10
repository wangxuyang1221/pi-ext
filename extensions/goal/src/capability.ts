import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Shared execution boundary; inspecting saved goals does not require a provider. */
export function goalCapability(ctx: ExtensionContext, child = !!process.env.PI_SUBAGENT_PARENT): { supported: boolean; reason?: string } {
  const reason = child ? "requires a root session"
    : ctx.mode !== "tui" ? "requires interactive TUI mode"
      : !ctx.sessionManager.getSessionFile() ? "requires a persistent session"
        : ctx.model?.provider !== "openai-codex" ? "requires OpenAI Codex" : undefined;
  return reason ? { supported: false, reason } : { supported: true };
}
