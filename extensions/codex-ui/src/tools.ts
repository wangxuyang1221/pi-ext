import { isAbsolute, relative, sep } from "node:path";
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
  type BashToolDetails,
  type EditToolDetails,
  type ExtensionAPI,
  type KeybindingsManager,
  type ReadToolDetails,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";

import { BashRefreshScheduler } from "./bash-refresh-scheduler.js";
import {
  getExactFittedVisualLines,
  getExactVisualTail,
} from "./exact-visual-tail.js";
import {
  fitToWidth,
  formatHomePath,
  normalizeWidth,
  paintBackground,
} from "./layout.js";
import { ResponsiveLinesComponent } from "./responsive-lines.js";

const COLLAPSED_BASH_LINES = 5;
const COLLAPSED_DIFF_LINES = 12;
const EXPANDED_READ_LINES = 40;
const BASH_DURATION_REFRESH_MS = 1000;
const LOW_POWER_ERROR_PREVIEW_CHARS = 4 * 1024;
const LOW_POWER_EDIT_PATCH_PREVIEW_CHARS = 4 * 1024;
const LOW_POWER_EDIT_PREVIEW_LINES = 6;
const LOW_POWER_BASH_COMMAND_PREVIEW_CHARS = 256;
const LOW_POWER_BASH_OUTPUT_PREVIEW_CHARS = 4 * 1024;
const LOW_POWER_BASH_PREVIEW_LINES = 3;
const LOW_POWER_BASH_WARNING_PREVIEW_CHARS = 1024;
const LOW_POWER_CONTENT_ITEM_LIMIT = 4 * 1024;
const DIFF_INDENT = "    ";
const ANSI_DEFAULT_FOREGROUND = "\x1b[39m";
const ANSI_DIM = "\x1b[2m";
const ANSI_INTENSITY_RESET = "\x1b[22m";
const ANSI_NAMED_GREEN = "\x1b[32m";
const ANSI_NAMED_RED = "\x1b[31m";
const ANSI_FOREGROUND_RESET = /\x1b\[39m/gu;
const ANSI_FULL_SGR_RESET = /\x1b\[(?:0)?m/gu;
const BASH_STATUS_PRESENTATION = {
  pending: { glyph: "•", color: "dim" },
  running: { glyph: "…", color: "warning" },
  completed: { glyph: "✓", color: "success" },
  failed: { glyph: "✗", color: "error" },
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
}

export interface DisplayDiffLine {
  kind: "context" | "removed" | "added" | "hunk";
  lineNumber: number | undefined;
  text: string;
  highlightedText?: string;
}

interface CodexReadState {
  path?: string;
  initialTitle?: string;
  settledTitle?: string;
  callComponent?: ResponsiveLinesComponent;
}

interface WriteMetrics {
  content: string;
  lineCount: number;
  bytes?: number;
}

type CodexToolRenderMode = "full" | "low-power";

interface CodexWriteState {
  renderMode?: CodexToolRenderMode;
  metrics?: WriteMetrics;
}

interface EditResultLayout {
  source: object;
  width: number;
  isPartial: boolean;
  isError: boolean;
  path: string;
  theme: Theme;
  themeFingerprint: string;
  lines: string[];
}

interface CodexEditState {
  renderMode?: CodexToolRenderMode;
  path?: string;
  initialTitle?: string;
  settledTitle?: string;
  callComponent?: ResponsiveLinesComponent;
  preparedDetails?: EditToolDetails;
  preparedPath?: string;
  preparedTheme?: Theme;
  preparedDiff?: DisplayDiffLine[];
  preparedStats?: { added: number; removed: number };
  lowPowerPreparedDetails?: EditToolDetails;
  lowPowerPreview?: string[];
  layoutSource?: object;
  collapsedLayouts?: EditResultLayout[];
  expandedLayout?: EditResultLayout;
}

type CodexBashStatus = "pending" | "running" | "completed" | "failed";

interface PreparedBashResult {
  outputLines: string[];
  warning: string;
}

interface LowPowerPreparedBashResult {
  outputLines: string[];
  warnings: string[];
}

interface BashCommandGeometry {
  width: number;
  lines: string[];
}

interface BashResultLayout {
  prepared: PreparedBashResult;
  width: number;
  theme: Theme;
  themeFingerprint: string;
  expandHint: string;
  lines: string[];
}

interface CodexBashState {
  renderMode?: CodexToolRenderMode;
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
  commandSource?: string;
  commandTheme?: Theme;
  commandThemeFingerprint?: string;
  commandGeometry?: BashCommandGeometry[];
  commandPaint?: {
    geometry: BashCommandGeometry;
    status: CodexBashStatus;
    lines: string[];
  };
  preparedContent?: Array<{ type: string; text?: string }>;
  preparedDetails?: BashToolDetails;
  preparedIsPartial?: boolean;
  preparedResult?: PreparedBashResult;
  collapsedResultLayouts?: BashResultLayout[];
  expandedResultLayout?: BashResultLayout;
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
  const getWriteDefinition = createDefinitionCache(factories.write);
  const getBashDefinition = createDefinitionCache(factories.bash);
  const bashRefreshScheduler = new BashRefreshScheduler(BASH_DURATION_REFRESH_MS);

  pi.on("tool_execution_end", (event) => {
    if (event.toolName === "bash") {
      bashRefreshScheduler.untrack(event.toolCallId);
    }
  });
  pi.on("session_shutdown", () => {
    bashRefreshScheduler.dispose();
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
      const path = formatToolPath(args.path, context.cwd);
      const range = formatReadRange(args.offset, args.limit, theme);
      if (state.path !== path) {
        state.path = path;
        state.settledTitle = undefined;
      }
      state.initialTitle = formatToolTitle("Read", path, theme, range);

      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      component.setRenderer((width) => [
        fitToWidth(state.settledTitle ?? state.initialTitle ?? "", width),
      ], { linesAlreadyFit: true });
      return component;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexReadState;
      const path = formatToolPath(context.args.path, context.cwd);
      const range = formatReadRange(context.args.offset, context.args.limit, theme);
      const nextTitle = !options.isPartial && !context.isError
        ? formatToolTitle("Read", path, theme, range, { glyph: "✓", color: "success" })
        : undefined;
      if (state.settledTitle !== nextTitle) {
        state.settledTitle = nextTitle;
        state.callComponent?.invalidate();
      }

      return updateComponent(context.lastComponent, (width) => renderReadResult(
        result,
        options,
        theme,
        context.isError,
        width,
      ));
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
      state.initialTitle = formatEditTitle("Edit", path, theme);

      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      component.setRenderer(
        (width) => [fitToWidth(state.settledTitle ?? state.initialTitle ?? "", width)],
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
      const details = result.details as EditToolDetails | undefined;
      if (getToolRenderMode(state, services) === "low-power") {
        const error = !options.isPartial && context.isError
          ? getLowPowerError(result.content, "Edit failed")
          : undefined;
        const preview = !options.isPartial && error === undefined
          ? getLowPowerEditPreview(state, details)
          : [];
        const nextTitle = options.isPartial
          ? formatEditTitle("Editing", path, theme, `${ANSI_DIM}…${ANSI_INTENSITY_RESET}`)
          : error !== undefined
            ? formatEditTitle("Edit failed", path, theme)
            : formatEditTitle("Edited", path, theme);
        if (state.settledTitle !== nextTitle) {
          state.settledTitle = nextTitle;
          state.callComponent?.invalidate();
        }

        const status = options.isPartial ? "partial" : error !== undefined ? "error" : "success";
        const cacheKey = [
          "low-power",
          "edit",
          "result",
          getLowPowerThemeFingerprint(theme),
          status,
          error ?? "",
          preview.join("\n"),
        ].join("\0");
        return updateComponent(context.lastComponent, (width) => renderLowPowerEditResult(
          preview,
          options.isPartial,
          error,
          theme,
          width,
        ), cacheKey);
      }

      const preparedDiff = !options.isPartial
        && !context.isError
        && details
        && (details.patch || details.diff)
        ? getPreparedEditDiff(state, details, path, theme)
        : undefined;

      let nextTitle: string;
      if (options.isPartial) {
        nextTitle = formatEditTitle("Editing", path, theme, `${ANSI_DIM}…${ANSI_INTENSITY_RESET}`);
      } else if (context.isError) {
        nextTitle = formatEditTitle("Edit failed", path, theme);
      } else if (preparedDiff) {
        const stats = state.preparedStats ?? countDiffStats(preparedDiff);
        state.preparedStats = stats;
        const suffix = `(${namedGreen(`+${stats.added}`)} ${namedRed(`-${stats.removed}`)})`;
        nextTitle = formatEditTitle("Edited", path, theme, suffix);
      } else {
        nextTitle = formatEditTitle("Edited", path, theme);
      }

      if (state.settledTitle !== nextTitle) {
        state.settledTitle = nextTitle;
        state.callComponent?.invalidate();
      }

      return updateComponent(context.lastComponent, (width) => getEditResultLayout(
        state,
        result,
        preparedDiff,
        options,
        path,
        theme,
        context.isError,
        width,
      ));
    },
  };
  pi.registerTool(editTool);

  const baseWrite = getWriteDefinition(process.cwd());
  const writeTool: typeof baseWrite = {
    ...baseWrite,
    renderShell: "self",
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return getWriteDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const state = context.state as unknown as CodexWriteState;
      const path = formatToolPath(args.path, context.cwd);
      if (getToolRenderMode(state, services) === "low-power") {
        return updateComponent(context.lastComponent, (width) => [
          fitToWidth(formatToolTitle("Write", path, theme), width),
        ], `low-power\0write\0call\0${getLowPowerThemeFingerprint(theme)}\0${path}`);
      }

      const metrics = getWriteMetrics(state, args.content, context.argsComplete);
      const suffix = theme.fg("dim", `(${formatLineCount(metrics.lineCount)})`);
      return updateComponent(context.lastComponent, (width) => [
        fitToWidth(formatToolTitle("Write", path, theme, suffix), width),
      ]);
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexWriteState;
      if (getToolRenderMode(state, services) === "low-power") {
        const status = options.isPartial ? "partial" : context.isError ? "error" : "success";
        const error = !options.isPartial && context.isError
          ? getLowPowerError(result.content, "Write failed")
          : undefined;
        return updateComponent(context.lastComponent, (width) => renderLowPowerWriteResult(
          options.isPartial,
          theme,
          error,
          width,
        ), `low-power\0write\0result\0${getLowPowerThemeFingerprint(theme)}\0${status}\0${error ?? ""}`);
      }

      const metrics = getWriteMetrics(
        state,
        context.args.content,
        context.argsComplete || (!options.isPartial && !context.isError),
      );
      return updateComponent(context.lastComponent, (width) => renderWriteResult(
        result,
        metrics,
        options.isPartial,
        theme,
        context.isError,
        width,
      ));
    },
  };
  pi.registerTool(writeTool);

  const baseBash = getBashDefinition(process.cwd());
  const bashTool: typeof baseBash = {
    ...baseBash,
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBashDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const state = context.state as unknown as CodexBashState;
      const lowPower = getToolRenderMode(state, services) === "low-power";
      updateBashLifecycle(state, context, bashRefreshScheduler, !lowPower);

      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
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
        ].join("\0");
        component.setRenderer(
          (width) => renderLowPowerBashCall(commandPreview, timeout, state, theme, width),
          { linesAlreadyFit: true, cacheKey },
        );
        return component;
      }

      component.setRenderer(
        (width) => renderBashCall(args, state, theme, width),
        { linesAlreadyFit: true },
      );
      return component;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexBashState;
      if (getToolRenderMode(state, services) === "low-power") {
        if (options.isPartial) {
          return updateComponent(
            context.lastComponent,
            () => [],
            "low-power\0bash\0result\0partial",
          );
        }

        const prepared = getLowPowerPreparedBashResult(state, result);
        return updateComponent(
          context.lastComponent,
          (width) => renderLowPowerBashResult(prepared, theme, width),
          getLowPowerBashResultCacheKey(prepared, theme),
        );
      }

      const prepared = getPreparedBashResult(state, result, options.isPartial);
      return updateComponent(context.lastComponent, (width) => getBashResultLayout(
        state,
        prepared,
        options,
        theme,
        services,
        width,
      ));
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

export function renderDisplayDiff(
  lines: readonly DisplayDiffLine[],
  theme: Theme,
  width: number,
  path = "",
): string[] {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return [];

  const lineNumberWidth = getDisplayLineNumberWidth(lines);
  const language = getLanguageFromPath(path);
  const codeForeground = theme.getFgAnsi("toolDiffContext");

  return lines.map((line) => {
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
    const highlighted = line.highlightedText ?? (language
      ? (highlightCode(line.text, language)[0] ?? line.text)
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

function formatToolTitle(
  action: string,
  path: string,
  theme: Theme,
  suffix = "",
  marker: { glyph: string; color: "dim" | "success" } = { glyph: "•", color: "dim" },
): string {
  const parts = [
    theme.fg(marker.color, marker.glyph),
    theme.fg("toolTitle", theme.bold(action)),
    theme.fg("accent", path || "(unknown path)"),
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

function formatReadRange(
  offset: number | undefined,
  limit: number | undefined,
  theme: Theme,
): string {
  if (offset === undefined && limit === undefined) return "";
  const parts: string[] = [];
  if (offset !== undefined) parts.push(`offset=${offset}`);
  if (limit !== undefined) parts.push(`limit=${limit}`);
  return theme.fg("dim", `(${parts.join(", ")})`);
}

function renderReadResult(
  result: { content: Array<{ type: string; text?: string }>; details?: ReadToolDetails },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  isError: boolean,
  width: number,
): string[] {
  if (options.isPartial) {
    return [fitToWidth(theme.fg("warning", "  … Reading"), width)];
  }

  const text = extractText(result.content);
  if (isError) {
    return [fitToWidth(theme.fg("error", `  ✗ ${firstLine(text) || "Read failed"}`), width)];
  }

  const hasImage = result.content.some((content) => content.type === "image");
  const lineCount = countLines(text);
  let summary = hasImage
    ? `  ${theme.fg("toolOutput", "Image loaded")}`
    : `  ${theme.fg("toolOutput", theme.bold(String(lineCount)))} ${theme.fg("dim", lineCount === 1 ? "line" : "lines")}`;
  if (result.details?.truncation?.truncated) {
    summary += theme.fg("dim", " · truncated");
  }

  const lines = [summary];
  if (options.expanded && text) {
    const contentLines = text.split("\n");
    const shown = contentLines.slice(0, EXPANDED_READ_LINES);
    lines.push(...shown.map((line) => `    ${theme.fg("toolOutput", line)}`));
    const remaining = contentLines.length - shown.length;
    if (remaining > 0) {
      lines.push(theme.fg("dim", `    … ${remaining} more lines`));
    }
  }
  return lines.map((line) => fitToWidth(line, width));
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
): string[] {
  const source = diffLines ?? result.content;
  const themeFingerprint = getEditResultThemeFingerprint(theme);
  if (state.layoutSource !== source) {
    state.layoutSource = source;
    state.collapsedLayouts = [];
    state.expandedLayout = undefined;
  }

  if (options.expanded) {
    const cached = state.expandedLayout;
    if (
      cached?.source === source
      && cached.width === width
      && cached.isPartial === options.isPartial
      && cached.isError === isError
      && cached.path === path
      && cached.theme === theme
      && cached.themeFingerprint === themeFingerprint
    ) {
      return cached.lines;
    }

    const lines = renderEditResult(result, diffLines, options, path, theme, isError, width);
    state.expandedLayout = {
      source,
      width,
      isPartial: options.isPartial,
      isError,
      path,
      theme,
      themeFingerprint,
      lines,
    };
    return lines;
  }

  if (state.expandedLayout && diffLines) {
    for (let index = COLLAPSED_DIFF_LINES; index < diffLines.length; index += 1) {
      diffLines[index]!.highlightedText = undefined;
    }
  }
  state.expandedLayout = undefined;
  const layouts = state.collapsedLayouts ??= [];
  const cachedIndex = layouts.findIndex((entry) => (
    entry.source === source
    && entry.width === width
    && entry.isPartial === options.isPartial
    && entry.isError === isError
    && entry.path === path
    && entry.theme === theme
    && entry.themeFingerprint === themeFingerprint
  ));
  const cached = layouts[cachedIndex];
  if (cached) {
    if (cachedIndex !== layouts.length - 1) {
      layouts.splice(cachedIndex, 1);
      layouts.push(cached);
    }
    return cached.lines;
  }

  const lines = renderEditResult(result, diffLines, options, path, theme, isError, width);
  layouts.push({
    source,
    width,
    isPartial: options.isPartial,
    isError,
    path,
    theme,
    themeFingerprint,
    lines,
  });
  if (layouts.length > 2) layouts.shift();
  return lines;
}

function getLowPowerEditPreview(
  state: CodexEditState,
  details: EditToolDetails | undefined,
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
    return [fitToWidth(theme.fg("error", `  ✗ ${error}`), width)];
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
): string[] {
  if (options.isPartial) {
    return [fitToWidth(theme.fg("warning", "  … Editing"), width)];
  }
  if (isError) {
    const error = firstLine(extractText(result.content)) || "Edit failed";
    return [fitToWidth(theme.fg("error", `  ✗ ${error}`), width)];
  }
  if (!diffLines) {
    return [fitToWidth(theme.fg("success", "  └ Applied"), width)];
  }

  const maximum = options.expanded ? diffLines.length : COLLAPSED_DIFF_LINES;
  const visible = diffLines.slice(0, maximum);
  prepareDiffHighlights(visible, path);
  const lines = renderDisplayDiff(visible, theme, width, path);
  const remaining = diffLines.length - visible.length;
  if (remaining > 0) {
    lines.push("", renderDiffTruncationFooter(remaining, width));
  }
  return lines;
}

function renderDiffTruncationFooter(remaining: number, width: number): string {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return "";

  const label = `${DIFF_INDENT}── ${remaining} ${remaining === 1 ? "line" : "lines"} hidden `;
  const rule = "─".repeat(Math.max(0, safeWidth - visibleWidth(label)));
  return fitToWidth(`${ANSI_DIM}${label}${rule}${ANSI_INTENSITY_RESET}`, safeWidth);
}

function renderLowPowerWriteResult(
  isPartial: boolean,
  theme: Theme,
  error: string | undefined,
  width: number,
): string[] {
  if (isPartial) {
    return [fitToWidth(theme.fg("warning", "  … Writing"), width)];
  }
  if (error !== undefined) {
    return [fitToWidth(theme.fg("error", `  ✗ ${error}`), width)];
  }
  return [fitToWidth(theme.fg("success", "  └ Written"), width)];
}

function renderWriteResult(
  result: { content: Array<{ type: string; text?: string }> },
  metrics: WriteMetrics,
  isPartial: boolean,
  theme: Theme,
  isError: boolean,
  width: number,
): string[] {
  if (isPartial) {
    return [fitToWidth(theme.fg("warning", "  … Writing"), width)];
  }
  if (isError) {
    const error = firstLine(extractText(result.content)) || "Write failed";
    return [fitToWidth(theme.fg("error", `  ✗ ${error}`), width)];
  }

  const summary = `  └ Written · ${formatLineCount(metrics.lineCount)} · ${formatBytes(metrics.bytes ?? Buffer.byteLength(metrics.content, "utf8"))}`;
  return [fitToWidth(theme.fg("success", summary), width)];
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
  scheduler: BashRefreshScheduler,
  trackRefresh = true,
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
    if (trackRefresh && state.status !== "running") {
      scheduler.track(context.toolCallId, context.invalidate);
    } else if (!trackRefresh) {
      scheduler.untrack(context.toolCallId);
    }
  } else {
    if (
      (nextStatus === "completed" || nextStatus === "failed")
      && state.startedAt !== undefined
      && state.endedAt === undefined
    ) {
      state.endedAt = Date.now();
    }
    scheduler.untrack(context.toolCallId);
  }

  state.status = nextStatus;
  if (!trackRefresh) {
    state.lowPowerDurationMs = state.startedAt === undefined
      ? undefined
      : Math.max(0, (state.endedAt ?? Date.now()) - state.startedAt);
  }
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

function renderLowPowerBashCall(
  commandPreview: string,
  timeout: string,
  state: CodexBashState,
  theme: Theme,
  width: number,
): string[] {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return [];

  const status = state.status ?? "pending";
  const presentation = BASH_STATUS_PRESENTATION[status];
  const summary = [
    theme.fg(presentation.color, presentation.glyph),
    theme.fg("toolTitle", theme.bold("Bash")),
    theme.fg("muted", status),
  ];
  const metadata: string[] = [];
  if (state.lowPowerDurationMs !== undefined) {
    metadata.push(formatDuration(state.lowPowerDurationMs));
  }
  if (timeout) metadata.push(timeout);
  if (metadata.length > 0) {
    summary.push(theme.fg("dim", metadata.join(" · ")));
  }

  const rail = safeWidth >= 2 ? theme.fg("success", "▌") : "";
  const gap = safeWidth >= 3 ? " " : "";
  const command = theme.fg("toolTitle", theme.bold(`$ ${commandPreview}`));
  const shellBackground = status === "completed"
    ? "toolSuccessBg"
    : status === "failed"
      ? "toolErrorBg"
      : "toolPendingBg";
  const commandLine = `${theme.getBgAnsi("toolPendingBg")}${fitToWidth(
    `${rail}${gap}${command}`,
    safeWidth,
    { pad: true },
  )}${theme.getBgAnsi(shellBackground)}`;

  return [fitToWidth(summary.join(" "), safeWidth), "", commandLine];
}

function renderBashCall(
  args: { command: string; timeout?: number },
  state: CodexBashState,
  theme: Theme,
  width: number,
): string[] {
  const status = state.status ?? "pending";
  const presentation = BASH_STATUS_PRESENTATION[status];
  const summary = [
    theme.fg(presentation.color, presentation.glyph),
    theme.fg("toolTitle", theme.bold("Bash")),
    theme.fg("muted", status),
  ].join(" ");

  const metadata: string[] = [];
  if (state.startedAt !== undefined) {
    const endTime = state.endedAt ?? Date.now();
    metadata.push(formatDuration(Math.max(0, endTime - state.startedAt)));
  }
  if (typeof args.timeout === "number" && Number.isFinite(args.timeout) && args.timeout > 0) {
    metadata.push(`${args.timeout}s limit`);
  }

  const lines = renderAlignedLines(
    summary,
    metadata.length > 0 ? theme.fg("dim", metadata.join(" · ")) : "",
    width,
  );
  lines.push("", ...renderBashCommand(args.command, state, status, theme, width));
  return lines;
}

function renderBashCommand(
  command: string,
  state: CodexBashState,
  status: CodexBashStatus,
  theme: Theme,
  width: number,
): string[] {
  const source = typeof command === "string" ? command : "";
  const themeFingerprint = getBashCommandThemeFingerprint(theme);
  if (
    state.commandSource !== source
    || state.commandTheme !== theme
    || state.commandThemeFingerprint !== themeFingerprint
  ) {
    state.commandSource = source;
    state.commandTheme = theme;
    state.commandThemeFingerprint = themeFingerprint;
    state.commandGeometry = [];
    state.commandPaint = undefined;
  }

  const geometries = state.commandGeometry ??= [];
  let geometryIndex = geometries.findIndex((entry) => entry.width === width);
  let geometry = geometries[geometryIndex];
  if (!geometry) {
    const displayCommand = sanitizeBashDisplayText(stripTerminalSequences(source)) || "…";
    const text = theme.fg("toolTitle", theme.bold(`$ ${displayCommand}`));
    const rail = width >= 2 ? theme.fg("success", "▌") : "";
    const gap = width >= 3 ? " " : "";
    const trailingPadding = width >= 4 ? 1 : 0;
    const prefix = `${rail}${gap}`;
    const contentWidth = Math.max(1, width - visibleWidth(prefix) - trailingPadding);
    const commandLines = wrapTextWithAnsi(text, contentWidth);
    geometry = {
      width,
      lines: (commandLines.length > 0 ? commandLines : [""]).map((line) => (
        `${theme.getBgAnsi("toolPendingBg")}${fitToWidth(`${prefix}${line}`, width, { pad: true })}`
      )),
    };
    geometries.push(geometry);
    if (geometries.length > 2) geometries.shift();
  } else if (geometryIndex !== geometries.length - 1) {
    geometries.splice(geometryIndex, 1);
    geometries.push(geometry);
  }

  if (state.commandPaint?.geometry === geometry && state.commandPaint.status === status) {
    return state.commandPaint.lines;
  }

  const shellBackground = status === "completed"
    ? "toolSuccessBg"
    : status === "failed"
      ? "toolErrorBg"
      : "toolPendingBg";
  const background = theme.getBgAnsi(shellBackground);
  const lines = geometry.lines.map((line) => `${line}${background}`);
  state.commandPaint = { geometry, status, lines };
  return lines;
}

function getBashCommandThemeFingerprint(theme: Theme): string {
  return [
    theme.fg("toolTitle", theme.bold("x")),
    theme.fg("success", "x"),
    theme.getBgAnsi("toolPendingBg"),
    theme.getBgAnsi("toolSuccessBg"),
    theme.getBgAnsi("toolErrorBg"),
  ].join("\0");
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
  theme: Theme,
  width: number,
): string[] {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return [];

  const lines = prepared.outputLines.map((line) => (
    fitToWidth(theme.fg("toolOutput", line), safeWidth)
  ));
  if (prepared.warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    for (const warning of prepared.warnings) {
      lines.push(fitToWidth(theme.fg("warning", `[${warning}]`), safeWidth));
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

function getPreparedBashResult(
  state: CodexBashState,
  result: { content: Array<{ type: string; text?: string }>; details?: BashToolDetails },
  isPartial: boolean,
): PreparedBashResult {
  if (
    state.preparedResult !== undefined
    && state.preparedContent === result.content
    && state.preparedDetails === result.details
    && state.preparedIsPartial === isPartial
  ) {
    return state.preparedResult;
  }

  const prepared = prepareBashResult(result, isPartial);
  state.preparedContent = result.content;
  state.preparedDetails = result.details;
  state.preparedIsPartial = isPartial;
  state.preparedResult = prepared;
  state.collapsedResultLayouts = [];
  state.expandedResultLayout = undefined;
  return prepared;
}

function prepareBashResult(
  result: { content: Array<{ type: string; text?: string }>; details?: BashToolDetails },
  isPartial: boolean,
): PreparedBashResult {
  const extracted = extractBashOutput(result.content).trim();
  const output = removeBashExecutionFooter(extracted, result.details, isPartial);
  return {
    outputLines: output ? output.split("\n") : [],
    warning: formatBashTruncationWarning(result.details),
  };
}

function getBashResultThemeFingerprint(theme: Theme): string {
  return [
    theme.fg("toolOutput", "x"),
    theme.fg("warning", "x"),
    theme.fg("dim", "x"),
    theme.fg("muted", "x"),
  ].join("\0");
}

function getBashResultLayout(
  state: CodexBashState,
  prepared: PreparedBashResult,
  options: { expanded: boolean },
  theme: Theme,
  services: CodexToolRenderServices,
  width: number,
): string[] {
  const expandHint = formatExpandHint(options.expanded ? "collapse" : "expand", theme, services);
  const themeFingerprint = getBashResultThemeFingerprint(theme);
  if (options.expanded) {
    const cached = state.expandedResultLayout;
    if (
      cached?.prepared === prepared
      && cached.width === width
      && cached.theme === theme
      && cached.themeFingerprint === themeFingerprint
      && cached.expandHint === expandHint
    ) {
      return cached.lines;
    }

    const lines = layoutBashResult(prepared, true, theme, expandHint, width);
    state.expandedResultLayout = {
      prepared,
      width,
      theme,
      themeFingerprint,
      expandHint,
      lines,
    };
    return lines;
  }

  state.expandedResultLayout = undefined;
  const layouts = state.collapsedResultLayouts ??= [];
  const cachedIndex = layouts.findIndex((entry) => (
    entry.prepared === prepared
    && entry.width === width
    && entry.theme === theme
    && entry.themeFingerprint === themeFingerprint
    && entry.expandHint === expandHint
  ));
  const cached = layouts[cachedIndex];
  if (cached) {
    if (cachedIndex !== layouts.length - 1) {
      layouts.splice(cachedIndex, 1);
      layouts.push(cached);
    }
    return cached.lines;
  }

  const lines = layoutBashResult(prepared, false, theme, expandHint, width);
  layouts.push({ prepared, width, theme, themeFingerprint, expandHint, lines });
  if (layouts.length > 2) layouts.shift();
  return lines;
}

function layoutBashResult(
  prepared: PreparedBashResult,
  expanded: boolean,
  theme: Theme,
  expandHint: string,
  width: number,
): string[] {
  let visualLines: string[] = [];
  let skippedCount = 0;
  if (prepared.outputLines.length > 0) {
    if (expanded) {
      visualLines = getExactFittedVisualLines(
        prepared.outputLines,
        (line) => theme.fg("toolOutput", line),
        width,
      );
    } else {
      const preview = getExactVisualTail(
        prepared.outputLines,
        (line) => theme.fg("toolOutput", line),
        width,
        COLLAPSED_BASH_LINES,
      );
      visualLines = preview.visualLines;
      skippedCount = preview.skippedCount;
    }
  }

  const lines = [""];
  for (const visualLine of visualLines) {
    lines.push(expanded ? visualLine : fitToWidth(visualLine, width));
  }
  if (prepared.warning) {
    lines.push("");
    for (const warningLine of wrapTextWithAnsi(
      theme.fg("warning", `[${prepared.warning}]`),
      width,
    )) {
      lines.push(fitToWidth(warningLine, width));
    }
  }

  const totalVisualLines = visualLines.length + skippedCount;
  const lineLabel = `${totalVisualLines} visual ${totalVisualLines === 1 ? "line" : "lines"}`;
  const footerLabel = !expanded && skippedCount > 0
    ? `${skippedCount} earlier visual lines hidden`
    : lineLabel;
  lines.push("");
  for (const footerLine of renderAlignedLines(
    theme.fg("dim", footerLabel),
    expandHint,
    width,
  )) {
    lines.push(fitToWidth(footerLine, width));
  }
  return lines;
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

function renderAlignedLines(left: string, right: string, width: number): string[] {
  if (!right) return wrapTextWithAnsi(left, width);

  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap >= 1) {
    return [`${left}${" ".repeat(gap)}${right}`];
  }

  const rightLines = wrapTextWithAnsi(right, width);
  return [
    ...wrapTextWithAnsi(left, width),
    ...rightLines.map((line) => `${" ".repeat(Math.max(0, width - visibleWidth(line)))}${line}`),
  ];
}

function extractBashOutput(content: Array<{ type: string; text?: string }>): string {
  let output = "";
  let hasText = false;
  for (const item of content) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    if (hasText) output += "\n";
    output += sanitizeBashDisplayText(stripTerminalSequences(item.text)).replace(/\r/gu, "");
    hasText = true;
  }
  return output;
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

function removeBashExecutionFooter(
  output: string,
  details: BashToolDetails | undefined,
  isPartial: boolean,
): string {
  if (
    isPartial
    || !details?.truncation?.truncated
    || !details.fullOutputPath
    || !output.endsWith("]")
  ) {
    return output;
  }

  const footerStart = output.lastIndexOf("\n\n[");
  if (
    footerStart !== -1
    && output.slice(footerStart).includes(details.fullOutputPath)
  ) {
    return output.slice(0, footerStart).trimEnd();
  }
  return output;
}

function formatBashTruncationWarning(details: BashToolDetails | undefined): string {
  const truncation = details?.truncation;
  const warnings: string[] = [];
  if (details?.fullOutputPath) {
    warnings.push(`Full output: ${details.fullOutputPath}`);
  }
  if (truncation?.truncated) {
    if (truncation.truncatedBy === "lines") {
      warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
    } else {
      warnings.push(`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`);
    }
  }
  return warnings.join(". ");
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function parseEditDiff(details: EditToolDetails): DisplayDiffLine[] {
  if (details.patch) {
    const parsed = parseUnifiedPatch(details.patch);
    if (parsed.length > 0) return parsed;
  }
  return parseDisplayDiff(details.diff);
}

function getPreparedEditDiff(
  state: CodexEditState,
  details: EditToolDetails,
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
  state.layoutSource = undefined;
  state.collapsedLayouts = [];
  state.expandedLayout = undefined;
  return prepared;
}

function prepareDiffHighlights(lines: readonly DisplayDiffLine[], path: string): void {
  const language = getLanguageFromPath(path);
  if (!language) return;

  for (const line of lines) {
    if (line.kind === "hunk" || line.highlightedText !== undefined) continue;
    line.highlightedText = highlightCode(line.text, language)[0] ?? line.text;
  }
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
  includeBytes: boolean,
): WriteMetrics {
  let metrics = state.metrics;
  if (metrics?.content !== content) {
    metrics = {
      content,
      lineCount: countLines(content),
    };
    state.metrics = metrics;
  }
  if (includeBytes && metrics.bytes === undefined) {
    metrics.bytes = Buffer.byteLength(content, "utf8");
  }
  return metrics;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;

  let lineCount = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 0x0a) lineCount += 1;
  }
  return lineCount;
}

function formatLineCount(count: number): string {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) {
    return `${kibibytes >= 10 ? Math.round(kibibytes) : kibibytes.toFixed(1)} KB`;
  }
  const mebibytes = kibibytes / 1024;
  return `${mebibytes >= 10 ? Math.round(mebibytes) : mebibytes.toFixed(1)} MB`;
}
