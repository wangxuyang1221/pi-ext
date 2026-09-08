/** Incrementally recognize standalone **titles** using source offsets, not retained text. */
export declare class SummaryScanner {
    private phase;
    private start;
    private end;
    private committedStart;
    private committedEnd;
    clone(): SummaryScanner;
    /** Append only a suffix whose prefix the caller has verified against the prior snapshot. */
    append(text: string, offset?: number): void;
    getTitle(text: string): string | undefined;
}
//# sourceMappingURL=reasoning-summary-scan.d.ts.map