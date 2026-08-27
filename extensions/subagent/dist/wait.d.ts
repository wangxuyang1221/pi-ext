import type { SessionState } from "./state-store.js";
export type WaitOutcome = "settled" | "interrupted" | "closed" | "timeout";
export interface WaitForSettledOptions {
    agentId: string;
    afterSettled: string;
    timeoutMs: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    readState: () => Promise<SessionState>;
    wasClosed?: () => Promise<boolean>;
    isAlive: (state: SessionState) => Promise<boolean>;
    now?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}
export interface WaitForSettledResult {
    outcome: WaitOutcome;
    generation: number;
    durationMs: number;
    settledCursor?: string;
}
export declare function waitForSettled(options: WaitForSettledOptions): Promise<WaitForSettledResult>;
//# sourceMappingURL=wait.d.ts.map