import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  getLanguageFromPath,
  highlightCode,
  keyText,
  type EditToolDetails,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import {
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

import { ExecutionSettings, executionDefinitionCache, type CodexExecutionOptions } from "./execution-settings.js";
import { getEditSyntaxFingerprint } from "./syntax-palette.js";
import { sanitizeDiffSource } from "./diff-source.js";
import { BashGroups, type BashGroupRowState } from "./bash-groups.js";
import { renderBashGroup } from "./bash-group-layout.js";
import { ReadGroups } from "./read-groups.js";
import { ReadViewComponent } from "./read-view.js";
import {
  fitToWidth,
  formatHomePath,
  normalizeOutputPad,
  normalizeWidth,
  padOutputLines,
  paintFittedBackground,
  paintForeground,
  resolveOutputPad,
} from "./layout.js";
import { ResponsiveLinesComponent } from "./responsive-lines.js";
import { ToolRenderCache, type RenderCacheScope } from "./render-cache.js";
import { createObservedWriteDefinition } from "./write-changes.js";
import { fileFailureStatus, toolStatusColor, toolStatusMarker, type ToolFailureStatus, type ToolStatus } from "./tool-status.js";
import { isClaudeTheme } from "./claude-palette.js";
import {
  claudeCallHeading,
  renderClaudeConnectorLine,
  renderClaudeDiff,
  renderClaudeDiffTruncation,
  renderClaudeMutationSummary,
} from "./claude-tools.js";

const COLLAPSED_DIFF_LINES = 12;
const CLAUDE_COLLAPSED_DIFF_LINES = 14;
const CLAUDE_COLLAPSED_WRITE_LINES = 10;
const MAX_DIFF_HIGHLIGHT_CHARS = 4096;
const DIFF_INDENT = "    ";
const ANSI_DEFAULT_FOREGROUND = "\x1b[39m";
const ANSI_DIM = "\x1b[2m";
const ANSI_INTENSITY_RESET = "\x1b[22m";

export interface CodexToolFactories {
  read: typeof createReadToolDefinition;
  edit: typeof createEditToolDefinition;
  write: typeof createWriteToolDefinition;
  bash: typeof createBashToolDefinition;
}

export interface CodexToolRenderServices {
  getExecutionOptions?: (ctx: ExtensionContext) => CodexExecutionOptions;
  getKeybindings?: () => Pick<KeybindingsManager, "getKeys"> | undefined;
  renderCache?: ToolRenderCache;
  readContextMessages?: (event: unknown, ctx: ExtensionContext) => Iterable<{ role: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean }>;
}

export interface DisplayDiffLine {
  kind: "context" | "removed" | "added" | "hunk";
  lineNumber: number | undefined;
  text: string;
  highlightedText?: string;
}

interface CodexReadState {
  callComponent?: ReadViewComponent;
}

interface WriteMetrics {
  content: string;
  lineCount: number;
}

interface CodexWriteState extends CodexEditState {
  metrics?: WriteMetrics;
  status?: "pending" | "success" | "error";
  callComponent?: ResponsiveLinesComponent;
}

type MutationDiffDetails = Partial<EditToolDetails>;

interface CodexEditState {
  failureStatus?: ToolFailureStatus;
  settledStatus?: ToolStatus;
  cache?: RenderCacheScope;
  path?: string;
  settledTitle?: string;
  callComponent?: ResponsiveLinesComponent;
  preparedDetails?: MutationDiffDetails;
  preparedPath?: string;
  preparedTheme?: Theme;
  preparedDiff?: DisplayDiffLine[];
  preparedStats?: { added: number; removed: number };
}

interface CodexBashState extends BashGroupRowState {
  callComponent?: ResponsiveLinesComponent;
}

const DEFAULT_FACTORIES: CodexToolFactories = {
  read: createReadToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
  bash: createBashToolDefinition,
};

export function registerCodexTools(
  pi: ExtensionAPI,
  factories: CodexToolFactories = DEFAULT_FACTORIES,
  services: CodexToolRenderServices = {},
): ReadonlyMap<string, ToolRenderers> {
  const getReadDefinition = createDefinitionCache(factories.read);
  const getEditDefinition = createDefinitionCache(factories.edit);
  // Injected factories may target remote filesystems; never probe local paths for them.
  const getWriteDefinition = createDefinitionCache((cwd: string) => factories.write === createWriteToolDefinition
    ? createObservedWriteDefinition(cwd)
    : factories.write(cwd));
  const getBashDefinition = createDefinitionCache(factories.bash);
  const executionSettings = new ExecutionSettings(services.getExecutionOptions);
  const configuredRead = executionDefinitionCache(executionSettings, (cwd, options) => factories.read(cwd, options.read));
  const configuredBash = executionDefinitionCache(executionSettings, (cwd, options) => factories.bash(cwd, options.bash));
  const renderCache = services.renderCache ?? new ToolRenderCache();
  const bashGroups = new BashGroups(renderCache);
  const readGroups = new ReadGroups(renderCache, formatToolPath);

  const resetRendering = () => {
    renderCache.clear();
    bashGroups.reset();
    readGroups.reset();
    lastMessageContent = undefined;
    lastContentLength = -1;
  };
  const readSnapshot = (event: unknown, ctx: ExtensionContext) => (
    services.readContextMessages ? [...services.readContextMessages(event, ctx)] : undefined
  );
  const rebuildGroups = (event: unknown, ctx: ExtensionContext) => {
    resetRendering();
    const messages = ctx?.mode === "tui" ? readSnapshot(event, ctx) : undefined;
    bashGroups.reset(ctx, false, messages);
    readGroups.reset(ctx, false, messages);
  };
  let firstSessionStart = true;
  let lastMessageContent: unknown[] | undefined;
  let lastContentLength = -1;
  const isSafeNonToolDelta = (event: { message: { role: string; content?: unknown }; assistantMessageEvent?: { type?: string; contentIndex?: number } }): boolean => {
    const sub = event.assistantMessageEvent;
    if (!sub || event.message.role !== "assistant" || !Array.isArray(event.message.content)) return false;
    if (
      sub.type !== "text_start"
      && sub.type !== "text_delta"
      && sub.type !== "text_end"
      && sub.type !== "thinking_start"
      && sub.type !== "thinking_delta"
      && sub.type !== "thinking_end"
    ) {
      return false;
    }
    if (event.message.content !== lastMessageContent || event.message.content.length !== lastContentLength) return false;
    const index = sub.contentIndex;
    if (typeof index !== "number") return false;
    const block = event.message.content[index] as { type?: unknown } | undefined;
    return block !== undefined && block.type !== "toolCall";
  };
  pi.on("session_start", (event, ctx) => {
    executionSettings.clear();
    // Reload builds the new instance's history rows before emitting session_start.
    // Keep those fresh scopes and discover their ownership without reviving old instances.
    if (firstSessionStart) {
      const messages = ctx?.mode === "tui" ? readSnapshot(event, ctx) : undefined;
      bashGroups.reset(ctx, true, messages);
      readGroups.reset(ctx, true, messages);
      lastMessageContent = undefined;
      lastContentLength = -1;
    } else rebuildGroups(event, ctx);
    firstSessionStart = false;
  });
  pi.on("session_tree", rebuildGroups);
  pi.on("session_compact", rebuildGroups);
  pi.on("session_shutdown", () => { executionSettings.clear(); resetRendering(); });
  pi.on("message_start", (event, ctx) => {
    if (ctx?.mode === "tui") {
      bashGroups.discover(event.message, true);
      readGroups.discover(event.message, true);
      lastMessageContent = event.message.role === "assistant" && Array.isArray(event.message.content) ? event.message.content : undefined;
      lastContentLength = lastMessageContent?.length ?? -1;
    }
  });
  pi.on("message_update", (event, ctx) => {
    if (ctx?.mode === "tui") {
      if (isSafeNonToolDelta(event)) return;
      bashGroups.discover(event.message);
      readGroups.discover(event.message);
      lastMessageContent = event.message.role === "assistant" && Array.isArray(event.message.content) ? event.message.content : undefined;
      lastContentLength = lastMessageContent?.length ?? -1;
    }
  });
  pi.on("message_end", (event, ctx) => {
    if (ctx?.mode === "tui") {
      bashGroups.discover(event.message);
      readGroups.discover(event.message);
      lastMessageContent = undefined;
      lastContentLength = -1;
      if (event.message.role === "toolResult" && event.message.toolName === "read") {
        readGroups.result(event.message.toolCallId, event.message, "message", event.message.isError);
      }
    }
  });
  pi.on("tool_execution_start", (event, ctx) => {
    if (ctx.mode === "tui" && event.toolName === "read") readGroups.start(event.toolCallId, event.args);
  });
  pi.on("tool_execution_update", (event, ctx) => {
    if (ctx.mode === "tui" && event.toolName === "read") {
      readGroups.start(event.toolCallId, event.args);
      readGroups.result(event.toolCallId, event.partialResult, "partial", false);
    }
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (ctx.mode === "tui" && event.toolName === "read") readGroups.result(event.toolCallId, event.result, "execution", event.isError);
  });

  const baseRead = getReadDefinition(process.cwd());
  const readTool: typeof baseRead = {
    ...baseRead,
    renderShell: "self",
    execute(toolCallId, params, signal, onUpdate, ctx) {
      const definition = factories.read === createReadToolDefinition ? configuredRead(ctx) : getReadDefinition(ctx.cwd);
      return definition.execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const state = context.state as unknown as CodexReadState;
      const view = readGroups.bind(context);
      view.updateCall(context);
      const component = state.callComponent ??= new ReadViewComponent(view.current);
      component.update(context.expanded, theme, context.outputPad, formatExpandKeys(services, context));
      return component;
    },
    renderResult(result, options, theme, context) {
      readGroups.bind(context).updateResult(result, options.isPartial, context.isError);
      return updateComponent(context.lastComponent, () => []);
    },
  };
  pi.registerTool(readTool);

  const baseEdit = getEditDefinition(process.cwd());
  const editTool: typeof baseEdit = {
    ...baseEdit,
    renderShell: "self",
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return getEditDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const state = context.state as unknown as CodexEditState;
      const path = formatToolPath(args.path, context.cwd);
      const outputPad = normalizeOutputPad(context.outputPad);
      if (state.path !== path) {
        state.path = path;
        state.settledTitle = undefined;
      }
      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      component.setRenderer(
        (width) => {
          const pad = resolveOutputPad(width, outputPad);
          const innerWidth = width - pad * 2;
          if (isClaudeTheme(theme)) {
            const status: ToolStatus = state.settledStatus ?? (context.executionStarted ? "running" : "pending");
            return padOutputLines([claudeCallHeading(theme, status, "Update", path || "(unknown)", innerWidth)], width, pad);
          }
          const title = state.settledTitle === undefined
            ? formatPendingMutationTitle("Editing", path, theme, innerWidth, context.executionStarted)
            : fitToWidth(state.settledTitle, innerWidth);
          return padOutputLines([title], width, pad);
        },
        { linesAlreadyFit: true },
      );
      return component;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexEditState;
      const path = state.path ?? formatToolPath(context.args.path, context.cwd);
      return renderMutationResult(state, result, result.details, options, path, "Edited", "edit",
        theme, context, renderCache, formatExpandKeys(services, context));
    },
  };
  pi.registerTool(editTool);

  const baseWrite = getWriteDefinition(process.cwd());
  const writeTool: ReturnType<typeof createObservedWriteDefinition> = {
    ...baseWrite,
    renderShell: "self",
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return getWriteDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const state = context.state as unknown as CodexWriteState;
      const path = formatToolPath(args.path, context.cwd);
      const outputPad = normalizeOutputPad(context.outputPad);
      // Throw in the slot callback, never from the deferred component paint.
      if (context.argsComplete && typeof args.content !== "string") throw new TypeError();
      state.callComponent = updateComponent(context.lastComponent, (width) => {
        const pad = resolveOutputPad(width, outputPad);
        const innerWidth = width - pad * 2;
        if (isClaudeTheme(theme)) {
          const status: ToolStatus = state.settledStatus
            ?? (state.status === "error"
              ? (state.failureStatus ?? "failed")
              : state.status === "success"
                ? "completed"
                : (context.executionStarted ? "running" : "pending"));
          return padOutputLines([claudeCallHeading(theme, status, "Write", path || "(unknown)", innerWidth)], width, pad);
        }
        if (!state.status || state.status === "pending") {
          return padOutputLines([formatPendingMutationTitle("Writing", path, theme, innerWidth, context.executionStarted)], width, pad);
        }
        if (state.status === "error") {
          return padOutputLines([fitToWidth(formatMutationFailureTitle("Write failed", path, theme, state.failureStatus), innerWidth)], width, pad);
        }
        if (state.settledTitle !== undefined) return padOutputLines([fitToWidth(state.settledTitle, innerWidth)], width, pad);
        const suffix = state.status === "success" && state.metrics
          ? theme.fg("dim", `(${formatLineCount(state.metrics.lineCount)})`)
          : "";
        return padOutputLines([fitToWidth(formatEditTitle("Write", path, theme, suffix), innerWidth)], width, pad);
      });
      return state.callComponent;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexWriteState;
      const outputPad = normalizeOutputPad(context.outputPad);
      state.status = options.isPartial ? "pending" : context.isError ? "error" : "success";
      const change = result.details?.codexWrite;
      if (state.status === "success" && change?.version === 1) {
        state.metrics = undefined;
        return renderMutationResult(state, result, change, options,
          formatToolPath(context.args.path, context.cwd), change.action ?? "Write", "write",
          theme, context, renderCache, formatExpandKeys(services, context));
      }
      state.settledTitle = undefined;
      if (state.status === "success") {
        const content = context.args.content;
        state.metrics = typeof content === "string" ? getWriteMetrics(state, content) : undefined;
      }
      state.callComponent?.invalidate();
      const error = state.status === "error" ? getMutationFailure(result.content, "Write failed") : undefined;
      state.failureStatus = error?.status;
      state.settledStatus = state.status === "error" ? (error?.status ?? "failed") : state.status === "success" ? "completed" : undefined;
      return updateComponent(context.lastComponent, (width) => {
        const pad = resolveOutputPad(width, outputPad);
        const inner = width - pad * 2;
        if (error !== undefined) {
          if (isClaudeTheme(theme)) {
            return padOutputLines([renderClaudeConnectorLine(error.text, toolStatusColor(error.status), theme, inner)], width, pad);
          }
          return padOutputLines([fitToWidth(theme.fg(toolStatusColor(error.status), `  ${error.text}`), inner)], width, pad);
        }
        if (isClaudeTheme(theme) && state.status === "success" && state.metrics) {
          return padOutputLines(
            [renderClaudeMutationSummary("write", formatToolPath(context.args.path, context.cwd), { added: state.metrics.lineCount, removed: 0 }, true, theme, inner)],
            width,
            pad,
          );
        }
        return [];
      });
    },
  };
  pi.registerTool(writeTool);

  const baseBash = getBashDefinition(process.cwd());
  const bashTool: typeof baseBash = {
    ...baseBash,
    renderShell: "self",
    execute(toolCallId, params, signal, onUpdate, ctx) {
      const definition = factories.bash === createBashToolDefinition ? configuredBash(ctx) : getBashDefinition(ctx.cwd);
      return definition.execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const state = context.state as unknown as CodexBashState;
      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      const member = bashGroups.bind(context as unknown as Parameters<BashGroups["bind"]>[0]);
      bashGroups.updateCall(member, context, component);
      const outputPad = normalizeOutputPad(context.outputPad);
      component.setRenderer((width) => {
        if (member.group.members[0] !== member) return [];
        const pad = resolveOutputPad(width, outputPad);
        return padOutputLines(
          renderBashGroup(member.group, context.expanded, theme, width - pad * 2, formatExpandKeys(services, context)),
          width,
          pad,
        );
      }, { linesAlreadyFit: true });
      return component;
    },
    renderResult(result, options, theme, context) {
      const member = bashGroups.bind(context as unknown as Parameters<BashGroups["bind"]>[0]);
      bashGroups.updateResult(member, result);
      return updateComponent(context.lastComponent, () => []);
    },
  };
  pi.registerTool(bashTool);
  return new Map<string, ToolRenderers>([["read", readTool as unknown as ToolRenderers], ["edit", editTool as unknown as ToolRenderers], ["write", writeTool as unknown as ToolRenderers], ["bash", bashTool as unknown as ToolRenderers]]);
}

