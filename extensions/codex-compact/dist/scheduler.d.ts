export type AutoCompactScope = "total" | "bodyAfterPrefix";
export type TokenStatus = {
    activeContextTokens: number;
    contextWindow: number;
    prefillTokens?: number;
};
export type AutoCompactReason = "automatic" | "downshift";
export declare function shouldAutoCompact(params: {
    status: TokenStatus;
    limit: number;
    scope: AutoCompactScope;
    reason?: AutoCompactReason;
}): boolean;
//# sourceMappingURL=scheduler.d.ts.map