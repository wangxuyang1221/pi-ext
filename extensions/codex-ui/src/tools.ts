import { isAbsolute, relative, sep } from "node:path";
import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type EditToolDetails,
  type ExtensionAPI,
  type ReadToolDetails,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import {
  fitToWidth,
  formatHomePath,
  normalizeWidth,
} from "./layout.js";

const COLLAPSED_DIFF_LINES = 12;
const EXPANDED_READ_LINES = 40;

export interface CodexToolFactories {
  read: typeof createReadToolDefinition;
  edit: typeof createEditToolDefinition;
  write: typeof createWriteToolDefinition;
}

export interface DisplayDiffLine {
  kind: "context" | "removed" | "added";
  lineNumber: number | undefined;
  text: string;
}

interface CodexEditState {
  path?: string;
  initialTitle?: string;
  settledTitle?: string;
  callComponent?: ResponsiveLinesComponent;
}

const DEFAULT_FACTORIES: CodexToolFactories = {
  read: createReadToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
};

class ResponsiveLinesComponent implements Component {
  private renderer: (width: number) => string[] = () => [];

  setRenderer(renderer: (width: number) => string[]): void {
    this.renderer = renderer;
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    return this.renderer(safeWidth)
      .map((line) => fitToWidth(line, safeWidth));
  }

  invalidate(): void {}
}

export function registerCodexTools(
  pi: ExtensionAPI,
  factories: CodexToolFactories = DEFAULT_FACTORIES,
): void {
  const getReadDefinition = createDefinitionCache(factories.read);
  const getEditDefinition = createDefinitionCache(factories.edit);
  const getWriteDefinition = createDefinitionCache(factories.write);

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
      state.initialTitle = formatToolTitle("Edit", path, theme);

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

      let nextTitle: string;
      if (options.isPartial) {
        nextTitle = formatToolTitle("Editing", path, theme, theme.fg("warning", "…"));
      } else if (context.isError) {
        nextTitle = formatToolTitle("Edit failed", path, theme);
      } else if (details?.diff) {
        const stats = countDiffStats(parseDisplayDiff(details.diff));
        const suffix = `(${theme.fg("success", `+${stats.added}`)} ${theme.fg("error", `−${stats.removed}`)})`;
        nextTitle = formatToolTitle("Edited", path, theme, suffix);
      } else {
        nextTitle = formatToolTitle("Edited", path, theme);
      }

      if (state.settledTitle !== nextTitle) {
        state.settledTitle = nextTitle;
        context.invalidate();
      }

      return updateComponent(context.lastComponent, (width) => renderEditResult(
        result,
        details,
        options,
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

    return {
      kind,
      lineNumber: match ? Number.parseInt(match[1] ?? "", 10) : undefined,
      text: match ? (match[2] ?? "") : body.trimStart(),
    };
  });
}

export function renderDisplayDiff(
  lines: readonly DisplayDiffLine[],
  theme: Theme,
  width: number,
): string[] {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return [];

  const lineNumberWidth = Math.max(
    1,
    ...lines.map((line) => line.lineNumber === undefined ? 0 : String(line.lineNumber).length),
  );

  return lines.map((line) => {
    const lineNumber = line.lineNumber === undefined
      ? " ".repeat(lineNumberWidth)
      : String(line.lineNumber).padStart(lineNumberWidth);
    const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
    const color = line.kind === "added"
      ? "toolDiffAdded"
      : line.kind === "removed"
        ? "toolDiffRemoved"
        : "toolDiffContext";
    const content = `${theme.fg("dim", lineNumber)} ${theme.fg(color, marker)} ${theme.fg(color, line.text)}`;

    if (line.kind === "added") {
      return theme.bg("toolSuccessBg", fitToWidth(content, safeWidth, { pad: true }));
    }
    if (line.kind === "removed") {
      return theme.bg("toolErrorBg", fitToWidth(content, safeWidth, { pad: true }));
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
  details: EditToolDetails | undefined,
  options: { expanded: boolean; isPartial: boolean },
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
  if (!details?.diff) {
    return [fitToWidth(theme.fg("success", "  └ Applied"), width)];
  }

  const parsed = parseDisplayDiff(details.diff);
  const maximum = options.expanded ? parsed.length : COLLAPSED_DIFF_LINES;
  const visible = parsed.slice(0, maximum);
  const lines = renderDisplayDiff(visible, theme, width);
  const remaining = parsed.length - visible.length;
  if (remaining > 0) {
    lines.push(fitToWidth(theme.fg("dim", `… ${remaining} more diff lines`), width));
  }
  return lines;
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
