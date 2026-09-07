import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
type Schedule = (callback: () => void, delay: number) => () => void;
/** Animate OSC title text only, with one timer and no missed-frame backlog. */
export declare class TerminalTitleSpinner {
    private readonly write;
    private baseTitle;
    private readonly now;
    private readonly schedule;
    private cancel;
    private active;
    private started;
    private lastTitle;
    constructor(write: (title: string) => void, baseTitle: string, now?: () => number, schedule?: Schedule);
    start(): void;
    setBaseTitle(title: string): void;
    stop(): void;
    private paint;
    private tick;
}
/** Install session-local terminal title feedback without rendering a TUI component. */
export declare function registerTerminalTitleSpinner(pi: ExtensionAPI): (ctx: ExtensionContext) => void;
export {};
//# sourceMappingURL=terminal-title.d.ts.map