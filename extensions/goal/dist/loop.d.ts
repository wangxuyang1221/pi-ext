export declare const LOOP_WINDOW = 32;
export declare const LOOP_WARN_REPEATS = 4;
export declare const LOOP_PAUSE_REPEATS = 8;
export type LoopDecision = "none" | "warn" | "pause";
export interface LoopObservation {
    toolName: string;
    input: unknown;
    content: unknown;
    isError: boolean;
}
export declare const LOOP_MAX_BYTES: number;
/** Detect bounded, observable repetition, not semantic task completion. */
export declare class GoalLoopDetector {
    private recent;
    private calls;
    wouldRepeat(toolName: string, input: unknown): boolean;
    private repeats;
    get state(): {
        retained: number;
        repeats: number;
    };
    observe(observation: LoopObservation): LoopDecision;
    reset(): void;
}
//# sourceMappingURL=loop.d.ts.map