export function parseDisplayDiff(diff: string): DisplayDiffLine[] {
  const rawLines = diff.split("\n").map(sanitizeDiffSource);
  if (rawLines.at(-1) === "") rawLines.pop();

  return rawLines.map((line) => {
    const marker = line[0];
    const kind: DisplayDiffLine["kind"] = marker === "+"
      ? "added"
      : marker === "-"
        ? "removed"
        : "context";
    const body = marker === "+" || marker === "-" || marker === " "
      ? line.slice(1)
      : line;
    const match = body.match(/^\s*(\d+)(?:\s(.*))?$/u);
    if (!match && kind === "context" && body.trim() === "...") {
      return { kind: "hunk", lineNumber: undefined, text: "⋮" };
    }

    return {
      kind,
      lineNumber: match ? Number.parseInt(match[1] ?? "", 10) : undefined,
      text: match ? (match[2] ?? "") : body.trimStart(),
    };
  });
}

export function parseUnifiedPatch(patch: string): DisplayDiffLine[] {
  const parsed: DisplayDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let hunkCount = 0;
  let inHunk = false;

  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      if (hunkCount > 0) {
        parsed.push({ kind: "hunk", lineNumber: undefined, text: "⋮" });
      }
      oldLine = Number.parseInt(hunk[1] ?? "0", 10);
      newLine = Number.parseInt(hunk[2] ?? "0", 10);
      hunkCount += 1;
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\ No newline at end of file")) continue;

    const marker = line[0];
    const text = sanitizeDiffSource(line.slice(1));
    if (marker === "-") {
      parsed.push({ kind: "removed", lineNumber: oldLine, text });
      oldLine += 1;
    } else if (marker === "+") {
      parsed.push({ kind: "added", lineNumber: newLine, text });
      newLine += 1;
    } else if (marker === " ") {
      parsed.push({ kind: "context", lineNumber: newLine, text });
      oldLine += 1;
      newLine += 1;
    }
  }

  return parsed;
}

