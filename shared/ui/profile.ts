import {
  VERSION,
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { registerCodemodeUi } from "./codemode.js";
import { bindingText } from "./keybinding-hints.js";
import { registerTerminalTitleSpinner } from "./terminal-title.js";
import { registerWorking } from "./working-session.js";
import { createContextUsageReader } from "./context-usage.js";
import { copyLastReply } from "./reply-copy.js";
import type { Component } from "@earendil-works/pi-tui";
import type { ProfileEditor } from "./profile-editor.js";
import type { HeaderOptions, FooterOptions } from "./ui-options.js";
import { registerTools, type ToolFactories, type ToolLayout, type ToolRenderServices } from "./native-tools.js";
import type { WorkingView } from "./working-session.js";

type Footer = Component & { setBranchSubscription(unsubscribe: () => void): void; dispose(): void };
interface Profile {
  themeName: string;
  Header: new (options: HeaderOptions) => Component;
  Editor: new (...args: ConstructorParameters<typeof ProfileEditor>) => ProfileEditor;
  Footer: new (options: FooterOptions) => Footer;
  working: WorkingView;
  tools: ToolLayout;
  transformMarkdown: Parameters<ExtensionAPI["registerMarkdownTransformer"]>[0];
  hiddenThinkingLabel?: (toggleKey: string) => string;
  registerToolRenderers?(pi: ExtensionAPI, getKeys: () => KeybindingsManager | undefined): void;
}

function applyProfileTheme(
  ctx: ExtensionContext,
  notifyUnavailable: boolean,
  targetName: string,
): boolean {
  if (ctx.ui.theme.name === targetName) return true;
  const profileTheme = ctx.ui.getTheme(targetName);
  if (!profileTheme) {
    if (notifyUnavailable) {
      ctx.ui.notify(`Profile theme unavailable: ${targetName}`, "warning");
    }
    return false;
  }
  const themeResult = ctx.ui.setTheme(profileTheme);
  if (!themeResult.success) {
    if (notifyUnavailable) {
      ctx.ui.notify(`Profile theme unavailable: ${themeResult.error ?? "unknown error"}`, "warning");
    }
    return false;
  }
  return true;
}

/** SDK callers must explicitly supply non-file execution settings or custom factories. */
export interface UiOptions {
  toolFactories?: ToolFactories;
  getExecutionOptions?: ToolRenderServices["getExecutionOptions"];
}

export function registerProfile(pi: ExtensionAPI, profile: Profile, options: UiOptions): void {
  let currentKeybindings: KeybindingsManager | undefined;
  const installTitleSpinner = registerTerminalTitleSpinner(pi);
  const installWorking = registerWorking(pi, profile.working);

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

  const nativeRenderers = registerTools(profile.tools, pi, options.toolFactories, {
    getExecutionOptions: options.getExecutionOptions,
    getKeybindings: () => currentKeybindings,
    readContextMessages,
  });

  registerCodemodeUi(pi, {
    nativeRenderers,
    layout: profile.tools,
    getKeybindings: () => currentKeybindings,
    readContextMessages,
  });

  let currentModelId: string | undefined;
  let activeHeader: Component | undefined;
  let activeEditor: ProfileEditor | undefined;
  let activeFooter: Footer | undefined;
  let activeTui: { requestRender(): void } | undefined;
  let currentBranch: string | null = null;

  profile.registerToolRenderers?.(pi, () => currentKeybindings);
  pi.registerMarkdownTransformer(profile.transformMarkdown);

  pi.on("model_select", (event) => {
    currentModelId = event.model.id;
    activeHeader?.invalidate();
    activeFooter?.invalidate();
    activeTui?.requestRender();
  });

  pi.on("thinking_level_select", () => {
    activeHeader?.invalidate();
    activeFooter?.invalidate();
    activeTui?.requestRender();
  });

  // Pi calls setRegisteredThemes() and then themeController.applyFromSettings()
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
  let keybindingSessionToken = 0;

  const clearPendingThemeRestore = (): void => {
    if (pendingThemeRestore?.disarmHandle !== undefined) {
      clearImmediate(pendingThemeRestore.disarmHandle);
    }
    pendingThemeRestore = undefined;
  };

  const hasHostRefreshedThemes = (pending: NonNullable<typeof pendingThemeRestore>): boolean => (
    pending.ctx.ui.getTheme(profile.themeName) !== pending.registeredBefore
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
    if (pending.ctx.ui.theme.name !== profile.themeName) {
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
    keybindingSessionToken++;
    currentKeybindings = undefined;
    clearPendingThemeRestore();
    activeHeader = undefined;
    activeEditor = undefined;
    activeFooter = undefined;
    activeTui = undefined;
  });

  pi.on("session_start", (event, ctx) => {
    clearPendingThemeRestore();
    sessionToken++;
    keybindingSessionToken++;
    currentKeybindings = undefined;
    if (ctx.mode !== "tui") return;

    const currentSessionToken = sessionToken;
    const currentKeybindingToken = keybindingSessionToken;
    let sessionKeybindings: KeybindingsManager | undefined;
    let lastHiddenThinkingLabel: string | undefined;
    const syncHiddenThinkingLabel = (force = false): void => {
      if (keybindingSessionToken !== currentKeybindingToken) return;
      if (!profile.hiddenThinkingLabel) {
        if (force) ctx.ui.setHiddenThinkingLabel?.(undefined);
        return;
      }
      const next = profile.hiddenThinkingLabel(bindingText(sessionKeybindings, "app.thinking.toggle"));
      if (!force && next === lastHiddenThinkingLabel) return;
      lastHiddenThinkingLabel = next;
      ctx.ui.setHiddenThinkingLabel?.(next);
    };

    currentModelId = ctx.model?.id;
    const themeApplied = applyProfileTheme(ctx, true, profile.themeName);
    syncHiddenThinkingLabel(true);

    if (event.reason !== "startup" && themeApplied) {
      const registeredBefore = ctx.ui.getTheme(profile.themeName);
      if (registeredBefore && ctx.ui.getTheme(profile.themeName) === registeredBefore) {
        pendingThemeRestore = {
          ctx,
          sessionToken: currentSessionToken,
          registeredBefore,
        };
      }
    }

    // Pi reloads keybindings in place after session_start and before setupAutocompleteProvider().
    // Keep label synchronization independent of theme restoration state.
    if (event.reason !== "startup") {
      ctx.ui.addAutocompleteProvider?.((provider) => {
        schedulePostRebindDisarm(currentSessionToken);
        syncHiddenThinkingLabel();
        return provider;
      });
    }

    const getTheme = () => ctx.ui.theme;
    const getModelId = () => currentModelId;
    const getThinkingLevel = () => pi.getThinkingLevel();
    const getSessionKeybindings = () => (keybindingSessionToken === currentKeybindingToken ? sessionKeybindings : undefined);

    ctx.ui.setHeader(() => {
      activeHeader = new profile.Header({
        version: VERSION,
        cwd: ctx.cwd,
        home: process.env.HOME,
        getModelId,
        getThinkingLevel,
        getBranch: () => currentBranch,
        getKeybindings: getSessionKeybindings,
        getTheme,
      });
      return activeHeader;
    });

    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      activeTui = tui;
      if (keybindingSessionToken === currentKeybindingToken) {
        sessionKeybindings = keybindings;
        currentKeybindings = keybindings;
        syncHiddenThinkingLabel();
      }
      activeHeader?.invalidate();
      activeFooter?.invalidate();
      activeEditor = new profile.Editor(
        tui,
        editorTheme,
        keybindings,
        getTheme,
        () => { void copyLastReply(ctx); },
        () => {
          activeFooter?.invalidate();
          tui.requestRender();
        },
      );
      return activeEditor;
    });

    const working = installWorking(ctx, () => bindingText(getSessionKeybindings(), "app.interrupt", { shortEscape: true }));
    ctx.ui.setFooter((tui, _theme, footerData) => {
      activeTui = tui;
      currentBranch = footerData.getGitBranch();
      activeHeader?.invalidate();
      const footer = new profile.Footer({
        cwd: ctx.cwd,
        home: process.env.HOME,
        getModelId,
        getThinkingLevel,
        getContextUsage: createContextUsageReader(ctx),
        getBranch: () => footerData.getGitBranch(),
        getExtensionStatuses: () => footerData.getExtensionStatuses(),
        getRate: () => working?.activity.label(),
        isBashMode: () => activeEditor?.isBashDraft() ?? false,
        getKeybindings: getSessionKeybindings,
        getTheme,
      });
      activeFooter = footer;
      footer.setBranchSubscription(footerData.onBranchChange(() => {
        currentBranch = footerData.getGitBranch();
        activeHeader?.invalidate();
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
            if (pending.ctx.ui.theme.name !== profile.themeName) {
              clearPendingThemeRestore();
            }
            return;
          }
          const targetCtx = pending.ctx;
          clearPendingThemeRestore();
          if (targetCtx.ui.theme.name === profile.themeName) return;
          queueMicrotask(() => {
            if (sessionToken !== currentSessionToken) return;
            applyProfileTheme(targetCtx, false, profile.themeName);
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
    ctx.ui.setWorkingVisible(false);
  });
}
