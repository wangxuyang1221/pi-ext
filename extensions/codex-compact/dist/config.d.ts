export type CodexCompactionConfig = {
    /** Optional Codex-style auto-compaction limit. */
    autoCompactTokenLimit?: number;
    autoCompactScope: "total" | "bodyAfterPrefix";
};
export declare function parseConfig(input: unknown): Partial<CodexCompactionConfig>;
export declare function loadConfig(cwd: string, trusted: boolean): CodexCompactionConfig;
/** Codex caps configured auto-compaction limits at 90% of the context window. */
export declare function autoCompactTokenLimit(config: CodexCompactionConfig, contextWindow: number): number;
//# sourceMappingURL=config.d.ts.map