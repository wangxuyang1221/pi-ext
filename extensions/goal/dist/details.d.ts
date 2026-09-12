import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component } from "@earendil-works/pi-tui";
export type GoalDetailAction = "pause" | "resume";
/** Scrollable, immutable opening snapshot. No timer and no storage access. */
export declare class GoalDetails implements Component {
    private readonly body;
    private readonly actions;
    private readonly getTheme;
    private readonly height;
    private readonly done;
    private readonly refresh;
    private offset;
    private rows;
    private cached;
    constructor(body: string, actions: {
        pause: boolean;
        resume: boolean;
    }, getTheme: () => Theme, height: () => number, done: (action: GoalDetailAction | undefined) => void, refresh: () => void);
    render(width: number): string[];
    handleInput(data: string): void;
    invalidate(): void;
}
//# sourceMappingURL=details.d.ts.map