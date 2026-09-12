import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DEFAULT_MAX_BYTES,
  formatSize,
  getLanguageFromPath,
  highlightCode,
  keyHint,
  keyText,
  type BashToolDetails,
  type EditToolDetails,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";

import { BashGroups, type BashGroupRowState } from "./bash-groups.js";
import { renderBashGroup } from "./bash-group-layout.js";
import { ReadGroups, type ReadRowState } from "./read-groups.js";
import { renderReadGroup } from "./read-group-layout.js";
import {
  fitToWidth,
  formatHomePath,
  normalizeWidth,
  paintBackground,
} from "./layout.js";
import { ResponsiveLinesComponent } from "./responsive-lines.js";
import { ToolRenderCache, type RenderCacheScope } from "./render-cache.js";
import { createObservedWriteDefinition } from "./write-changes.js";

const COLLAPSED_DIFF_LINES = 12;
const MAX_DIFF_HIGHLIGHT_CHARS = 4096;
const LOW_POWER_ERROR_PREVIEW_CHARS = 4 * 1024;
const LOW_POWER_EDIT_PATCH_PREVIEW_CHARS = 4 * 1024;
const LOW_POWER_EDIT_PREVIEW_LINES = 6;
const LOW_POWER_BASH_COMMAND_PREVIEW_CHARS = 256;
const LOW_POWER_BASH_OUTPUT_PREVIEW_CHARS = 4 * 1024;
const LOW_POWER_BASH_PREVIEW_LINES = 3;
const LOW_POWER_BASH_WARNING_PREVIEW_CHARS = 1024;
const LOW_POWER_CONTENT_ITEM_LIMIT = 4 * 1024;
const DIFF_INDENT = "    ";
const BASH_TIMELINE_BRANCH = " ├─ ";
const BASH_DETAIL_INDENT = "      ";
const BASH_DETAIL_MIN_CONTENT_WIDTH = 4;
const BASH_SUMMARY_PRIMARY_MAX_WIDTH = 110;
const BASH_SUMMARY_MIN_GUTTER_WIDTH = 8;
const BASH_SUMMARY_GUTTER_MIN_TERMINAL_WIDTH = 72;
const ANSI_DEFAULT_FOREGROUND = "\x1b[39m";
const ANSI_DIM = "\x1b[2m";
const ANSI_INTENSITY_RESET = "\x1b[22m";
const ANSI_NAMED_GREEN = "\x1b[32m";
const ANSI_NAMED_RED = "\x1b[31m";
const ANSI_FOREGROUND_RESET = /\x1b\[39m/gu;
const ANSI_FULL_SGR_RESET = /\x1b\[(?:0)?m/gu;
const BASH_STATUS_PRESENTATION = {
  pending: { glyph: "○", color: "dim" },
  running: { glyph: "•", color: "warning" },
  completed: { glyph: "•", color: "success" },
  failed: { glyph: "•", color: "error" },
} as const;

export interface CodexToolFactories {
  read: typeof createReadToolDefinition;
  edit: typeof createEditToolDefinition;
  write: typeof createWriteToolDefinition;
  bash: typeof createBashToolDefinition;
}

export interface CodexToolRenderServices {
  getKeybindings?: () => Pick<KeybindingsManager, "getKeys"> | undefined;
  isLowPowerEnabled?: () => boolean;
  renderCache?: ToolRenderCache;
}

export interface DisplayDiffLine {
  kind: "context" | "removed" | "added" | "hunk";
  lineNumber: number | undefined;
  text: string;
  highlightedText?: string;
}

interface CodexReadState extends ReadRowState {
  callComponent?: ResponsiveLinesComponent;
}

interface WriteMetrics {
  content: string;
  lineCount: number;
}

type CodexToolRenderMode = "full" | "low-power";

interface CodexWriteState extends CodexEditState {
  renderMode?: CodexToolRenderMode;
  metrics?: WriteMetrics;
  status?: "pending" | "success" | "error";
  callComponent?: ResponsiveLinesComponent;
}

type MutationDiffDetails = Partial<EditToolDetails>;

interface CodexEditState {
  renderMode?: CodexToolRenderMode;
  cache?: RenderCacheScope;
  path?: string;
  settledTitle?: string;
  callComponent?: ResponsiveLinesComponent;
  preparedDetails?: MutationDiffDetails;
  preparedPath?: string;
  preparedTheme?: Theme;
  preparedDiff?: DisplayDiffLine[];
  preparedStats?: { added: number; removed: number };
  lowPowerPreparedDetails?: MutationDiffDetails;
  lowPowerPreview?: string[];
}

type CodexBashStatus = "pending" | "running" | "completed" | "failed";

interface LowPowerPreparedBashResult {
  outputLines: string[];
  warnings: string[];
}

interface CodexBashState extends BashGroupRowState {
  renderMode?: CodexToolRenderMode;
  cache?: RenderCacheScope;
  startedAt?: number;
  endedAt?: number;
  status?: CodexBashStatus;
  lowPowerDurationMs?: number;
  lowPowerCommandCaptured?: boolean;
  lowPowerCommandPreview?: string;
  lowPowerPreparedContent?: Array<{ type: string; text?: string }>;
  lowPowerPreparedDetails?: BashToolDetails;
  lowPowerPreparedResult?: LowPowerPreparedBashResult;
  callComponent?: ResponsiveLinesComponent;
  expanded?: boolean;
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
): void {
  const getReadDefinition = createDefinitionCache(factories.read);
  const getEditDefinition = createDefinitionCache(factories.edit);
  // Injected factories may target remote filesystems; never probe local paths for them.
  const getWriteDefinition = createDefinitionCache((cwd: string) => factories.write === createWriteToolDefinition
    ? createObservedWriteDefinition(cwd, services.isLowPowerEnabled)
    : factories.write(cwd));
  const getBashDefinition = createDefinitionCache(factories.bash);
  const renderCache = services.renderCache ?? new ToolRenderCache();
  const bashGroups = new BashGroups(renderCache);
  const readGroups = new ReadGroups(renderCache);

  const resetRendering = () => {
    renderCache.clear();
    bashGroups.reset();
    readGroups.reset();
  };
  const rebuildGroups = (_event: unknown, ctx: ExtensionContext) => {
    resetRendering();
    bashGroups.reset(ctx);
    readGroups.reset(ctx);
  };
  let firstSessionStart = true;
  pi.on("session_start", (event, ctx) => {
    // Reload builds the new instance's history rows before emitting session_start.
    // Keep those fresh scopes and discover their ownership without reviving old instances.
    if (firstSessionStart) {
      bashGroups.reset(ctx, true);
      readGroups.reset(ctx, true);
    } else rebuildGroups(event, ctx);
    firstSessionStart = false;
  });
  pi.on("session_tree", rebuildGroups);
  pi.on("session_compact", rebuildGroups);
  pi.on("session_shutdown", resetRendering);
  pi.on("message_start", (event, ctx) => {
    if (ctx?.mode === "tui") {
      bashGroups.discover(event.message, true);
      readGroups.discover(event.message, true);
    }
  });
  pi.on("message_update", (event, ctx) => {
    if (ctx?.mode === "tui") {
      bashGroups.discover(event.message);
      readGroups.discover(event.message);
    }
  });
  pi.on("message_end", (event, ctx) => {
    if (ctx?.mode === "tui") {
      bashGroups.discover(event.message);
      readGroups.discover(event.message);
    }
  });

  const baseRead = getReadDefinition(process.cwd());
  const readTool: typeof baseRead = {
    ...baseRead,
    renderShell: "self",
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return getReadDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const state = context.state as unknown as CodexReadState;
      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      const member = readGroups.bind(context);
      readGroups.updateCall(member, context, component, formatToolPath(typeof args.path === "string" ? args.path : "", context.cwd));
      component.setRenderer((width) => renderReadGroup(member, context.expanded, theme, width), { linesAlreadyFit: true });
      return component;
    },
    renderResult(result, options, theme, context) {
      const member = readGroups.bind(context);
      readGroups.updateResult(member, result, options.isPartial, context.isError);
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
      const lowPower = getToolRenderMode(state, services) === "low-power";
      const path = formatToolPath(args.path, context.cwd);
      if (state.path !== path) {
        state.path = path;
        state.settledTitle = undefined;
      }
      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      component.setRenderer(
        (width) => [state.settledTitle === undefined
          ? formatPendingMutationTitle("Editing", path, theme, width)
          : fitToWidth(state.settledTitle, width)],
        lowPower
          ? {
            linesAlreadyFit: true,
            cacheKey: `low-power\0edit\0call\0${getLowPowerThemeFingerprint(theme)}\0${path}`,
          }
          : { linesAlreadyFit: true },
      );
      return component;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexEditState;
      const path = state.path ?? formatToolPath(context.args.path, context.cwd);
      return renderMutationResult(state, result, result.details, options, path, "Edited", "edit",
        theme, context, services, renderCache);
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
      const lowPower = getToolRenderMode(state, services) === "low-power";
      // Throw in the slot callback, never from the deferred component paint.
      if (!lowPower && context.argsComplete && typeof args.content !== "string") throw new TypeError();
      state.callComponent = updateComponent(context.lastComponent, (width) => {
        if (!state.status || state.status === "pending") {
          return [formatPendingMutationTitle("Writing", path, theme, width)];
        }
        if (state.status === "error") return [fitToWidth(formatMutationFailureTitle("Write failed", path, theme), width)];
        if (state.settledTitle !== undefined) return [fitToWidth(state.settledTitle, width)];
        const suffix = state.status === "success" && state.metrics
          ? theme.fg("dim", `(${formatLineCount(state.metrics.lineCount)})`)
          : "";
        return [fitToWidth(formatEditTitle("Write", path, theme, suffix), width)];
      });
      return state.callComponent;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexWriteState;
      const lowPower = getToolRenderMode(state, services) === "low-power";
      state.status = options.isPartial ? "pending" : context.isError ? "error" : "success";
      const change = result.details?.codexWrite;
      if (state.status === "success" && change?.version === 1) {
        state.metrics = undefined;
        return renderMutationResult(state, result, change, options,
          formatToolPath(context.args.path, context.cwd), change.action ?? "Write", "write",
          theme, context, services, renderCache);
      }
      state.settledTitle = undefined;
      if (state.status === "success") {
        const content = context.args.content;
        state.metrics = typeof content === "string" ? getWriteMetrics(state, content) : undefined;
      }
      state.callComponent?.invalidate();
      const error = state.status === "error"
        ? lowPower ? getLowPowerError(result.content, "Write failed") : firstLine(extractText(result.content)) || "Write failed"
        : undefined;
      return updateComponent(context.lastComponent, (width) => error === undefined
        ? []
        : [fitToWidth(theme.fg("error", `  ${error}`), width)]);
    },
  };
  pi.registerTool(writeTool);

  const baseBash = getBashDefinition(process.cwd());
  const bashTool: typeof baseBash = {
    ...baseBash,
    renderShell: "self",
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBashDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const state = context.state as unknown as CodexBashState;
      const lowPower = getToolRenderMode(state, services) === "low-power";
      if (lowPower) {
        state.cache ??= renderCache.scope();
        updateBashLifecycle(state, context);
      }

      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      state.expanded = context.expanded;
      if (lowPower) {
        const commandPreview = getLowPowerBashCommandPreview(state, args, context.argsComplete);
        const duration = state.lowPowerDurationMs === undefined
          ? ""
          : formatDuration(state.lowPowerDurationMs);
        const timeout = getBashTimeoutLabel(args.timeout);
        const cacheKey = [
          "low-power",
          "bash",
          "call",
          getLowPowerThemeFingerprint(theme),
          state.status ?? "pending",
          duration,
          timeout,
          commandPreview,
          context.expanded,
        ].join("\0");
        component.setRenderer(
          (width) => renderLowPowerBashCall(
            commandPreview,
            timeout,
            state,
            theme,
            services,
            width,
          ),
          { linesAlreadyFit: true, cacheKey },
        );
        return component;
      }

      const member = bashGroups.bind(context as unknown as Parameters<BashGroups["bind"]>[0]);
      bashGroups.updateCall(member, context, component);
      component.setRenderer((width) => member.group.members[0] === member
        ? renderBashGroup(member.group, context.expanded, theme, width,
          formatBashExpandKeys(services))
        : [], { linesAlreadyFit: true });
      return component;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexBashState;
      if (getToolRenderMode(state, services) === "low-power") {
        const previousExpanded = state.expanded;
        state.expanded = options.expanded;
        if (options.isPartial) {
          if (previousExpanded !== options.expanded) state.callComponent?.invalidate();
          return updateComponent(
            context.lastComponent,
            () => [],
            `low-power\0bash\0result\0partial\0${options.expanded}`,
          );
        }

        const previousPrepared = state.lowPowerPreparedResult;
        const prepared = getLowPowerPreparedBashResult(state, result);
        if (previousPrepared !== prepared || previousExpanded !== options.expanded) {
          state.callComponent?.invalidate();
        }
        return updateComponent(
          context.lastComponent,
          (width) => renderLowPowerBashResult(prepared, options.expanded, theme, width),
          `${getLowPowerBashResultCacheKey(prepared, theme)}\0${options.expanded}`,
        );
      }

      const member = bashGroups.bind(context as unknown as Parameters<BashGroups["bind"]>[0]);
      bashGroups.updateResult(member, result);
      return updateComponent(context.lastComponent, () => []);
    },
  };
  pi.registerTool(bashTool);
}

