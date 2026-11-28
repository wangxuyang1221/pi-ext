import { isAbsolute, relative, sep } from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  getLanguageFromPath,
  highlightCode,
  type EditToolDetails,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import {
  ExecutionSettings,
  executionDefinitionCache,
  type CodexExecutionOptions,
} from "./execution-settings.js";
import { getEditSyntaxFingerprint } from "./syntax-palette.js";
import { hostKeybindingHints, type HostKeybindingHints } from "./keybinding-hints.js";
import { sanitizeDiffSource } from "./diff-source.js";
import { BashGroups, type BashGroupRowState } from "./bash-groups.js";
import { ReadGroups } from "./read-groups.js";
import { ReadViewComponent } from "./read-view.js";
import { formatHomePath, normalizeOutputPad, padOutputLines, resolveOutputPad } from "./layout.js";
import { ResponsiveLinesComponent } from "./responsive-lines.js";
import { ToolRenderCache, type RenderCacheScope } from "./render-cache.js";
import { createObservedWriteDefinition } from "./write-changes.js";
import { fileFailureStatus, toolStatusColor, type ToolFailureStatus, type ToolStatus } from "./tool-status.js";
import type { ReadMember } from "./read-groups.js";
import type { BashGroup } from "./bash-groups.js";

const MAX_DIFF_HIGHLIGHT_CHARS = 4096;

export interface ToolFactories {
  read: typeof createReadToolDefinition;
  edit: typeof createEditToolDefinition;
  write: typeof createWriteToolDefinition;
  bash: typeof createBashToolDefinition;
}

