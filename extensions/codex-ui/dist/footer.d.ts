import type { ContextUsage, Theme } from "@earendil-works/pi-coding-agent";
import { type Component } from "@earendil-works/pi-tui";
export interface CodexFooterOptions {
    cwd: string;
    home?: string;
    getModelId: () => string | undefined;
    getThinkingLevel: () => string;
    getContextUsage: () => Pick<ContextUsage, "percent"> | undefined;
    getBranch: () => string | null;
    getExtensionStatuses: () => ReadonlyMap<string, string>;
    getTheme: () => Theme;
}
export declare class CodexFooter implements Component {
    private readonly options;
    private readonly statusCache;
    private unsubscribeBranch;
    private cachedSnapshot;
    constructor(options: CodexFooterOptions);
    setBranchSubscription(unsubscribe: () => void): void;
    render(width: number): string[];
    invalidate(): void;
    dispose(): void;
    private readStatus;
}
//# sourceMappingURL=footer.d.ts.map