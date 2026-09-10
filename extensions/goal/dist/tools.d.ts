import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Goal, GoalRecord } from "./storage.js";
export interface GoalToolAccess {
    get(ctx: ExtensionContext): Promise<GoalRecord | undefined>;
    create(ctx: ExtensionContext, objective: string, budget?: number): Promise<GoalRecord>;
    update(ctx: ExtensionContext, status: "complete" | "blocked"): Promise<GoalRecord>;
}
/** Render the pinned upstream template; replacements never reinterpret objective data. */
export declare function renderGoalPrompt(goal: Goal, edited?: boolean, budget?: boolean): string;
/** Register the three upstream goal tools, with strict argument schemas. */
export declare function registerGoalTools(pi: ExtensionAPI, access: GoalToolAccess): void;
//# sourceMappingURL=tools.d.ts.map