function highlightDiffLine(text: string, language: string): string {
  let end = Math.min(text.length, MAX_DIFF_HIGHLIGHT_CHARS);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  const prefix = text.slice(0, end);
  return (highlightCode(prefix, language)[0] ?? prefix) + text.slice(end);
}

export function renderDisplayDiff(
  lines: readonly DisplayDiffLine[],
  theme: Theme,
  width: number,
  path = "",
  highlightedLines?: readonly string[],
): string[] {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return [];

  const lineNumberWidth = getDisplayLineNumberWidth(lines);
  const pureAddition = lines.every(line => line.kind === "added" || line.kind === "hunk");
  const language = getLanguageFromPath(path);
  const codeForeground = theme.getFgAnsi("toolDiffContext");

  return lines.map((line, index) => {
    if (line.kind === "hunk") {
      return fitToWidth(`${DIFF_INDENT}${ANSI_DIM}⋮${ANSI_INTENSITY_RESET}`, safeWidth);
    }

    const lineNumber = line.lineNumber === undefined
      ? " ".repeat(lineNumberWidth)
      : String(line.lineNumber).padStart(lineNumberWidth);
    const gutter = `${ANSI_DIM}${ANSI_DEFAULT_FOREGROUND}${lineNumber}${ANSI_INTENSITY_RESET}`;
    const sign = line.kind === "added"
      ? theme.fg("success", pureAddition ? "│" : "+")
      : line.kind === "removed"
        ? theme.fg("error", "-")
        : " ";
    const highlighted = highlightedLines?.[index] ?? line.highlightedText ?? (language
      ? highlightDiffLine(line.text, language)
      : line.text);
    const codeWithDefault = paintForeground(highlighted, codeForeground);
    const code = line.kind === "removed"
      ? `${ANSI_DIM}${codeWithDefault}${ANSI_INTENSITY_RESET}`
      : codeWithDefault;
    const needsBackground = (line.kind === "added" && !pureAddition) || line.kind === "removed";
    const content = fitToWidth(`${DIFF_INDENT}${gutter} ${sign} ${code}`, safeWidth, {
      ellipsis: "…",
      pad: needsBackground,
    });

    if (line.kind === "added" && !pureAddition) {
      return paintFittedBackground(content, theme.getBgAnsi("toolSuccessBg"));
    }
    if (line.kind === "removed") {
      return paintFittedBackground(content, theme.getBgAnsi("toolErrorBg"), ANSI_DIM);
    }
    return content;
  });
}

