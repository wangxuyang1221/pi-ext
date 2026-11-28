import { basename, dirname } from "node:path";
import { getLanguageFromPath, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { renderBashGroup } from "./bash-group-layout.js";
import { fitToWidth, normalizeWidth, paintFittedBackground, paintForeground } from "../../../shared/ui/layout.js";
import { toolStatusMarker, type ToolFailureStatus } from "../../../shared/ui/tool-status.js";
import {
  registerTools,
  type ToolLayout,
  type ToolFactories,
  type ToolRenderServices,
  type DisplayDiffLine,
  getDisplayLineNumberWidth,
  highlightDiffLine,
} from "../../../shared/ui/native-tools.js";
import { renderReadGroup } from "./read-group-layout.js";

export {
  parseDisplayDiff,
  parseUnifiedPatch,
  getDisplayLineNumberWidth,
  type DisplayDiffLine,
  type ToolFactories as CodexToolFactories,
  type ToolRenderServices as CodexToolRenderServices,
} from "../../../shared/ui/native-tools.js";

const COLLAPSED_DIFF_LINES = 12;
const DIFF_INDENT = "    ";
const ANSI_DEFAULT_FOREGROUND = "\x1b[39m";
const ANSI_DIM = "\x1b[2m";
const ANSI_INTENSITY_RESET = "\x1b[22m";
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

function renderDiffTruncationFooter(remaining: number, theme: Theme, width: number, expandKeys: string): string {
  return fitToWidth(theme.fg("dim", `${DIFF_INDENT}… +${remaining} lines${expandKeys ? ` (${expandKeys} to expand)` : ""}`), width);
}

function formatDiffStats(stats: { added: number; removed: number }, theme: Theme): string {
  const parts = [stats.added ? theme.fg("success", `+${stats.added}`) : "", stats.removed ? theme.fg("error", `-${stats.removed}`) : ""].filter(Boolean);
  return parts.length ? `${theme.fg("dim", "(")}${parts.join(" ")}${theme.fg("dim", ")")}` : "";
}

function formatLineCount(count: number): string {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

export const codexTools: ToolLayout = {
  read: renderReadGroup,
  bash: renderBashGroup,
  editHeading(state, path, theme, width, started) {
    return state.settledTitle === undefined
      ? formatPendingMutationTitle("Editing", path, theme, width, started)
      : fitToWidth(state.settledTitle, width);
  },
  writeHeading(state, path, theme, width, started) {
    if (!state.status || state.status === "pending") return formatPendingMutationTitle("Writing", path, theme, width, started);
    if (state.status === "error") return fitToWidth(formatMutationFailureTitle("Write failed", path, theme, state.failureStatus), width);
    const suffix = state.metrics ? theme.fg("dim", `(${formatLineCount(state.metrics.lineCount)})`) : "";
    return fitToWidth(state.settledTitle ?? formatEditTitle("Write", path, theme, suffix), width);
  },
  failureTitle: formatMutationFailureTitle,
  successTitle(action, path, theme, stats) {
    return formatEditTitle(action, path, theme, stats ? formatDiffStats(stats, theme) : "");
  },
  notice: (text, color, theme, width) => fitToWidth(theme.fg(color, `  ${text}`), width),
  applied: (theme, width) => fitToWidth(theme.fg("success", "  └ Applied"), width),
  collapsedLines: () => COLLAPSED_DIFF_LINES,
  diff({ visible, theme, width, path, highlighted, remaining, expandKeys }) {
    const lines = renderDisplayDiff(visible, theme, width, path, highlighted);
    if (remaining > 0) lines.push(renderDiffTruncationFooter(remaining, theme, width, expandKeys));
    return lines;
  },
};

export function registerCodexTools(pi: ExtensionAPI, factories?: ToolFactories, services?: ToolRenderServices) {
  return registerTools(codexTools, pi, factories, services);
}
