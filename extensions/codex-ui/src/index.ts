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
import { CLAUDE_THEME_NAME, isClaudeTheme } from "./claude-palette.js";
import { registerClaudeGenericToolRenderer } from "./claude-tools.js";

export const CODEX_THEME_NAME = "codex-pi";
export { CLAUDE_THEME_NAME };

const PROFILE_THEME_NAMES = new Set([CODEX_THEME_NAME, CLAUDE_THEME_NAME]);
const CLAUDE_BLOCK_SYNTAX_START = /^(?: {4}|\t|[ \t]*(?:#{1,6}(?:[ \t]|$)|>|`{3,}|~{3,}|[-+*][ \t]+|\d{1,9}[.)][ \t]+|\|))/u;
const CLAUDE_SETEXT_HEADING = /^[^\r\n]+\r?\n[ \t]*(?:=+|-+)[ \t]*(?:\r?\n|$)/u;
const CLAUDE_HIDDEN_THINKING_LABEL = "∴ Thinking… (ctrl+t to expand)";

function applyProfileTheme(
  ctx: ExtensionContext,
  notifyUnavailable: boolean,
  preferredThemeName?: string,
): string | undefined {
  const currentName = ctx.ui.theme.name;
  if (currentName && PROFILE_THEME_NAMES.has(currentName)) {
    return currentName;
  }
  const targetName = preferredThemeName && PROFILE_THEME_NAMES.has(preferredThemeName)
    ? preferredThemeName
    : CODEX_THEME_NAME;
  const profileTheme = ctx.ui.getTheme(targetName);
  if (!profileTheme) {
    if (notifyUnavailable) {
      ctx.ui.notify(`Profile theme unavailable: ${targetName}`, "warning");
    }
    return undefined;
  }
  const themeResult = ctx.ui.setTheme(profileTheme);
  if (!themeResult.success) {
    if (notifyUnavailable) {
      ctx.ui.notify(`Profile theme unavailable: ${themeResult.error ?? "unknown error"}`, "warning");
    }
    return undefined;
  }
  return targetName;
}

function startsWithMarkdownBlock(text: string): boolean {
  if (CLAUDE_BLOCK_SYNTAX_START.test(text) || CLAUDE_SETEXT_HEADING.test(text)) {
    return true;
  }
  const firstLine = text.split(/\r?\n/u, 1)[0] ?? "";
  return leadingIndent(firstLine) >= 4 || THEMATIC_BREAK.test(firstLine);
}

function formatClaudeUserMarkdown(markdown: string): string {
  if (!markdown.trim()) return markdown;
  const trimmedStart = markdown.replace(/^(?:\r?\n)+/u, "");
  if (trimmedStart.startsWith("❯ ") || trimmedStart.startsWith("❯\n")) return markdown;
  if (startsWithMarkdownBlock(trimmedStart)) {
    return `❯\n\n${trimmedStart}`;
  }
  return `❯ ${trimmedStart}`;
}

function formatClaudeAssistantMarkdown(markdown: string): string {
  if (!markdown.trim()) return markdown;
  const trimmedStart = markdown.replace(/^(?:\r?\n)+/u, "");
  if (trimmedStart.startsWith("● ") || startsWithMarkdownBlock(trimmedStart)) {
    return markdown;
  }
  return `● ${trimmedStart}`;
}

function formatClaudeThinkingMarkdown(markdown: string): string {
  if (!markdown.trim()) return markdown;
  return `∴ Thinking…\n\n${markdown.replace(/^\r?\n+/u, "")}`;
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
  let activeCtx: ExtensionContext | undefined;
  let lastProfileThemeName: string | undefined;
  let lastHiddenThinkingIsClaude: boolean | undefined;
  let activeHeader: CodexHeader | undefined;
  let activeEditor: CodexEditor | undefined;
  let activeFooter: CodexFooter | undefined;
  let activeTui: { requestRender(): void } | undefined;
  let currentBranch: string | null = null;

  const syncHiddenThinkingLabel = (ctx: ExtensionContext | undefined): void => {
    if (!ctx || typeof ctx.ui.setHiddenThinkingLabel !== "function") return;
    const claude = isClaudeTheme(ctx.ui.theme);
    if (claude === lastHiddenThinkingIsClaude) return;
    lastHiddenThinkingIsClaude = claude;
    ctx.ui.setHiddenThinkingLabel(claude ? CLAUDE_HIDDEN_THINKING_LABEL : undefined);
  };

  registerClaudeGenericToolRenderer(
    pi,
    () => currentKeybindings,
  );

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

  pi.registerMarkdownTransformer((markdown, context) => {
    if (isClaudeTheme(activeCtx?.ui.theme)) {
      if (context.messageType === "user") return formatClaudeUserMarkdown(markdown);
      if (context.messageType === "assistant") return formatClaudeAssistantMarkdown(markdown);
      if (context.messageType === "assistant-thinking") return formatClaudeThinkingMarkdown(markdown);
      return markdown;
    }
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
    targetThemeName: string;
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
    pending.ctx.ui.getTheme(pending.targetThemeName) !== pending.registeredBefore
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
    if (pending.ctx.ui.theme.name !== pending.targetThemeName) {
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
    activeCtx = undefined;
    activeHeader = undefined;
    activeEditor = undefined;
    activeFooter = undefined;
    activeTui = undefined;
    lastHiddenThinkingIsClaude = undefined;
  });

  pi.on("session_start", (event, ctx) => {
    clearPendingThemeRestore();
    sessionToken++;
    if (ctx.mode !== "tui") return;

    const currentSessionToken = sessionToken;
    activeCtx = ctx;
    currentModelId = ctx.model?.id;
    lastHiddenThinkingIsClaude = undefined;
    const appliedThemeName = applyProfileTheme(ctx, true, lastProfileThemeName);
    if (appliedThemeName) lastProfileThemeName = appliedThemeName;
    syncHiddenThinkingLabel(ctx);

    if (event.reason !== "startup" && appliedThemeName) {
      const registeredBefore = ctx.ui.getTheme(appliedThemeName);
      if (registeredBefore && ctx.ui.getTheme(appliedThemeName) === registeredBefore) {
        pendingThemeRestore = {
          ctx,
          sessionToken: currentSessionToken,
          targetThemeName: appliedThemeName,
          registeredBefore,
        };
        ctx.ui.addAutocompleteProvider?.((provider) => {
          schedulePostRebindDisarm(currentSessionToken);
          return provider;
        });
      }
    }

    const getTheme = () => {
      const theme = ctx.ui.theme;
      if (theme.name && PROFILE_THEME_NAMES.has(theme.name)) {
        lastProfileThemeName = theme.name;
      }
      syncHiddenThinkingLabel(ctx);
      return theme;
    };
    const getModelId = () => currentModelId;
    const getThinkingLevel = () => pi.getThinkingLevel();

    ctx.ui.setHeader(() => {
      activeHeader = new CodexHeader({
        version: VERSION,
        cwd: ctx.cwd,
        home: process.env.HOME,
        getModelId,
        getThinkingLevel,
        getBranch: () => currentBranch,
        getKeybindings: () => currentKeybindings,
        getTheme,
      });
      return activeHeader;
    });

    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      activeTui = tui;
      currentKeybindings = keybindings;
      activeHeader?.invalidate();
      activeFooter?.invalidate();
      activeEditor = new CodexEditor(
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

    const working = installWorking(ctx);
    ctx.ui.setFooter((tui, _theme, footerData) => {
      activeTui = tui;
      currentBranch = footerData.getGitBranch();
      activeHeader?.invalidate();
      const footer = new CodexFooter({
        cwd: ctx.cwd,
        home: process.env.HOME,
        getModelId,
        getThinkingLevel,
        getContextUsage: createContextUsageReader(ctx),
        getBranch: () => footerData.getGitBranch(),
        getExtensionStatuses: () => footerData.getExtensionStatuses(),
        getRate: () => working?.activity.label(),
        isBashMode: () => activeEditor?.isBashDraft() ?? false,
        getKeybindings: () => currentKeybindings,
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
            if (pending.ctx.ui.theme.name !== pending.targetThemeName) {
              clearPendingThemeRestore();
            }
            return;
          }
          const targetCtx = pending.ctx;
          const targetThemeName = pending.targetThemeName;
          clearPendingThemeRestore();
          if (targetCtx.ui.theme.name === targetThemeName) return;
          queueMicrotask(() => {
            if (sessionToken !== currentSessionToken) return;
            const restored = applyProfileTheme(targetCtx, false, targetThemeName);
            if (restored) lastProfileThemeName = restored;
            syncHiddenThinkingLabel(targetCtx);
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
