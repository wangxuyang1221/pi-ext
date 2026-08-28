export function shouldAutoCompact(params) {
    const { status, limit, scope, reason = "automatic" } = params;
    if (reason === "downshift") {
        if (scope === "bodyAfterPrefix")
            return status.activeContextTokens >= status.contextWindow;
        return status.activeContextTokens > limit || status.activeContextTokens >= status.contextWindow;
    }
    const scoped = scope === "bodyAfterPrefix"
        ? status.prefillTokens === undefined
            ? 0
            : Math.max(0, status.activeContextTokens - status.prefillTokens)
        : status.activeContextTokens;
    return scoped >= limit || status.activeContextTokens >= status.contextWindow;
}
//# sourceMappingURL=scheduler.js.map