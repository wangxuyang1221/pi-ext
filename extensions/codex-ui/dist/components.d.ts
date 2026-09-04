import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
export { CodexFooter, type CodexFooterOptions } from "./footer.js";
export interface CodexHeaderOptions {
    version: string;
    cwd: string;
    home?: string;
    getModelId: () => string | undefined;
    getThinkingLevel: () => string;
    getTheme: () => Theme;
}
export declare class CodexHeader implements Component {
    private readonly options;
    constructor(options: CodexHeaderOptions);
    render(width: number): string[];
    invalidate(): void;
}
export declare class CodexEditor extends CustomEditor {
    private readonly getTheme;
    constructor(tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager, getTheme: () => Theme);
    render(width: number): string[];
}
//# sourceMappingURL=components.d.ts.map