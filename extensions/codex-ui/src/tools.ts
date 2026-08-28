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
  truncateToVisualLines,
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
}

export interface DisplayDiffLine {
  kind: "context" | "removed" | "added" | "hunk";
  lineNumber: number | undefined;
  text: string;
  highlightedText?: string;
}

interface CodexEditState {
  path?: string;
  initialTitle?: string;
  settledTitle?: string;
  callComponent?: ResponsiveLinesComponent;
  preparedDetails?: EditToolDetails;
  preparedPath?: string;
  preparedTheme?: Theme;
  preparedDiff?: DisplayDiffLine[];
}

type CodexBashStatus = "pending" | "running" | "completed" | "failed";

interface PreparedBashResult {
  outputLines: string[];
  warning: string;
}

interface CodexBashState {
  startedAt?: number;
  endedAt?: number;
  status?: CodexBashStatus;
  callComponent?: ResponsiveLinesComponent;
  preparedContent?: Array<{ type: string; text?: string }>;
  preparedDetails?: BashToolDetails;
  preparedIsPartial?: boolean;
  preparedResult?: PreparedBashResult;
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
      const path = formatToolPath(args.path, context.cwd);
      const range = formatReadRange(args.offset, args.limit, theme);
      return updateComponent(context.lastComponent, (width) => [
        fitToWidth(formatToolTitle("Read", path, theme, range), width),
      ]);
    },
    renderResult(result, options, theme, context) {
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
      const path = formatToolPath(args.path, context.cwd);
      if (state.path !== path) {
        state.path = path;
        state.settledTitle = undefined;
      }
      state.initialTitle = formatEditTitle("Edit", path, theme);

      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      component.setRenderer((width) => [
        fitToWidth(state.settledTitle ?? state.initialTitle ?? "", width),
      ]);
      return component;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexEditState;
      const path = state.path ?? formatToolPath(context.args.path, context.cwd);
      const details = result.details as EditToolDetails | undefined;
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
        const stats = countDiffStats(preparedDiff);
        const suffix = `(${namedGreen(`+${stats.added}`)} ${namedRed(`-${stats.removed}`)})`;
        nextTitle = formatEditTitle("Edited", path, theme, suffix);
      } else {
        nextTitle = formatEditTitle("Edited", path, theme);
      }

      if (state.settledTitle !== nextTitle) {
        state.settledTitle = nextTitle;
        state.callComponent?.invalidate();
      }

      return updateComponent(context.lastComponent, (width) => renderEditResult(
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
      const path = formatToolPath(args.path, context.cwd);
      const lineCount = countLines(args.content);
      const suffix = theme.fg("dim", `(${formatLineCount(lineCount)})`);
      return updateComponent(context.lastComponent, (width) => [
        fitToWidth(formatToolTitle("Write", path, theme, suffix), width),
      ]);
    },
    renderResult(result, options, theme, context) {
      return updateComponent(context.lastComponent, (width) => renderWriteResult(
        result,
        context.args.content,
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
      updateBashLifecycle(state, context, bashRefreshScheduler);

      const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
      state.callComponent = component;
      component.setRenderer((width) => renderBashCall(args, state, theme, width));
      return component;
    },
    renderResult(result, options, theme, context) {
      const state = context.state as unknown as CodexBashState;
      const prepared = getPreparedBashResult(state, result, options.isPartial);
      return updateComponent(context.lastComponent, (width) => layoutBashResult(
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

  const lineNumberWidth = Math.max(
    1,
    ...lines.map((line) => line.lineNumber === undefined ? 0 : String(line.lineNumber).length),
  );
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
  component.setRenderer(renderer);
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
): string {
  const parts = [
    theme.fg("dim", "•"),
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
  let summary = hasImage ? "Image loaded" : formatLineCount(lineCount);
  if (result.details?.truncation?.truncated) {
    summary += " · truncated";
  }

  const lines = [theme.fg("success", `  └ ${summary}`)];
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

function renderWriteResult(
  result: { content: Array<{ type: string; text?: string }> },
  content: string,
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

  const summary = `  └ Written · ${formatLineCount(countLines(content))} · ${formatBytes(Buffer.byteLength(content, "utf8"))}`;
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
    scheduler.track(context.toolCallId, context.invalidate);
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
  lines.push("", ...renderBashCommand(args.command, status, theme, width));
  return lines;
}

function renderBashCommand(
  command: string,
  status: CodexBashStatus,
  theme: Theme,
  width: number,
): string[] {
  const displayCommand = sanitizeBashDisplayText(
    stripTerminalSequences(typeof command === "string" ? command : ""),
  ) || "…";
  const text = theme.fg("toolTitle", theme.bold(`$ ${displayCommand}`));
  const rail = width >= 2 ? theme.fg("success", "▌") : "";
  const gap = width >= 3 ? " " : "";
  const trailingPadding = width >= 4 ? 1 : 0;
  const prefix = `${rail}${gap}`;
  const contentWidth = Math.max(1, width - visibleWidth(prefix) - trailingPadding);
  const commandLines = wrapTextWithAnsi(text, contentWidth);

  const shellBackground = status === "completed"
    ? "toolSuccessBg"
    : status === "failed"
      ? "toolErrorBg"
      : "toolPendingBg";

  return (commandLines.length > 0 ? commandLines : [""]).map((line) => (
    `${theme.getBgAnsi("toolPendingBg")}${fitToWidth(`${prefix}${line}`, width, { pad: true })}${theme.getBgAnsi(shellBackground)}`
  ));
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

function layoutBashResult(
  prepared: PreparedBashResult,
  options: { expanded: boolean },
  theme: Theme,
  services: CodexToolRenderServices,
  width: number,
): string[] {
  let visualLines: string[] = [];
  let skippedCount = 0;
  if (prepared.outputLines.length > 0) {
    const styledOutput = prepared.outputLines
      .map((line) => theme.fg("toolOutput", line))
      .join("\n");
    const preview = truncateToVisualLines(
      styledOutput,
      options.expanded ? Number.MAX_SAFE_INTEGER : COLLAPSED_BASH_LINES,
      width,
    );
    visualLines = preview.visualLines;
    skippedCount = preview.skippedCount;
  }

  const lines = ["", ...visualLines];
  if (prepared.warning) {
    lines.push("", ...wrapTextWithAnsi(theme.fg("warning", `[${prepared.warning}]`), width));
  }

  const totalVisualLines = visualLines.length + skippedCount;
  const lineLabel = `${totalVisualLines} visual ${totalVisualLines === 1 ? "line" : "lines"}`;
  const footerLabel = !options.expanded && skippedCount > 0
    ? `${skippedCount} earlier visual lines hidden`
    : lineLabel;
  lines.push(
    "",
    ...renderAlignedLines(
      theme.fg("dim", footerLabel),
      formatExpandHint(options.expanded ? "collapse" : "expand", theme, services),
      width,
    ),
  );
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
  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => sanitizeBashDisplayText(stripTerminalSequences(item.text ?? "")).replace(/\r/g, ""))
    .join("\n");
}

function sanitizeBashDisplayText(text: string): string {
  return Array.from(text)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return false;
      if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return true;
      if (codePoint <= 0x1f) return false;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
      return codePoint < 0xfff9 || codePoint > 0xfffb;
    })
    .join("");
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

  const parsed = parseEditDiff(details);
  const language = getLanguageFromPath(path);
  const prepared = language
    ? parsed.map((line) => line.kind === "hunk"
      ? line
      : {
          ...line,
          highlightedText: highlightCode(line.text, language)[0] ?? line.text,
        })
    : parsed;
  state.preparedDetails = details;
  state.preparedPath = path;
  state.preparedTheme = theme;
  state.preparedDiff = prepared;
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

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n");
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

function countLines(content: string): number {
  return content.length === 0 ? 0 : content.split("\n").length;
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
