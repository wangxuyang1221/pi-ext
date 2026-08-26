import { createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition, type ExtensionAPI, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
export interface CodexToolFactories {
    read: typeof createReadToolDefinition;
    edit: typeof createEditToolDefinition;
    write: typeof createWriteToolDefinition;
    bash: typeof createBashToolDefinition;
}
export interface CodexToolRenderServices {
    getKeybindings?: () => Pick<KeybindingsManager, "getKeys"> | undefined;
}
export interface DisplayDiffLine {
    kind: "context" | "removed" | "added";
    lineNumber: number | undefined;
    text: string;
}
export declare function registerCodexTools(pi: ExtensionAPI, factories?: CodexToolFactories, services?: CodexToolRenderServices): void;
export declare function parseDisplayDiff(diff: string): DisplayDiffLine[];
export declare function renderDisplayDiff(lines: readonly DisplayDiffLine[], theme: Theme, width: number): string[];
//# sourceMappingURL=tools.d.ts.map