export function getDisplayLineNumberWidth(lines: readonly DisplayDiffLine[]): number {
  let lineNumberWidth = 1;
  for (const line of lines) {
    if (line.lineNumber === undefined) continue;
    lineNumberWidth = Math.max(lineNumberWidth, String(line.lineNumber).length);
  }
  return lineNumberWidth;
}

function createDefinitionCache<T>(factory: (cwd: string) => T): (cwd: string) => T {
  const definitions = new Map<string, T>();
  return (cwd) => {
    const cached = definitions.get(cwd);
    if (cached) return cached;
    const definition = factory(cwd);
    definitions.set(cwd, definition);
    return definition;
  };
}

function getResponsiveComponent(previous: Component | undefined): ResponsiveLinesComponent {
  return previous instanceof ResponsiveLinesComponent
    ? previous
    : new ResponsiveLinesComponent();
}

function updateComponent(
  previous: Component | undefined,
  renderer: (width: number) => string[],
): ResponsiveLinesComponent {
  const component = getResponsiveComponent(previous);
  component.setRenderer(
    renderer,
    { linesAlreadyFit: true },
  );
  return component;
}

function renderMutationResult(
  state: CodexEditState,
  result: { content: Array<{ type: string; text?: string }> },
  details: MutationDiffDetails | undefined,
  options: { expanded: boolean; isPartial: boolean },
  path: string,
  action: string,
  tool: "write" | "edit",
  theme: Theme,
  context: { isError: boolean; lastComponent?: Component; outputPad?: number },
  renderCache: ToolRenderCache,
  expandKeys: string,
): ResponsiveLinesComponent {
  const outputPad = normalizeOutputPad(context.outputPad);
  const setTitle = (title: string | undefined) => {
    if (state.settledTitle !== title) {
      state.settledTitle = title;
      state.callComponent?.invalidate();
    }
  };
  if (options.isPartial) {
    state.settledStatus = undefined;
    setTitle(undefined);
    return updateComponent(context.lastComponent, () => []);
  }
  const failure = tool === "write" ? "Write failed" : "Edit failed";
  const error = context.isError ? getMutationFailure(result.content, failure) : undefined;
  state.failureStatus = error?.status;
  if (error !== undefined) {
    state.settledStatus = error.status;
    setTitle(formatMutationFailureTitle(failure, path, theme, error.status));
    const color = toolStatusColor(error.status);
    return updateComponent(context.lastComponent, (width) => {
      const pad = resolveOutputPad(width, outputPad);
      const inner = width - pad * 2;
      if (isClaudeTheme(theme)) {
        return padOutputLines([renderClaudeConnectorLine(error.text, color, theme, inner)], width, pad);
      }
      return padOutputLines([fitToWidth(theme.fg(color, `  ${error.text}`), inner)], width, pad);
    });
  }
  state.settledStatus = "completed";
  state.cache ??= renderCache.scope();
  const diff = details && (details.patch || details.diff) ? getPreparedEditDiff(state, details, path, theme) : undefined;
  let title = formatEditTitle(action, path, theme);
  if (diff) {
    const stats = state.preparedStats ?? countDiffStats(diff);
    state.preparedStats = stats;
    title = formatEditTitle(action, path, theme, formatDiffStats(stats, theme));
  }
  setTitle(title);
  if (tool === "write" && !diff) {
    return updateComponent(context.lastComponent, (width) => {
      const pad = resolveOutputPad(width, outputPad);
      const inner = width - pad * 2;
      if (isClaudeTheme(theme)) {
        return padOutputLines([renderClaudeConnectorLine("Diff unavailable", "dim", theme, inner)], width, pad);
      }
      return padOutputLines([fitToWidth(theme.fg("dim", "  Diff unavailable"), inner)], width, pad);
    });
  }
  return updateComponent(context.lastComponent, (width) => {
    const pad = resolveOutputPad(width, outputPad);
    return padOutputLines(
      getEditResultLayout(state, result, diff, options, path, theme, false, width - pad * 2, expandKeys, tool),
      width,
      pad,
    );
  });
}

