import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GoalRecord, Goal } from "./storage.js";
export declare const GOAL_CONTEXT = "pi-ext-goal-continuation";
export declare const GOAL_BUDGET_CONTEXT = "pi-ext-goal-budget";
export declare const GOAL_LOOP_CONTEXT = "pi-ext-goal-loop-warning";
export declare const GOAL_LOOP_PAUSED = "Goal paused after repeated tool calls returned unchanged results. Review the last actions, then use /goal resume to continue.";
interface Access {
    snapshot(): GoalRecord | undefined;
    missingTools?(): string[];
    checkpoint?(expected: GoalRecord, ctx: ExtensionContext): Promise<unknown>;
    stop(status: Goal["status"], expected: GoalRecord, ctx: ExtensionContext, reason?: "repeated_tool_calls"): Promise<void>;
}
/** Coordinate only this extension's continuation requests through public Pi events. */
export declare function registerGoalScheduler(pi: ExtensionAPI, access: Access): {
    start: (ctx: ExtensionContext, automatic?: boolean) => void;
    refresh: (ctx: ExtensionContext) => void;
    budget: (ctx: ExtensionContext) => void;
    suspend: (ctx?: ExtensionContext) => void;
    resume: (ctx: ExtensionContext, edited?: boolean) => void;
    invalidate: () => void;
    adopt: (ctx: ExtensionContext) => void;
    assertModelGoal: (ctx: ExtensionContext) => void;
};
export {};
//# sourceMappingURL=scheduler.d.ts.map