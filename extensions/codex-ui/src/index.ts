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

const LIST_ITEM_PREFIX = /^([ \t]*)(?:([-+*])|\d{1,9}([.)]))([ \t]+|$)/u;
const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/u;
const THEMATIC_BREAK = /^([ \t]*)([-*_])(?:[ \t]*\2){2,}[ \t]*$/u;
const BLOCK_INTERRUPT = /^[ \t]*(?:#{1,6}(?:[ \t]|$)|>)/u;

interface ListLevel {
  markerIndent: number;
  contentIndent: number;
  delimiter: string;
  emptyItem: boolean;
}

function indentWidth(prefix: string): number {
  let width = 0;
  for (let i = 0; i < prefix.length; i++) {
    // Pi's Markdown component expands tabs to 3 spaces before lexing.
    width += prefix[i] === "\t" ? 3 : 1;
  }
  return width;
}

function leadingIndent(line: string): number {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 3;
    else break;
  }
  return width;
}

/**
 * Quote each thinking block separately so every rendered line keeps a left rail
 * while preserving Pi's per-top-level-block streaming and highlight caches.
 */
function formatThinkingBlocks(markdown: string): string {
  if (!markdown.trim()) return markdown;
  const lines = markdown.split(/\r?\n/u);
  const output = ["> **Thinking**", ""];
  const listStack: ListLevel[] = [];
  let fenceChar = "";
  let fenceLength = 0;
  let fenceMinIndent = 0;
  let fenceMaxIndent = 0;
  let pendingBlanks = 0;
  let started = false;

  const clearFence = (): void => {
    fenceChar = "";
    fenceLength = 0;
    fenceMinIndent = 0;
    fenceMaxIndent = 0;
  };

  const tryOpenFence = (segment: string, minIndent: number, maxIndent: number): boolean => {
    const open = FENCE_OPEN.exec(segment);
    if (!open || indentWidth(open[1]!) > maxIndent) return false;
    const marker = open[2]!;
    const info = open[3] ?? "";
    if (marker[0] === "~" || !info.includes("`")) {
      fenceChar = marker[0]!;
      fenceLength = marker.length;
      fenceMinIndent = minIndent;
      fenceMaxIndent = maxIndent;
      return true;
    }
    return false;
  };

  const isSiblingListItem = (top: ListLevel, parentContentIndent: number, markerIndent: number, delimiter: string | undefined): boolean => (
    delimiter === top.delimiter
    && markerIndent >= parentContentIndent
    && markerIndent < top.contentIndent
    && markerIndent <= parentContentIndent + 3
  );

  for (const line of lines) {
    if (!started && !line.trim()) continue;
    started = true;

    if (!line.trim()) {
      pendingBlanks++;
      continue;
    }

    const indent = leadingIndent(line);

    if (fenceChar) {
      if (indent < fenceMinIndent) {
        clearFence();
      } else {
        for (let i = 0; i < pendingBlanks; i++) output.push(">");
        pendingBlanks = 0;
        output.push(`> ${line}`);
        const close = FENCE_CLOSE.exec(line);
        if (close && indentWidth(close[1]!) <= fenceMaxIndent && close[2]![0] === fenceChar && close[2]!.length >= fenceLength) {
          clearFence();
        }
        continue;
      }
    }

    const thematicBreak = THEMATIC_BREAK.exec(line);
    const isThematicBreak = Boolean(thematicBreak && indentWidth(thematicBreak[1]!) <= (listStack.at(-1)?.contentIndent ?? 0) + 3);
    const listMatch = isThematicBreak ? null : LIST_ITEM_PREFIX.exec(line);
    const delimiter = listMatch ? (listMatch[2] ?? listMatch[3]) : undefined;
    const markerIndent = listMatch ? indentWidth(listMatch[1]!) : -1;
    const openCandidate = FENCE_OPEN.exec(line);
    const isOpeningFence = Boolean(
      openCandidate
      && indentWidth(openCandidate[1]!) <= 3
      && (openCandidate[2]![0] === "~" || !(openCandidate[3] ?? "").includes("`")),
    );
    const interruptsParagraph = Boolean(delimiter || isThematicBreak || isOpeningFence || BLOCK_INTERRUPT.test(line));

    // Lazy continuation lines without a preceding blank line keep the active list open.
    if (pendingBlanks > 0 || interruptsParagraph) {
      while (listStack.length > 0) {
        const top = listStack.at(-1)!;
        if (indent >= top.contentIndent && !(pendingBlanks > 0 && top.emptyItem)) break;
        const parentContentIndent = listStack.at(-2)?.contentIndent ?? 0;
        if (isSiblingListItem(top, parentContentIndent, markerIndent, delimiter)) break;
        listStack.pop();
      }
    }

    if (pendingBlanks > 0) {
      if (listStack.length > 0) {
        output.push(">");
      } else if (output.at(-1) !== "") {
        output.push("");
      }
      pendingBlanks = 0;
    }

    if (listMatch && delimiter) {
      const top = listStack.at(-1);
      const parentContentIndent = listStack.at(-2)?.contentIndent ?? 0;
      const sibling = top !== undefined && isSiblingListItem(top, parentContentIndent, markerIndent, delimiter);
      const baseIndent = sibling ? parentContentIndent : (top?.contentIndent ?? 0);
      if (markerIndent <= baseIndent + 3) {
        const rest = line.slice(listMatch[0].length);
        const emptyItem = rest.trim().length === 0;
        const contentIndent = listMatch[4] ? indentWidth(listMatch[0]) : indentWidth(listMatch[0]) + 1;
        if (sibling) {
          top.markerIndent = markerIndent;
          top.contentIndent = contentIndent;
          top.emptyItem = emptyItem;
        } else {
          listStack.push({ markerIndent, contentIndent, delimiter, emptyItem });
        }
        if (tryOpenFence(rest, contentIndent, 3)) {
          fenceMaxIndent = contentIndent + 3;
        }
      }
    } else {
      const top = listStack.at(-1);
      if (top) top.emptyItem = false;
      const baseIndent = top?.contentIndent ?? 0;
      tryOpenFence(line, baseIndent, baseIndent + 3);
    }
    output.push(`> ${line}`);
  }

  return output.join("\n");
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
      return formatThinkingBlocks(markdown);
    }
    return markdown;
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
