/** Shared execution boundary; inspecting saved goals does not require a provider. */
export function goalCapability(ctx, child = !!process.env.PI_SUBAGENT_PARENT) {
    const reason = child ? "requires a root session"
        : ctx.mode !== "tui" ? "requires interactive TUI mode"
            : !ctx.sessionManager.getSessionFile() ? "requires a persistent session"
                : ctx.model?.provider !== "openai-codex" ? "requires OpenAI Codex" : undefined;
    return reason ? { supported: false, reason } : { supported: true };
}
//# sourceMappingURL=capability.js.map