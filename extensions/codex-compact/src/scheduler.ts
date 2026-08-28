export type AutoCompactScope = "total" | "bodyAfterPrefix";

export type TokenStatus = {
	activeContextTokens: number;
	contextWindow: number;
	prefillTokens?: number;
};

export type AutoCompactReason = "automatic" | "downshift";

export function shouldAutoCompact(params: {
	status: TokenStatus;
	limit: number;
	scope: AutoCompactScope;
	reason?: AutoCompactReason;
}): boolean {
	const { status, limit, scope, reason = "automatic" } = params;
	if (reason === "downshift") {
		if (scope === "bodyAfterPrefix") return status.activeContextTokens >= status.contextWindow;
		return status.activeContextTokens > limit || status.activeContextTokens >= status.contextWindow;
	}
	const scoped = scope === "bodyAfterPrefix"
		? status.prefillTokens === undefined
			? 0
			: Math.max(0, status.activeContextTokens - status.prefillTokens)
		: status.activeContextTokens;
	return scoped >= limit || status.activeContextTokens >= status.contextWindow;
}
