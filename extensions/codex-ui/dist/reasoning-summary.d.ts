/** Display-only, bounded content memoization; message lifecycle never changes the output. */
export declare class ReasoningSummary {
    private readonly maxEntries;
    private readonly maxChars;
    private readonly entries;
    private retainedChars;
    private previous;
    constructor(maxEntries?: number, maxChars?: number);
    clear(): void;
    render(markdown: string, width: number): string;
    private format;
}
//# sourceMappingURL=reasoning-summary.d.ts.map