import {
  VERSION,
  type ExtensionAPI,
  type ExtensionUIContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";

import { CodexEditor, CodexFooter, CodexHeader } from "./components.js";
import { registerCodexTools, type CodexToolFactories, type CodexToolRenderServices } from "./tools.js";
import { ReasoningSummary } from "./reasoning-summary.js";
import { registerTerminalTitleSpinner } from "./terminal-title.js";
import { readGoalDisplay, type GoalFooterDisplay } from "./goal-display.js";

export const CODEX_THEME_NAME = "codex-pi";

const LOW_POWER_ARGUMENTS = ["on", "off", "status"] as const;
function hideInlineWorkingRow(ui: ExtensionUIContext): void {
  ui.setWorkingVisible(false);
}

/** SDK callers must explicitly supply non-file execution settings or custom factories. */
export interface CodexUiOptions {
  toolFactories?: CodexToolFactories;
  getExecutionOptions?: CodexToolRenderServices["getExecutionOptions"];
}

export default function codexUiExtension(pi: ExtensionAPI, options: CodexUiOptions = {}): void {
  let lowPowerEnabled = false;
  let goalDisplay: GoalFooterDisplay | undefined;
  let unsubscribeGoal: (() => void) | undefined;
  let currentKeybindings: KeybindingsManager | undefined;
  const reasoningSummary = new ReasoningSummary();
  const installTitleSpinner = registerTerminalTitleSpinner(pi);

  registerCodexTools(pi, options.toolFactories, {
    getExecutionOptions: options.getExecutionOptions,
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
      } else if (action === "off") {
        lowPowerEnabled = false;
      } else {
        lowPowerEnabled = !lowPowerEnabled;
      }
      hideInlineWorkingRow(ctx.ui);
      ctx.ui.setStatus("codex-ui-lowpower", lowPowerEnabled ? "Low power" : undefined);
      ctx.ui.notify(`Low power: ${lowPowerEnabled ? "on" : "off"}`, "info");
    },
  });

  let currentModelId: string | undefined;
  pi.on("model_select", (event) => {
    currentModelId = event.model.id;
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType === "assistant-thinking") {
      return reasoningSummary.render(markdown, context.availableWidth);
    }
    if (context.messageType === "assistant") {
      // Display-only outer list: let native Markdown align wrapped lines and blocks.
      return markdown.trim() ? `- ${markdown.replace(/\r?\n/gu, "\n  ")}` : markdown;
    }
    return markdown;
  });

  pi.on("session_tree", () => reasoningSummary.clear());
  pi.on("session_shutdown", () => {
    reasoningSummary.clear();
    unsubscribeGoal?.(); unsubscribeGoal = undefined;
    goalDisplay = undefined;
  });
  pi.on("session_start", (_event, ctx) => {
    reasoningSummary.clear();
    if (ctx.mode !== "tui") return;
    goalDisplay = undefined;
    unsubscribeGoal?.();
    unsubscribeGoal = pi.events?.on("pi-ext:goal-display:v1", data => {
      if (data === undefined) goalDisplay = undefined;
      else {
        const next = readGoalDisplay(data, ctx.sessionManager.getSessionId());
        if (next) goalDisplay = next;
      }
    });
    pi.events?.emit("pi-ext:goal-display:request", undefined);

    ctx.ui.setStatus("codex-ui-lowpower", lowPowerEnabled ? "Low power" : undefined);
    currentModelId = ctx.model?.id;
    if (ctx.ui.theme.name !== CODEX_THEME_NAME) {
      const profileTheme = ctx.ui.getTheme(CODEX_THEME_NAME);
      if (!profileTheme) {
        ctx.ui.notify(`Codex profile theme unavailable: ${CODEX_THEME_NAME}`, "warning");
      } else {
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
        getGoalDisplay: () => goalDisplay,
        getTheme,
      });
      footer.setBranchSubscription(footerData.onBranchChange(() => {
        footer.invalidate();
        tui.requestRender();
      }));
      return footer;
    });

    installTitleSpinner(ctx);
    hideInlineWorkingRow(ctx.ui);
  });
}