export interface ToolRenderServices {
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

interface ReadState {
  callComponent?: ReadViewComponent;
}

interface WriteMetrics {
  content: string;
  lineCount: number;
}

export interface WriteState extends EditState {
  metrics?: WriteMetrics;
  status?: "pending" | "success" | "error";
  callComponent?: ResponsiveLinesComponent;
}

type MutationDiffDetails = Partial<EditToolDetails>;

export interface EditState {
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

interface BashState extends BashGroupRowState {
  callComponent?: ResponsiveLinesComponent;
}

const DEFAULT_FACTORIES: ToolFactories = {
  read: createReadToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
  bash: createBashToolDefinition,
};

export interface GroupLayout {
  read(member: ReadMember, expanded: boolean, theme: Theme, width: number, expandKeys: string): string[];
  bash(group: BashGroup, expanded: boolean, theme: Theme, width: number, expandKeys: string): string[];
}

export interface ToolLayout extends GroupLayout {
  editHeading(state: EditState, path: string, theme: Theme, width: number, started: boolean): string;
  writeHeading(state: WriteState, path: string, theme: Theme, width: number, started: boolean): string;
  failureTitle?(action: string, path: string, theme: Theme, status: ToolFailureStatus): string;
  successTitle?(action: string, path: string, theme: Theme, stats?: DiffStats): string;
  notice(text: string, color: ReturnType<typeof toolStatusColor> | "dim", theme: Theme, width: number): string;
  applied(theme: Theme, width: number): string;
  writeSummary?(path: string, lineCount: number, theme: Theme, width: number): string;
  collapsedLines(tool: MutationTool, pureAddition: boolean): number;
  diff(input: DiffView): string[];
}

type MutationTool = "edit" | "write";
type DiffStats = { added: number; removed: number };
interface DiffView {
  tool: MutationTool;
  path: string;
  visible: readonly DisplayDiffLine[];
  highlighted: readonly string[];
  stats: DiffStats;
  pureAddition: boolean;
  remaining: number;
  theme: Theme;
  width: number;
  expandKeys: string;
}

export function registerTools(
  layout: ToolLayout,
  pi: ExtensionAPI,
  factories: ToolFactories = DEFAULT_FACTORIES,
  services: ToolRenderServices = {},
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
      const state = context.state as unknown as ReadState;
      const view = readGroups.bind(context);
      view.updateCall(context);
      const component = state.callComponent ??= new ReadViewComponent(view.current, layout.read);
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
      const state = context.state as unknown as EditState;
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
          return padOutputLines([layout.editHeading(state, path, theme, innerWidth, context.executionStarted)], width, pad);
        },
        { linesAlreadyFit: true },
      );
      return component;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as EditState;
      const path = state.path ?? formatToolPath(context.args.path, context.cwd);
      return renderMutationResult(layout, state, result, result.details, options, path, "Edited", "edit",
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
      const state = context.state as unknown as WriteState;
      const path = formatToolPath(args.path, context.cwd);
      const outputPad = normalizeOutputPad(context.outputPad);
      // Throw in the slot callback, never from the deferred component paint.
      if (context.argsComplete && typeof args.content !== "string") throw new TypeError();
      state.callComponent = updateComponent(context.lastComponent, (width) => {
        const pad = resolveOutputPad(width, outputPad);
        const innerWidth = width - pad * 2;
        return padOutputLines([layout.writeHeading(state, path, theme, innerWidth, context.executionStarted)], width, pad);
      });
      return state.callComponent;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as WriteState;
      const outputPad = normalizeOutputPad(context.outputPad);
      state.status = options.isPartial ? "pending" : context.isError ? "error" : "success";
      const change = result.details?.codexWrite;
      if (state.status === "success" && change?.version === 1) {
        state.metrics = undefined;
        return renderMutationResult(layout, state, result, change, options,
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
          return padOutputLines([layout.notice(error.text, toolStatusColor(error.status), theme, inner)], width, pad);
        }
        if (layout.writeSummary && state.status === "success" && state.metrics) {
          const path = formatToolPath(context.args.path, context.cwd);
          return padOutputLines([layout.writeSummary(path, state.metrics.lineCount, theme, inner)], width, pad);
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
      const state = context.state as unknown as BashState;
      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      const member = bashGroups.bind(context as unknown as Parameters<BashGroups["bind"]>[0]);
      bashGroups.updateCall(member, context, component);
      const outputPad = normalizeOutputPad(context.outputPad);
      component.setRenderer((width) => {
        if (member.group.members[0] !== member) return [];
        const pad = resolveOutputPad(width, outputPad);
        return padOutputLines(
          layout.bash(member.group, context.expanded, theme, width - pad * 2, formatExpandKeys(services, context)),
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

export function highlightDiffLine(text: string, language: string): string {
  let end = Math.min(text.length, MAX_DIFF_HIGHLIGHT_CHARS);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  const prefix = text.slice(0, end);
  return (highlightCode(prefix, language)[0] ?? prefix) + text.slice(end);
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
  layout: ToolLayout,
  state: EditState,
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
  const updateHeading = (status?: ToolStatus, title?: string) => {
    if (state.settledStatus !== status || state.settledTitle !== title) {
      state.settledStatus = status;
      state.settledTitle = title;
      state.callComponent?.invalidate();
    }
  };
  if (options.isPartial) {
    updateHeading();
    return updateComponent(context.lastComponent, () => []);
  }
  const failure = tool === "write" ? "Write failed" : "Edit failed";
  const error = context.isError ? getMutationFailure(result.content, failure) : undefined;
  state.failureStatus = error?.status;
  if (error !== undefined) {
    updateHeading(error.status, layout.failureTitle?.(failure, path, theme, error.status));
    const color = toolStatusColor(error.status);
    return updateComponent(context.lastComponent, (width) => {
      const pad = resolveOutputPad(width, outputPad);
      const inner = width - pad * 2;
      return padOutputLines([layout.notice(error.text, color, theme, inner)], width, pad);
    });
  }
  state.cache ??= renderCache.scope();
  const diff = details && (details.patch || details.diff) ? getPreparedEditDiff(state, details, path, theme) : undefined;
  updateHeading("completed", layout.successTitle?.(action, path, theme, diff ? state.preparedStats : undefined));
  if (tool === "write" && !diff) {
    return updateComponent(context.lastComponent, (width) => {
      const pad = resolveOutputPad(width, outputPad);
      const inner = width - pad * 2;
      return padOutputLines([layout.notice("Diff unavailable", "dim", theme, inner)], width, pad);
    });
  }
  return updateComponent(context.lastComponent, (width) => {
    const pad = resolveOutputPad(width, outputPad);
    return padOutputLines(
      getEditResultLayout(layout, state, diff, options.expanded, path, theme, width - pad * 2, expandKeys, tool),
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
  layout: ToolLayout,
  state: EditState,
  diffLines: DisplayDiffLine[] | undefined,
  expanded: boolean,
  path: string,
  theme: Theme,
  width: number,
  expandKeys: string,
  tool: MutationTool,
): string[] {
  if (!diffLines) return [layout.applied(theme, width)];
  const cache = state.cache!;
  const syntaxFingerprint = getEditSyntaxFingerprint(theme);
  const key = ["edit-layout", cache.identity(diffLines), width, expanded,
    path, tool, theme.name ?? "", cache.identity(theme), getEditResultThemeFingerprint(theme), syntaxFingerprint, expandKeys].join("\0");
  return cache.lines(key, () => renderEditResult(layout, diffLines, state.preparedStats!, expanded, path, theme, width, cache, syntaxFingerprint, expandKeys, tool));
}

function renderEditResult(
  layout: ToolLayout,
  diffLines: readonly DisplayDiffLine[],
  stats: DiffStats,
  expanded: boolean,
  path: string,
  theme: Theme,
  width: number,
  cache: RenderCacheScope,
  syntaxFingerprint: string,
  expandKeys: string,
  tool: MutationTool,
): string[] {
  const pureAddition = diffLines.every(line => line.kind === "added" || line.kind === "hunk");
  const collapsedLimit = layout.collapsedLines(tool, pureAddition);
  const maximum = expanded ? diffLines.length : collapsedLimit;
  const visible = diffLines.slice(0, maximum);
  const language = getLanguageFromPath(path);
  const highlighted = cache.prefix(["edit-syntax", cache.identity(diffLines), path, syntaxFingerprint].join("\0"), visible.length, (index) => {
    const line = visible[index]!;
    return line.kind !== "hunk" && language ? highlightDiffLine(line.text, language) : line.text;
  });

  return layout.diff({
    tool, path, visible, highlighted, stats, pureAddition,
    remaining: diffLines.length - visible.length, theme, width, expandKeys,
  });
}

function formatExpandKeys(services: ToolRenderServices, context: object): string {
  return hostKeybindingHints(context as Partial<HostKeybindingHints>, services.getKeybindings?.()).keyText("app.tools.expand");
}

function parseEditDiff(details: MutationDiffDetails): DisplayDiffLine[] {
  if (details.patch) {
    const parsed = parseUnifiedPatch(details.patch);
    if (parsed.length > 0) return parsed;
  }
  return parseDisplayDiff(details.diff ?? "");
}

function getPreparedEditDiff(
  state: EditState,
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
  state: WriteState,
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
