import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component } from "@earendil-works/pi-tui";
export declare const REASONING_WIDGET_KEY = "codex-ui-reasoning";
export declare class ReasoningStatus implements Component {
    private getTheme;
    private requestRender;
    private title;
    private width;
    private colors;
    private lines;
    private disposed;
    constructor(getTheme: () => Theme, requestRender: () => void);
    setTitle(title: string): void;
    invalidate(): void;
    render(width: number): string[];
    dispose(): void;
}
export declare function registerReasoningStatus(pi: ExtensionAPI): (ctx: ExtensionContext) => void;
//# sourceMappingURL=reasoning-status.d.ts.map