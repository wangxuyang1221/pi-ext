import type { Goal, GoalDisplayTiming, GoalRecord } from "./storage.js";
export declare const GOAL_DISPLAY_EVENT = "pi-ext:goal-display:v1";
export declare const GOAL_DISPLAY_REQUEST = "pi-ext:goal-display:request";
/** Bounded, plain-text event payload; never a persisted goal or an accounting API. */
export interface GoalDisplay {
    version: 1;
    ownerSessionId: string;
    goalId: string;
    objective: string;
    status: Goal["status"];
    summary: string;
}
export declare function displayText(text: string): string;
export declare function formatGoalMinutes(seconds: number): string;
export declare function formatGoalSeconds(seconds: number): string;
export declare function goalStatusLabel(status: Goal["status"]): string;
interface Access {
    readTiming(): GoalDisplayTiming | undefined;
    expand(goal: Goal): Promise<string>;
    publish(display: GoalDisplay | undefined): void;
}
/** Event-driven metadata refresh plus a single elapsed-minute timeout. No I/O on ticks. */
export declare class GoalPresentation {
    private readonly access;
    private record;
    private limitation;
    private suspended;
    private timer;
    private key;
    private display;
    private contentKey;
    private contentEpoch;
    private objective;
    private contentError;
    constructor(access: Access);
    update(record: GoalRecord | undefined, limitation?: string, suspended?: boolean): void;
    get current(): GoalDisplay | undefined;
    private preview;
    private refresh;
    dispose(): void;
}
export {};
//# sourceMappingURL=presentation.d.ts.map