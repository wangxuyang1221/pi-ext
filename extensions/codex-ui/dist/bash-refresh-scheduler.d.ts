export declare class BashRefreshScheduler {
    private readonly refreshMs;
    private readonly invalidators;
    private timer;
    constructor(refreshMs: number);
    track(toolCallId: string, invalidate: () => void): void;
    untrack(toolCallId: string): void;
    dispose(): void;
    private stopTimer;
}
//# sourceMappingURL=bash-refresh-scheduler.d.ts.map