function getMutationFailure(content: Array<{ type: string; text?: string }>, fallback: string): { text: string; status: ToolFailureStatus } {
  // Reuse the captured text for classification and preview; do not invoke result getters twice.
  const single = content.length === 1 && content[0]?.type === "text" ? content[0].text : undefined;
  const captured = single === undefined ? content : [{ type: "text", text: single }];
  return {
    status: fileFailureStatus(captured),
    text: firstLine(extractText(captured)) || fallback,
  };
}

function formatPendingMutationTitle(action: string, path: string, theme: Theme, width: number, executionStarted: boolean): string {
  const prefix = `${toolStatusMarker(theme, executionStarted ? "running" : "pending")} ${theme.fg("toolTitle", theme.bold(action))} `;
  const filename = basename(path);
  const directory = dirname(path) === "." ? "" : `${dirname(path)}/`;
  const room = width - visibleWidth(prefix);
  const available = room - visibleWidth(filename);
  const name = theme.fg("accent", filename);
  const pathText = available < 2 ? fitToWidth(name, Math.max(0, room))
    : theme.fg("dim", visibleWidth(directory) <= available ? directory
      : `${fitToWidth(directory, available - 1)}/`) + name;
  return fitToWidth(prefix + pathText, width);
}

function formatTitlePath(path: string, theme: Theme): string {
  if (!path) return "(unknown path)";
  const directory = dirname(path) === "." ? "" : `${dirname(path)}/`;
  return theme.fg("dim", directory) + theme.fg("accent", basename(path));
}

