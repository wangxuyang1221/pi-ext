import {
  VERSION,
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";

import { CodexEditor, CodexFooter, CodexHeader } from "./components.js";
import { registerCodexTools, type CodexToolFactories, type CodexToolRenderServices } from "./tools.js";
import { registerCodemodeUi } from "./codemode.js";
import { registerTerminalTitleSpinner } from "./terminal-title.js";
import { registerWorking } from "./working-session.js";
import { createContextUsageReader } from "./context-usage.js";
import { copyLastReply } from "./reply-copy.js";

export const CODEX_THEME_NAME = "codex-pi";

function applyProfileTheme(ctx: ExtensionContext, notifyUnavailable: boolean): boolean {
  if (ctx.ui.theme.name === CODEX_THEME_NAME) return true;
  const profileTheme = ctx.ui.getTheme(CODEX_THEME_NAME);
  if (!profileTheme) {
    if (notifyUnavailable) {
      ctx.ui.notify(`Codex profile theme unavailable: ${CODEX_THEME_NAME}`, "warning");
    }
    return false;
  }
  const themeResult = ctx.ui.setTheme(profileTheme);
  if (!themeResult.success) {
    if (notifyUnavailable) {
      ctx.ui.notify(`Codex profile theme unavailable: ${themeResult.error ?? "unknown error"}`, "warning");
    }
    return false;
  }
  return true;
}

function hideInlineWorkingRow(ui: ExtensionUIContext): void {
  ui.setWorkingVisible(false);
}

/** SDK callers must explicitly supply non-file execution settings or custom factories. */
export interface CodexUiOptions {
  toolFactories?: CodexToolFactories;
  getExecutionOptions?: CodexToolRenderServices["getExecutionOptions"];
}

export default function codexUiExtension(pi: ExtensionAPI, options: CodexUiOptions = {}): void {
  let currentKeybindings: KeybindingsManager | undefined;
  const installTitleSpinner = registerTerminalTitleSpinner(pi);
  const installWorking = registerWorking(pi);

  const contextSnapshots = new WeakMap<object, { manager: unknown; messages: Array<{ role: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean }> }>();
  const readContextMessages = (event: unknown, ctx: ExtensionContext) => {
    const manager = ctx.sessionManager;
    if (event && typeof event === "object") {
      const cached = contextSnapshots.get(event);
      if (cached && cached.manager === manager) return cached.messages;
    }
    const messages: Array<{ role: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean }> = [];
    for (const entry of manager.buildContextEntries()) {
      for (const message of sessionEntryToContextMessages(entry)) {
        messages.push(message as unknown as { role: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean });
      }
    }
    if (event && typeof event === "object") {
      contextSnapshots.set(event, { manager, messages });
    }
    return messages;
  };

  const nativeRenderers = registerCodexTools(pi, options.toolFactories, {
    getExecutionOptions: options.getExecutionOptions,
    getKeybindings: () => currentKeybindings,
    readContextMessages,
  });

  registerCodemodeUi(pi, {
    nativeRenderers,
    getKeybindings: () => currentKeybindings,
    readContextMessages,
  });

  let currentModelId: string | undefined;
  pi.on("model_select", (event) => {
    currentModelId = event.model.id;
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType === "assistant-thinking") {
      // Prepend a standalone Thinking blockquote header so body blocks keep native top-level caching.
      return markdown.trim() ? `> **Thinking**\n\n${markdown}` : markdown;
    }
    return markdown;
  });

  // Pi 1.6.0 calls setRegisteredThemes() and then themeController.applyFromSettings()
  // after session_start and all resources_discover handlers on resume/new/fork/reload,
  // resetting in-memory extension themes back to settings. Detecting the host theme
  // registry refresh distinguishes host applyFromSettings() from earlier sibling theme
  // overrides and unrelated invalidations without fixed timeouts or editor coupling.
  let pendingThemeRestore: {
    ctx: ExtensionContext;
    sessionToken: number;
    registeredBefore: Theme;
    disarmHandle?: ReturnType<typeof setImmediate>;
  } | undefined;
  let sessionToken = 0;

  const clearPendingThemeRestore = (): void => {
    if (pendingThemeRestore?.disarmHandle !== undefined) {
      clearImmediate(pendingThemeRestore.disarmHandle);
    }
    pendingThemeRestore = undefined;
  };

  const hasHostRefreshedThemes = (pending: NonNullable<typeof pendingThemeRestore>): boolean => (
    pending.ctx.ui.getTheme(CODEX_THEME_NAME) !== pending.registeredBefore
  );

  const schedulePostRebindDisarm = (targetToken: number): void => {
    const pending = pendingThemeRestore;
    if (
      !pending
      || pending.sessionToken !== targetToken
      || sessionToken !== targetToken
      || pending.disarmHandle !== undefined
      || !hasHostRefreshedThemes(pending)
    ) {
      return;
    }
    if (pending.ctx.ui.theme.name !== CODEX_THEME_NAME) {
      clearPendingThemeRestore();
      return;
    }
    pending.disarmHandle = setImmediate(() => {
      if (pendingThemeRestore?.sessionToken === targetToken) {
        clearPendingThemeRestore();
      }
    });
    pending.disarmHandle.unref?.();
  };

  pi.on("session_shutdown", () => {
    sessionToken++;
    clearPendingThemeRestore();
  });

  pi.on("session_start", (event, ctx) => {
    clearPendingThemeRestore();
    sessionToken++;
    if (ctx.mode !== "tui") return;

    const currentSessionToken = sessionToken;
    currentModelId = ctx.model?.id;
    const themeApplied = applyProfileTheme(ctx, true);
    if (event.reason !== "startup" && themeApplied) {
      const registeredBefore = ctx.ui.getTheme(CODEX_THEME_NAME);
      if (registeredBefore && ctx.ui.getTheme(CODEX_THEME_NAME) === registeredBefore) {
        pendingThemeRestore = {
          ctx,
          sessionToken: currentSessionToken,
          registeredBefore,
        };
        ctx.ui.addAutocompleteProvider?.((provider) => {
          schedulePostRebindDisarm(currentSessionToken);
          return provider;
        });
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
      return new CodexEditor(tui, editorTheme, keybindings, getTheme, () => { void copyLastReply(ctx); });
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
        getRate: () => working?.activity.label(),
        getTheme,
      });
      footer.setBranchSubscription(footerData.onBranchChange(() => {
        footer.invalidate();
        tui.requestRender();
      }));
      const trackedFooter = {
        render: (width: number) => footer.render(width),
        invalidate: () => {
          footer.invalidate();
          const pending = pendingThemeRestore;
          if (
            !pending
            || pending.sessionToken !== currentSessionToken
            || sessionToken !== currentSessionToken
          ) {
            return;
          }
          const refreshed = hasHostRefreshedThemes(pending);
          if (!refreshed) {
            if (pending.ctx.ui.theme.name !== CODEX_THEME_NAME) {
              clearPendingThemeRestore();
            }
            return;
          }
          const targetCtx = pending.ctx;
          clearPendingThemeRestore();
          if (targetCtx.ui.theme.name === CODEX_THEME_NAME) return;
          queueMicrotask(() => {
            if (sessionToken !== currentSessionToken) return;
            applyProfileTheme(targetCtx, false);
          });
        },
        dispose: () => {
          if (sessionToken === currentSessionToken) {
            sessionToken++;
            clearPendingThemeRestore();
          }
          footer.dispose();
        },
      };
      return working ? working.bind(trackedFooter, tui) : trackedFooter;
    });

    installTitleSpinner(ctx);
    hideInlineWorkingRow(ctx.ui);
  });
}