export function parseDisplayDiff(diff: string): DisplayDiffLine[] {
  const rawLines = diff.split("\n");
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
    const text = line.slice(1);
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
      ? namedGreen("+")
      : line.kind === "removed"
        ? namedRed("-")
        : " ";
    const highlighted = highlightedLines?.[index] ?? line.highlightedText ?? (language
      ? highlightDiffLine(line.text, language)
      : line.text);
    const codeWithDefault = applyCodeForeground(highlighted, codeForeground);
    const code = line.kind === "removed"
      ? `${ANSI_DIM}${codeWithDefault}${ANSI_INTENSITY_RESET}`
      : codeWithDefault;
    const content = `${DIFF_INDENT}${gutter} ${sign} ${code}`;

    if (line.kind === "added") {
      return paintBackground(content, safeWidth, theme.getBgAnsi("toolSuccessBg"));
    }
    if (line.kind === "removed") {
      return paintBackground(content, safeWidth, theme.getBgAnsi("toolErrorBg"), ANSI_DIM);
    }
    return fitToWidth(content, safeWidth);
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

function getToolRenderMode(
  state: { renderMode?: CodexToolRenderMode },
  services: CodexToolRenderServices,
): CodexToolRenderMode {
  state.renderMode ??= services.isLowPowerEnabled?.() ? "low-power" : "full";
  return state.renderMode;
}

function getLowPowerThemeFingerprint(theme: Theme): string {
  return [
    theme.fg("toolTitle", theme.bold("x")),
    theme.fg("toolOutput", "x"),
    theme.fg("muted", "x"),
    theme.fg("dim", "x"),
    theme.fg("warning", "x"),
    theme.fg("success", "x"),
    theme.fg("error", "x"),
    theme.getBgAnsi("toolPendingBg"),
    theme.getBgAnsi("toolSuccessBg"),
    theme.getBgAnsi("toolErrorBg"),
  ].join("\0");
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
  cacheKey?: unknown,
): ResponsiveLinesComponent {
  const component = getResponsiveComponent(previous);
  component.setRenderer(
    renderer,
    cacheKey === undefined
      ? { linesAlreadyFit: true }
      : { linesAlreadyFit: true, cacheKey },
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
  context: { isError: boolean; lastComponent?: Component },
  services: CodexToolRenderServices,
  renderCache: ToolRenderCache,
): ResponsiveLinesComponent {
  const setTitle = (title: string | undefined) => {
    if (state.settledTitle !== title) {
      state.settledTitle = title;
      state.callComponent?.invalidate();
    }
  };
  if (options.isPartial) {
    setTitle(undefined);
    return updateComponent(context.lastComponent, () => []);
  }
  const failure = tool === "write" ? "Write failed" : "Edit failed";
  const lowPower = getToolRenderMode(state, services) === "low-power";
  const error = context.isError
    ? lowPower ? getLowPowerError(result.content, failure) : firstLine(extractText(result.content)) || failure
    : undefined;
  if (error !== undefined) {
    setTitle(formatMutationFailureTitle(failure, path, theme));
    return updateComponent(context.lastComponent, (width) => [fitToWidth(theme.fg("error", `  ${error}`), width)]);
  }
  if (lowPower) {
    setTitle(formatEditTitle(action, path, theme));
    if (tool === "write") return updateComponent(context.lastComponent, () => []);
    const preview = getLowPowerEditPreview(state, details);
    const key = ["low-power", tool, getLowPowerThemeFingerprint(theme), preview.join("\n")].join("\0");
    return updateComponent(context.lastComponent, (width) => renderLowPowerEditResult(preview, false, undefined, theme, width), key);
  }
  state.cache ??= renderCache.scope();
  const diff = details && (details.patch || details.diff) ? getPreparedEditDiff(state, details, path, theme) : undefined;
  let title = formatEditTitle(action, path, theme);
  if (diff) {
    const stats = state.preparedStats ?? countDiffStats(diff);
    state.preparedStats = stats;
    title = formatEditTitle(action, path, theme, `(${namedGreen(`+${stats.added}`)} ${namedRed(`-${stats.removed}`)})`);
    if (diff.length > 0) title = theme.underline(title);
  }
  setTitle(title);
  if (tool === "write" && !diff) {
    return updateComponent(context.lastComponent, (width) => [fitToWidth(theme.fg("dim", "  Diff unavailable"), width)]);
  }
  return updateComponent(context.lastComponent, (width) => getEditResultLayout(
    state, result, diff, options, path, theme, false, width,
  ));
}

function formatPendingMutationTitle(action: string, path: string, theme: Theme, width: number): string {
  const prefix = `${theme.fg("warning", "◌")} ${theme.fg("muted", action)}  `;
  const filename = basename(path);
  const directory = dirname(path) === "." ? "" : `${dirname(path)}/`;
  const room = width - visibleWidth(prefix);
  const available = room - visibleWidth(filename);
  const name = theme.fg("text", theme.bold(filename));
  const pathText = available < 2 ? fitToWidth(name, Math.max(0, room))
    : theme.fg("dim", visibleWidth(directory) <= available ? directory
      : `${fitToWidth(directory, available - 1)}/`) + name;
  return fitToWidth(prefix + pathText, width);
}

function formatMutationFailureTitle(action: string, path: string, theme: Theme): string {
  return `${theme.fg("error", "✗")} ${theme.bold(action)} ${path || "(unknown path)"}`;
}

function formatEditTitle(
  action: string,
  path: string,
  theme: Theme,
  suffix = "",
): string {
  const parts = [
    `${ANSI_DIM}•${ANSI_INTENSITY_RESET}`,
    theme.bold(action),
    path || "(unknown path)",
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

function getEditSyntaxFingerprint(theme: Theme): string {
  // The host passes the live theme proxy also consumed by highlightCode.
  return (["syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
    "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation", "mdCodeBlock"] as const)
    .map(color => theme.fg(color, "x")).join("\0");
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
): string[] {
  const cache = state.cache!;
  const syntaxFingerprint = getEditSyntaxFingerprint(theme);
  const key = ["edit-layout", cache.identity(diffLines ?? result.content), width, options.expanded,
    options.isPartial, isError, path, cache.identity(theme), getEditResultThemeFingerprint(theme), syntaxFingerprint].join("\0");
  return cache.lines(key, () => renderEditResult(result, diffLines, options, path, theme, isError, width, cache, syntaxFingerprint));
}

function getLowPowerEditPreview(
  state: CodexEditState,
  details: MutationDiffDetails | undefined,
): string[] {
  if (state.lowPowerPreparedDetails === details && state.lowPowerPreview !== undefined) {
    return state.lowPowerPreview;
  }

  const patch = details?.patch;
  const preview = typeof patch === "string"
    ? getLowPowerPrefixLines(
      patch,
      LOW_POWER_EDIT_PATCH_PREVIEW_CHARS,
      LOW_POWER_EDIT_PREVIEW_LINES,
    )
    : [];
  state.lowPowerPreparedDetails = details;
  state.lowPowerPreview = preview;
  return preview;
}

function renderLowPowerEditResult(
  preview: readonly string[],
  isPartial: boolean,
  error: string | undefined,
  theme: Theme,
  width: number,
): string[] {
  if (isPartial) {
    return [fitToWidth(theme.fg("warning", "  … Editing"), width)];
  }
  if (error !== undefined) {
    return [fitToWidth(theme.fg("error", `  ${error}`), width)];
  }
  if (preview.length === 0) {
    return [fitToWidth(theme.fg("success", "  └ Applied"), width)];
  }
  return preview.map((line) => fitToWidth(theme.fg("toolOutput", `    ${line}`), width));
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
): string[] {
  if (options.isPartial) {
    return [fitToWidth(theme.fg("warning", "  … Editing"), width)];
  }
  if (isError) {
    const error = firstLine(extractText(result.content)) || "Edit failed";
    return [fitToWidth(theme.fg("error", `  ${error}`), width)];
  }
  if (!diffLines) {
    return [fitToWidth(theme.fg("success", "  └ Applied"), width)];
  }

  const maximum = options.expanded ? diffLines.length : COLLAPSED_DIFF_LINES;
  const visible = diffLines.slice(0, maximum);
  const language = getLanguageFromPath(path);
  const highlighted = cache.prefix(["edit-syntax", cache.identity(diffLines), path, syntaxFingerprint].join("\0"), visible.length, (index) => {
    const line = visible[index]!;
    return line.kind !== "hunk" && language ? highlightDiffLine(line.text, language) : line.text;
  });
  const lines = renderDisplayDiff(visible, theme, width, path, highlighted);
  const remaining = diffLines.length - visible.length;
  if (remaining > 0) {
    lines.push(renderDiffTruncationFooter(remaining, theme, width));
  }
  return lines;
}

function renderDiffTruncationFooter(remaining: number, theme: Theme, width: number): string {
  return fitToWidth(theme.fg("dim", `  │     … ${remaining} more lines`), width);
}

function updateBashLifecycle(
  state: CodexBashState,
  context: {
    toolCallId: string;
    executionStarted: boolean;
    isPartial: boolean;
    isError: boolean;
    invalidate(): void;
  },
): void {
  const nextStatus: CodexBashStatus = context.isError
    ? "failed"
    : !context.isPartial
      ? "completed"
      : context.executionStarted
        ? "running"
        : "pending";

  if (nextStatus === "running") {
    if (state.startedAt === undefined) {
      state.startedAt = Date.now();
      state.endedAt = undefined;
    }
  } else {
    if (
      (nextStatus === "completed" || nextStatus === "failed")
      && state.startedAt !== undefined
      && state.endedAt === undefined
    ) {
      state.endedAt = Date.now();
    }
  }

  state.status = nextStatus;
  state.lowPowerDurationMs = state.startedAt === undefined
    ? undefined
    : Math.max(0, (state.endedAt ?? Date.now()) - state.startedAt);
}

function getLowPowerBashCommandPreview(
  state: CodexBashState,
  args: { command: string },
  argsComplete: boolean,
): string {
  if (!argsComplete) return "…";
  if (state.lowPowerCommandCaptured) return state.lowPowerCommandPreview ?? "…";

  const command = args.command;
  const source = typeof command === "string" ? command : "";
  const bounded = source.slice(0, LOW_POWER_BASH_COMMAND_PREVIEW_CHARS);
  const preview = sanitizeBashDisplayText(stripTerminalSequences(bounded))
    .replace(/[\r\n]+/gu, " ")
    .trim() || "…";
  state.lowPowerCommandCaptured = true;
  state.lowPowerCommandPreview = preview;
  return preview;
}

function getBashTimeoutLabel(timeout: number | undefined): string {
  return typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
    ? `${timeout}s limit`
    : "";
}

interface BashSummaryField {
  text: string;
  priority: number;
  order: number;
}

function renderLowPowerBashCall(
  commandPreview: string,
  timeout: string,
  state: CodexBashState,
  theme: Theme,
  services: CodexToolRenderServices,
  width: number,
): string[] {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return [];

  const fields: BashSummaryField[] = [];
  const prepared = state.lowPowerPreparedResult;
  if (prepared) {
    const count = prepared.outputLines.length;
    fields.push({
      text: theme.fg("dim", `${count} ${count === 1 ? "line" : "lines"} shown`),
      priority: 90,
      order: 10,
    });
    if (prepared.warnings.length > 0) {
      fields.push({ text: theme.fg("warning", "details"), priority: 95, order: 20 });
    }
  } else {
    fields.push({ text: theme.fg("dim", "output …"), priority: 90, order: 10 });
  }
  if (state.lowPowerDurationMs !== undefined) {
    fields.push({
      text: theme.fg("dim", formatDuration(state.lowPowerDurationMs)),
      priority: 80,
      order: 30,
    });
  }
  if (timeout) {
    fields.push({ text: theme.fg("dim", timeout), priority: 70, order: 40 });
  }
  fields.push({
    text: formatExpandHint(state.expanded ? "collapse" : "expand", theme, services),
    priority: 100,
    order: 50,
  });

  const lines = renderBashTimelineSummary(
    state.status ?? "pending",
    commandPreview,
    fields,
    theme,
    safeWidth,
  );
  if (state.expanded) {
    lines.push("", renderBashDetailLine(
      `${theme.fg("dim", "$ ")}${theme.fg("toolTitle", theme.bold(commandPreview))}`,
      safeWidth,
    ));
  }
  return lines;
}

function renderBashTimelineSummary(
  status: CodexBashStatus,
  command: string,
  fields: readonly BashSummaryField[],
  theme: Theme,
  width: number,
): string[] {
  const presentation = BASH_STATUS_PRESENTATION[status];
  const branch = width >= visibleWidth(`${BASH_TIMELINE_BRANCH}${presentation.glyph} Bash`)
    ? theme.fg("dim", BASH_TIMELINE_BRANCH)
    : "";
  const prefix = `${branch}${theme.fg(presentation.color, presentation.glyph)} ${theme.fg("toolTitle", theme.bold("Bash"))} ${theme.fg("muted", status)}`;
  const primaryWidth = getBashSummaryPrimaryWidth(width);
  const prefixWidth = visibleWidth(prefix);
  const primary = prefixWidth >= primaryWidth
    ? fitToWidth(prefix, primaryWidth)
    : fitToWidth(
      `${prefix} ${fitToWidth(
        theme.fg("toolOutput", command),
        Math.max(1, primaryWidth - prefixWidth - 1),
        { ellipsis: "..." },
      )}`,
      primaryWidth,
    );
  const metadata = renderBashSummaryMetadata(fields, theme, width);
  return metadata ? [primary, metadata] : [primary];
}

function getBashSummaryPrimaryWidth(width: number): number {
  const gutterWidth = width >= BASH_SUMMARY_GUTTER_MIN_TERMINAL_WIDTH
    ? BASH_SUMMARY_MIN_GUTTER_WIDTH
    : 0;
  return Math.max(1, Math.min(BASH_SUMMARY_PRIMARY_MAX_WIDTH, width - gutterWidth));
}

function renderBashSummaryMetadata(
  fields: readonly BashSummaryField[],
  theme: Theme,
  width: number,
): string {
  if (fields.length === 0) return "";

  const separator = theme.fg("dim", " · ");
  const separatorWidth = visibleWidth(separator);
  const contentWidth = getBashDetailContentWidth(width);
  const prioritized = [...fields].sort((left, right) => right.priority - left.priority);
  const selected: BashSummaryField[] = [];
  let usedWidth = 0;

  for (const field of prioritized) {
    const extraWidth = (selected.length > 0 ? separatorWidth : 0) + visibleWidth(field.text);
    if (usedWidth + extraWidth <= contentWidth) {
      selected.push(field);
      usedWidth += extraWidth;
    }
  }

  if (selected.length === 0) {
    return renderBashDetailLine(prioritized[0]?.text ?? "", width);
  }

  selected.sort((left, right) => left.order - right.order);
  return renderBashDetailLine(
    selected.map((field) => field.text).join(separator),
    width,
  );
}

function getBashDetailIndent(width: number): string {
  return width >= BASH_DETAIL_INDENT.length + BASH_DETAIL_MIN_CONTENT_WIDTH
    ? BASH_DETAIL_INDENT
    : "";
}

function getBashDetailContentWidth(width: number): number {
  return Math.max(1, width - getBashDetailIndent(width).length);
}

function renderBashDetailLine(line: string, width: number): string {
  return fitToWidth(`${getBashDetailIndent(width)}${line}`, width);
}

function getLowPowerPreparedBashResult(
  state: CodexBashState,
  result: { content: Array<{ type: string; text?: string }>; details?: BashToolDetails },
): LowPowerPreparedBashResult {
  if (
    state.lowPowerPreparedResult !== undefined
    && state.lowPowerPreparedContent === result.content
    && state.lowPowerPreparedDetails === result.details
  ) {
    return state.lowPowerPreparedResult;
  }

  const extracted = extractBoundedBashOutputTail(
    result.content,
    LOW_POWER_BASH_OUTPUT_PREVIEW_CHARS,
  ).trim();
  const output = removeLowPowerBashExecutionFooter(extracted, result.details);
  const prepared = {
    outputLines: output ? output.split("\n").slice(-LOW_POWER_BASH_PREVIEW_LINES) : [],
    warnings: formatLowPowerBashWarnings(result.details),
  };
  state.lowPowerPreparedContent = result.content;
  state.lowPowerPreparedDetails = result.details;
  state.lowPowerPreparedResult = prepared;
  return prepared;
}

function getLowPowerBashResultCacheKey(
  prepared: LowPowerPreparedBashResult,
  theme: Theme,
): string {
  return [
    "low-power",
    "bash",
    "result",
    getLowPowerThemeFingerprint(theme),
    prepared.outputLines.join("\n"),
    prepared.warnings.join("\n"),
  ].join("\0");
}

function renderLowPowerBashResult(
  prepared: LowPowerPreparedBashResult,
  expanded: boolean,
  theme: Theme,
  width: number,
): string[] {
  const safeWidth = normalizeWidth(width);
  if (!expanded || safeWidth === 0) return [];

  const lines = prepared.outputLines.map((line) => (
    renderBashDetailLine(theme.fg("toolOutput", line), safeWidth)
  ));
  if (prepared.warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    for (const warning of prepared.warnings) {
      lines.push(renderBashDetailLine(theme.fg("warning", `[${warning}]`), safeWidth));
    }
  }
  return lines;
}

function extractBoundedBashOutputTail(
  content: Array<{ type: string; text?: string }>,
  maxChars: number,
): string {
  const reversedChunks: string[] = [];
  let remaining = maxChars;
  let inspected = 0;
  let hasText = false;

  for (
    let index = content.length - 1;
    index >= 0 && remaining > 0 && inspected < LOW_POWER_CONTENT_ITEM_LIMIT;
    index -= 1
  ) {
    inspected += 1;
    const item = content[index];
    if (item?.type !== "text") continue;
    const text = item.text;
    if (typeof text !== "string") continue;

    if (hasText) {
      reversedChunks.push("\n");
      remaining -= 1;
      if (remaining === 0) break;
    }
    const chunk = text.slice(-remaining);
    reversedChunks.push(chunk);
    remaining -= chunk.length;
    hasText = true;
  }

  const bounded = reversedChunks.reverse().join("");
  return sanitizeBashDisplayText(stripTerminalSequences(bounded)).replace(/\r/gu, "");
}

function removeLowPowerBashExecutionFooter(
  output: string,
  details: BashToolDetails | undefined,
): string {
  const fullOutputPath = details?.fullOutputPath;
  if (
    typeof fullOutputPath !== "string"
    || fullOutputPath.length === 0
    || fullOutputPath.length > LOW_POWER_BASH_WARNING_PREVIEW_CHARS
    || !output.endsWith("]")
  ) {
    return output;
  }

  const footerStart = output.lastIndexOf("\n\n[");
  if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
    return output.slice(0, footerStart).trimEnd();
  }
  return output;
}

function formatLowPowerBashWarnings(details: BashToolDetails | undefined): string[] {
  const warnings: string[] = [];
  const fullOutputPath = details?.fullOutputPath;
  if (typeof fullOutputPath === "string" && fullOutputPath.length > 0) {
    const path = sanitizeBashDisplayText(stripTerminalSequences(
      fullOutputPath.slice(0, LOW_POWER_BASH_WARNING_PREVIEW_CHARS),
    )).replace(/[\r\n]+/gu, " ").trim();
    if (path) warnings.push(`Full output: ${path}`);
  }

  const truncation = details?.truncation;
  if (truncation?.truncated) {
    if (truncation.truncatedBy === "lines") {
      warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
    } else {
      const limit = formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES);
      warnings.push(`Truncated: ${truncation.outputLines} lines shown (${limit} limit)`);
    }
  }
  return warnings;
}

function formatBashExpandKeys(services: CodexToolRenderServices): string {
  const bindings = services.getKeybindings?.();
  if (!bindings) return keyText("app.tools.expand");
  return bindings.getKeys("app.tools.expand")
    .map(key => String(key).split("+")
      .map(part => process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part)
      .join("+"))
    .join("/");
}

function formatExpandHint(
  description: string,
  theme: Theme,
  services: CodexToolRenderServices,
): string {
  const keys = services.getKeybindings?.()?.getKeys("app.tools.expand") ?? [];
  if (keys.length === 0) {
    return keyHint("app.tools.expand", description);
  }

  const keyText = keys
    .map((key) => String(key)
      .split("+")
      .map((part) => process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part)
      .join("+"))
    .join("/");
  return theme.fg("dim", keyText) + theme.fg("muted", ` ${description}`);
}

function sanitizeBashDisplayText(text: string): string {
  let sanitized = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
      sanitized += character;
      continue;
    }
    if (codePoint <= 0x1f) continue;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    if (codePoint >= 0xfff9 && codePoint <= 0xfffb) continue;
    sanitized += character;
  }
  return sanitized;
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
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

function namedGreen(text: string): string {
  return `${ANSI_NAMED_GREEN}${text}${ANSI_DEFAULT_FOREGROUND}`;
}

function namedRed(text: string): string {
  return `${ANSI_NAMED_RED}${text}${ANSI_DEFAULT_FOREGROUND}`;
}

function applyCodeForeground(text: string, foregroundAnsi: string): string {
  const restored = text
    .replace(ANSI_FULL_SGR_RESET, (reset) => `${reset}${foregroundAnsi}`)
    .replace(ANSI_FOREGROUND_RESET, (reset) => `${reset}${foregroundAnsi}`);
  return `${foregroundAnsi}${restored}${ANSI_DEFAULT_FOREGROUND}`;
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

function getLowPowerPrefixLines(
  text: string,
  maximumChars: number,
  maximumLines: number,
): string[] {
  const bounded = sanitizeBashDisplayText(stripTerminalSequences(
    text.slice(0, maximumChars),
  )).replace(/\r\n?/gu, "\n");
  return bounded ? bounded.split("\n", maximumLines) : [];
}

function extractBoundedTextPrefix(
  content: Array<{ type: string; text?: string }>,
  maximumChars: number,
): string {
  let preview = "";
  let remaining = maximumChars;
  let hasText = false;
  const maximumItems = Math.min(content.length, LOW_POWER_CONTENT_ITEM_LIMIT);
  for (let index = 0; index < maximumItems && remaining > 0; index += 1) {
    const item = content[index];
    if (item?.type !== "text") continue;
    const text = item.text;
    if (typeof text !== "string") continue;
    if (hasText) {
      preview += "\n";
      remaining -= 1;
      if (remaining === 0) break;
    }
    const chunk = text.slice(0, remaining);
    preview += chunk;
    remaining -= chunk.length;
    hasText = true;
  }
  return sanitizeBashDisplayText(stripTerminalSequences(preview));
}

function getLowPowerError(
  content: Array<{ type: string; text?: string }>,
  fallback: string,
): string {
  const preview = extractBoundedTextPrefix(
    content,
    LOW_POWER_ERROR_PREVIEW_CHARS,
  ).replace(/\r\n?/gu, "\n");
  return firstLine(preview) || fallback;
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