function formatMutationFailureTitle(action: string, path: string, theme: Theme, status: ToolFailureStatus = "failed"): string {
  return `${toolStatusMarker(theme, status)} ${theme.bold(action)} ${path || "(unknown path)"}`;
}

function formatEditTitle(
  action: string,
  path: string,
  theme: Theme,
  suffix = "",
): string {
  const parts = [
    toolStatusMarker(theme, "completed"),
    theme.bold(action),
    formatTitlePath(path, theme),
  ];
  if (suffix) parts.push(suffix);
  return parts.join(" ");
}

function formatToolPath(path: string, cwd: string): string {
  if (!path) return "";
  if (!isAbsolute(path)) return path;

  const relativePath = relative(cwd, path);
  if (
    relativePath.length > 0
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  ) {
    return relativePath;
  }
  if (relativePath === "") return ".";
  return formatHomePath(path);
}

function getEditResultThemeFingerprint(theme: Theme): string {
  return [
    theme.fg("warning", "x"),
    theme.fg("error", "x"),
    theme.fg("success", "x"),
    theme.getFgAnsi("toolDiffContext"),
    theme.getBgAnsi("toolSuccessBg"),
    theme.getBgAnsi("toolErrorBg"),
  ].join("\0");
}

function getEditResultLayout(
  state: CodexEditState,
  result: { content: Array<{ type: string; text?: string }> },
  diffLines: DisplayDiffLine[] | undefined,
  options: { expanded: boolean; isPartial: boolean },
  path: string,
  theme: Theme,
  isError: boolean,
  width: number,
  expandKeys: string,
  tool: "write" | "edit" = "edit",
): string[] {
  const cache = state.cache!;
  const syntaxFingerprint = getEditSyntaxFingerprint(theme);
  const key = ["edit-layout", cache.identity(diffLines ?? result.content), width, options.expanded,
    options.isPartial, isError, path, tool, theme.name ?? "", cache.identity(theme), getEditResultThemeFingerprint(theme), syntaxFingerprint, expandKeys].join("\0");
  return cache.lines(key, () => renderEditResult(result, diffLines, options, path, theme, isError, width, cache, syntaxFingerprint, expandKeys, tool));
}

