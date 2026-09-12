import type { Theme } from "@earendil-works/pi-coding-agent";
export interface GoalFooterDisplay {
    version: 1;
    ownerSessionId: string;
    goalId: string;
    objective: string;
    status: string;
    summary: string;
}
export declare function readGoalDisplay(value: unknown, ownerSessionId: string): GoalFooterDisplay | undefined;
export declare function renderGoalDisplay(display: GoalFooterDisplay, width: number, theme: Theme): string[];
//# sourceMappingURL=goal-display.d.ts.map