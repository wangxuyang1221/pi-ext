export type CodexCompactionConfig = {
    /** Optional Codex-style auto-compaction limit. */
    autoCompactTokenLimit?: number;
    autoCompactScope: "total" | "bodyAfterPrefix";
    /** Pi does not expose Codex's effective-window metadata. Defaults to 95. */
    effectiveContextWindowPercent?: number;
};
export declare function parseConfig(input: unknown): Partial<CodexCompactionConfig>;
export declare function loadConfig(cwd: string, trusted: boolean): CodexCompactionConfig;
/** Reserve Codex's default headroom without changing the raw-window auto threshold. */
export declare function effectiveContextWindow(config: CodexCompactionConfig, contextWindow: number): number;
/** Codex caps configured auto-compaction limits at 90% of the context window. */
export declare function autoCompactTokenLimit(config: CodexCompactionConfig, contextWindow: number): number;
//# sourceMappingURL=config.d.ts.map