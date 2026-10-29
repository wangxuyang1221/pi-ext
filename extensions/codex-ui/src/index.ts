import {
  VERSION,
  type ExtensionAPI,
  type ExtensionUIContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";

import { CodexEditor, CodexFooter, CodexHeader } from "./components.js";
import { registerCodexTools, type CodexToolFactories, type CodexToolRenderServices } from "./tools.js";
import { registerCodemodeUi } from "./codemode.js";
import { registerTerminalTitleSpinner } from "./terminal-title.js";
import { registerWorking } from "./working-session.js";
import { createContextUsageReader } from "./context-usage.js";
import { readGoalDisplay, type GoalFooterDisplay } from "./goal-display.js";

export const CODEX_THEME_NAME = "codex-pi";

function hideInlineWorkingRow(ui: ExtensionUIContext): void {
  ui.setWorkingVisible(false);
}

/** SDK callers must explicitly supply non-file execution settings or custom factories. */
export interface CodexUiOptions {
  toolFactories?: CodexToolFactories;
  getExecutionOptions?: CodexToolRenderServices["getExecutionOptions"];
}

export default function codexUiExtension(pi: ExtensionAPI, options: CodexUiOptions = {}): void {
  let goalDisplay: GoalFooterDisplay | undefined;
  let unsubscribeGoal: (() => void) | undefined;
  let currentKeybindings: KeybindingsManager | undefined;
  const installTitleSpinner = registerTerminalTitleSpinner(pi);
  const installWorking = registerWorking(pi);

  const nativeRenderers = registerCodexTools(pi, options.toolFactories, {
    getExecutionOptions: options.getExecutionOptions,
    getKeybindings: () => currentKeybindings,
  });

  registerCodemodeUi(pi, {
    nativeRenderers,
    getKeybindings: () => currentKeybindings,
  });

  let currentModelId: string | undefined;
  pi.on("model_select", (event) => {
    currentModelId = event.model.id;
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType === "assistant-thinking") {
      // Keep the entire thinking run in one native blockquote, including blank lines.
      return markdown.trim()
        ? "> **Thinking**\n>\n" + markdown.split(/\r?\n/u).map(line => line ? `> ${line}` : ">").join("\n")
        : markdown;
    }
    if (context.messageType === "assistant") {
      // Display-only outer list: let native Markdown align wrapped lines and blocks.
      return markdown.trim() ? `- ${markdown.replace(/\r?\n/gu, "\n  ")}` : markdown;
    }
    return markdown;
  });

  pi.on("session_shutdown", () => {
    unsubscribeGoal?.(); unsubscribeGoal = undefined;
    goalDisplay = undefined;
  });
  pi.on("session_start", (_event, ctx) => {
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

    const working = installWorking(ctx);
    ctx.ui.setFooter((tui, _theme, footerData) => {
      const footer = new CodexFooter({
        cwd: ctx.cwd,
        home: process.env.HOME,
        getModelId,
        getThinkingLevel,
        getContextUsage: createContextUsageReader(ctx),
        getBranch: () => footerData.getGitBranch(),
        getExtensionStatuses: () => footerData.getExtensionStatuses(),
        getGoalDisplay: () => goalDisplay,
        getRate: () => working?.activity.label(),
        getTheme,
      });
      footer.setBranchSubscription(footerData.onBranchChange(() => {
        footer.invalidate();
        tui.requestRender();
      }));
      return working ? working.bind(footer, tui) : footer;
    });

    installTitleSpinner(ctx);
    hideInlineWorkingRow(ctx.ui);
  });
}
