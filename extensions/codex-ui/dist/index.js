import { basename } from "node:path";
import { VERSION, } from "@earendil-works/pi-coding-agent";
import { CodexEditor, CodexFooter, CodexHeader } from "./components.js";
import { registerCodexTools } from "./tools.js";
import { reasoningHistoryMarkdown } from "./reasoning-history.js";
import { registerReasoningStatus } from "./reasoning-status.js";
export const CODEX_THEME_NAME = "codex-pi";
const LOW_POWER_ARGUMENTS = ["on", "off", "status"];
function getBaseTitle(cwd) {
    return `π · ${basename(cwd) || "session"}`;
}
function hideInlineWorkingRow(ui) {
    ui.setWorkingVisible(false);
}
export default function codexUiExtension(pi) {
    let lowPowerEnabled = false;
    let currentKeybindings;
    const installReasoningStatus = registerReasoningStatus(pi);
    registerCodexTools(pi, undefined, {
        getKeybindings: () => currentKeybindings,
        isLowPowerEnabled: () => lowPowerEnabled,
    });
    pi.registerCommand("lowpower", {
        description: "Toggle low-power rendering for write, edit, and bash",
        getArgumentCompletions(prefix) {
            const normalizedPrefix = prefix.trim().toLowerCase();
            const matches = LOW_POWER_ARGUMENTS
                .filter((argument) => argument.startsWith(normalizedPrefix))
                .map((argument) => ({ value: argument, label: argument }));
            return matches.length > 0 ? matches : null;
        },
        async handler(args, ctx) {
            const action = args.trim().toLowerCase();
            if (action && action !== "on" && action !== "off" && action !== "status") {
                ctx.ui.notify("Usage: /lowpower [on|off|status]", "error");
                return;
            }
            if (action === "status") {
                ctx.ui.notify(`Low power: ${lowPowerEnabled ? "on" : "off"}`, "info");
                return;
            }
            if (action === "on") {
                lowPowerEnabled = true;
            }
            else if (action === "off") {
                lowPowerEnabled = false;
            }
            else {
                lowPowerEnabled = !lowPowerEnabled;
            }
            hideInlineWorkingRow(ctx.ui);
            ctx.ui.setStatus("codex-ui-lowpower", lowPowerEnabled ? "Low power" : undefined);
            ctx.ui.notify(`Low power: ${lowPowerEnabled ? "on" : "off"}`, "info");
        },
    });
    let currentModelId;
    pi.on("model_select", (event) => {
        currentModelId = event.model.id;
    });
    pi.registerMarkdownTransformer((markdown, context) => {
        if (context.messageType === "assistant-thinking") {
            return context.isStreaming ? "" : reasoningHistoryMarkdown(markdown);
        }
        if (context.messageType !== "user" || markdown.length === 0 || markdown.startsWith("› ")) {
            return markdown;
        }
        return `› ${markdown}`;
    });
    pi.on("session_start", (_event, ctx) => {
        if (ctx.mode !== "tui")
            return;
        ctx.ui.setStatus("codex-ui-lowpower", lowPowerEnabled ? "Low power" : undefined);
        currentModelId = ctx.model?.id;
        if (ctx.ui.theme.name !== CODEX_THEME_NAME) {
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
        ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
            currentKeybindings = keybindings;
            return new CodexEditor(tui, editorTheme, keybindings, getTheme);
        });
        ctx.ui.setFooter((tui, _theme, footerData) => {
            const footer = new CodexFooter({
                cwd: ctx.cwd,
                home: process.env.HOME,
                getModelId,
                getThinkingLevel,
                getContextUsage: () => ctx.getContextUsage(),
                getBranch: () => footerData.getGitBranch(),
                getExtensionStatuses: () => footerData.getExtensionStatuses(),
                getTheme,
            });
            footer.setBranchSubscription(footerData.onBranchChange(() => {
                footer.invalidate();
                tui.requestRender();
            }));
            return footer;
        });
        ctx.ui.setTitle(getBaseTitle(ctx.cwd));
        hideInlineWorkingRow(ctx.ui);
        installReasoningStatus(ctx);
    });
}
//# sourceMappingURL=index.js.map