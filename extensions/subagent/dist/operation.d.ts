export declare const currentOperation: () => Operation | undefined;
export declare function withOperation<T>(timeoutMs: number, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T>;
export declare class DeadlineExceeded extends Error {
    constructor();
}
/** Owns one deadline and propagates cancellation to every underlying operation. */
export declare class Operation {
    readonly timeoutMs: number;
    private readonly parent?;
    readonly signal: AbortSignal;
    assertAuthorized?: () => Promise<void>;
    interruptionError?: (reason: unknown) => Error;
    private readonly resources;
    private readonly cleanupErrors;
    reportCleanupError(error: unknown): void;
    trackResource<T>(promise: Promise<T>): Promise<T>;
    drainResources(): Promise<void>;
    private readonly controller;
    private readonly timer;
    private readonly startedAt;
    private readonly abort;
    constructor(timeoutMs: number, parent?: AbortSignal | undefined);
    get remainingMs(): number;
    run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
    dispose(): void;
}
//# sourceMappingURL=operation.d.ts.map