/** Track the first closed **title** using offsets, without retaining cumulative reasoning. */
export declare class ReasoningTitle {
    private length;
    private opening;
    private stars;
    private finished;
    private title;
    reset(): void;
    read(text: string, delta?: string): string | undefined;
}
//# sourceMappingURL=reasoning-title.d.ts.map