function renderEditResult(
  result: { content: Array<{ type: string; text?: string }> },
  diffLines: readonly DisplayDiffLine[] | undefined,
  options: { expanded: boolean; isPartial: boolean },
  path: string,
  theme: Theme,
  isError: boolean,
  width: number,
  cache: RenderCacheScope,
  syntaxFingerprint: string,
  expandKeys: string,
  tool: "write" | "edit" = "edit",
): string[] {
  if (options.isPartial) {
    return [fitToWidth(theme.fg("warning", "  … Editing"), width)];
  }
  if (isError) {
    const error = firstLine(extractText(result.content)) || "Edit failed";
    return isClaudeTheme(theme)
      ? [renderClaudeConnectorLine(error, "error", theme, width)]
      : [fitToWidth(theme.fg("error", `  ${error}`), width)];
  }
  if (!diffLines) {
    return isClaudeTheme(theme)
      ? [renderClaudeConnectorLine("Updated file", "muted", theme, width)]
      : [fitToWidth(theme.fg("success", "  └ Applied"), width)];
  }

  const claude = isClaudeTheme(theme);
  const pureAddition = diffLines.every(line => line.kind === "added" || line.kind === "hunk");
  const collapsedLimit = claude
    ? (tool === "write" && pureAddition ? CLAUDE_COLLAPSED_WRITE_LINES : CLAUDE_COLLAPSED_DIFF_LINES)
    : COLLAPSED_DIFF_LINES;
  const maximum = options.expanded ? diffLines.length : collapsedLimit;
  const visible = diffLines.slice(0, maximum);
  const language = getLanguageFromPath(path);
  const highlighted = cache.prefix(["edit-syntax", cache.identity(diffLines), path, syntaxFingerprint].join("\0"), visible.length, (index) => {
    const line = visible[index]!;
    return line.kind !== "hunk" && language ? highlightDiffLine(line.text, language) : line.text;
  });

  if (claude) {
    const stats = countDiffStats(diffLines);
    const lines = [
      renderClaudeMutationSummary(tool, path, stats, pureAddition, theme, width),
      ...renderClaudeDiff(visible, theme, width, path, getDisplayLineNumberWidth(visible), tool === "write" && pureAddition, highlighted),
    ];
    const remaining = diffLines.length - visible.length;
    if (remaining > 0) lines.push(renderClaudeDiffTruncation(remaining, theme, width, expandKeys));
    return lines;
  }

  const lines = renderDisplayDiff(visible, theme, width, path, highlighted);
  const remaining = diffLines.length - visible.length;
  if (remaining > 0) {
    lines.push(renderDiffTruncationFooter(remaining, theme, width, expandKeys));
  }
  return lines;
}

