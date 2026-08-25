import { basename } from "node:path";
import { VERSION, } from "@earendil-works/pi-coding-agent";
import { CodexEditor, CodexFooter, CodexHeader } from "./components.js";
import { registerCodexTools } from "./tools.js";
export const CODEX_THEME_NAME = "codex-pi";
export default function codexUiExtension(pi) {
    registerCodexTools(pi);
    let currentModelId;
    pi.on("model_select", (event) => {
        currentModelId = event.model.id;
    });
    pi.registerMarkdownTransformer((markdown, context) => {
        if (context.messageType !== "user" || markdown.length === 0 || markdown.startsWith("› ")) {
            return markdown;
        }
        return `› ${markdown}`;
    });
    pi.on("session_start", (_event, ctx) => {
        if (ctx.mode !== "tui")
            return;
        currentModelId = ctx.model?.id;
        const profileTheme = ctx.ui.getTheme(CODEX_THEME_NAME);
        if (!profileTheme) {
            ctx.ui.notify(`Codex profile theme unavailable: ${CODEX_THEME_NAME}`, "warning");
        }
        else {
            const themeResult = ctx.ui.setTheme(profileTheme);
            if (!themeResult.success) {
                ctx.ui.notify(`Codex profile theme unavailable: ${themeResult.error ?? "unknown error"}`, "warning");
            }
        }
        const getTheme = () => ctx.ui.theme;
        const getModelId = () => currentModelId;
        const getThinkingLevel = () => pi.getThinkingLevel();
        ctx.ui.setHeader(() => new CodexHeader({
            version: VERSION,
            cwd: ctx.cwd,
            home: process.env.HOME,
            getModelId,
            getThinkingLevel,
            getTheme,
        }));
        ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => (new CodexEditor(tui, editorTheme, keybindings, getTheme)));
        ctx.ui.setFooter((_tui, _theme, footerData) => new CodexFooter({
            cwd: ctx.cwd,
            home: process.env.HOME,
            getModelId,
            getThinkingLevel,
            getContextUsage: () => ctx.getContextUsage(),
            getExtensionStatuses: () => footerData.getExtensionStatuses(),
            getTheme,
        }));
        ctx.ui.setTitle(`π · ${basename(ctx.cwd) || "session"}`);
        ctx.ui.setWorkingIndicator({
            frames: [
                ctx.ui.theme.fg("dim", "·"),
                ctx.ui.theme.fg("muted", "•"),
                ctx.ui.theme.fg("accent", "●"),
                ctx.ui.theme.fg("muted", "•"),
            ],
            intervalMs: 120,
        });
    });
}
//# sourceMappingURL=index.js.map