function renderDiffTruncationFooter(remaining: number, theme: Theme, width: number, expandKeys: string): string {
  return fitToWidth(theme.fg("dim", `${DIFF_INDENT}… +${remaining} lines${expandKeys ? ` (${expandKeys} to expand)` : ""}`), width);
}

function formatDiffStats(stats: { added: number; removed: number }, theme: Theme): string {
  const parts = [stats.added ? theme.fg("success", `+${stats.added}`) : "", stats.removed ? theme.fg("error", `-${stats.removed}`) : ""].filter(Boolean);
  return parts.length ? `${theme.fg("dim", "(")}${parts.join(" ")}${theme.fg("dim", ")")}` : "";
}

function formatExpandKeys(services: CodexToolRenderServices, context: object): string {
  const hints = context as { keyText?: typeof keyText };
  if (hints.keyText) return hints.keyText("app.tools.expand");
  const bindings = services.getKeybindings?.();
  if (!bindings) return keyText("app.tools.expand");
  return bindings.getKeys("app.tools.expand")
    .map(key => String(key).split("+")
      .map(part => process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part)
      .join("+"))
    .join("/");
}

function parseEditDiff(details: MutationDiffDetails): DisplayDiffLine[] {
  if (details.patch) {
    const parsed = parseUnifiedPatch(details.patch);
    if (parsed.length > 0) return parsed;
  }
  return parseDisplayDiff(details.diff ?? "");
}

function getPreparedEditDiff(
  state: CodexEditState,
  details: MutationDiffDetails,
  path: string,
  theme: Theme,
): DisplayDiffLine[] {
  if (
    state.preparedDiff
    && state.preparedDetails === details
    && state.preparedPath === path
    && state.preparedTheme === theme
  ) {
    return state.preparedDiff;
  }

  const prepared = parseEditDiff(details);
  state.preparedDetails = details;
  state.preparedPath = path;
  state.preparedTheme = theme;
  state.preparedDiff = prepared;
  state.preparedStats = countDiffStats(prepared);
  return prepared;
}

function countDiffStats(lines: readonly DisplayDiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added += 1;
    if (line.kind === "removed") removed += 1;
  }
  return { added, removed };
}

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n");
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

function getWriteMetrics(
  state: CodexWriteState,
  content: string,
): WriteMetrics {
  let metrics = state.metrics;
  if (metrics?.content !== content) {
    metrics = {
      content,
      lineCount: countLines(content),
    };
    state.metrics = metrics;
  }
  return metrics;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;

  let lineCount = 1;
  if (typeof content === "string") {
    for (let index = content.indexOf("\n"); index !== -1; index = content.indexOf("\n", index + 1)) {
      lineCount += 1;
    }
  } else {
    // Preserve the legacy malformed-argument behavior before host fallback.
    const legacy = content as string;
    for (let index = 0; index < legacy.length; index += 1) {
      if (legacy.charCodeAt(index) === 0x0a) lineCount += 1;
    }
  }
  return lineCount;
}

function formatLineCount(count: number): string {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}
