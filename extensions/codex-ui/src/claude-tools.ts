import { basename, dirname } from "node:path";
import {
  getLanguageFromPath,
  highlightCode,
  keyText,
  type ExtensionAPI,
  type KeybindingsManager,
  type Theme,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";

import type { BashGroup, BashMember } from "./bash-groups.js";
import {
  fitToWidth,
  normalizeOutputPad,
  normalizeWidth,
  padOutputLines,
  paintBackground,
  paintFittedBackground,
  paintForeground,
  resolveOutputPad,
} from "./layout.js";
import type { ReadMember, ReadRow } from "./read-groups.js";
import { ResponsiveLinesComponent } from "./responsive-lines.js";
import { fileFailureStatus, toolStatusColor, type ToolStatus } from "./tool-status.js";
import type { DisplayDiffLine } from "./tools.js";
import { CLAUDE_RGB, fgRgb, isClaudeTheme } from "./claude-palette.js";

const EXPANDED_READ_LINES = 45;
const BASH_HEAD = 2;
const BASH_TAIL = 2;
const CONNECTOR = "  ⎿  ";
const CONT_INDENT = "     ";
const ANSI_DEFAULT_FOREGROUND = "\x1b[39m";
const ANSI_DIM = "\x1b[2m";
const ANSI_INTENSITY_RESET = "\x1b[22m";
const EXIT_CODE_RE = /^Command exited with code (-?[1-9]\d*)$/u;
const TIMEOUT_RE = /^Command timed out after \d+(?:\.\d+)? seconds$/u;

function clean(text: string): string {
  return stripTerminalSequences(text)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff\u202a-\u202e\u2066-\u2069\ufff9-\ufffb]/gu, "")
    .replace(/\t/gu, "  ");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function claudeDot(theme: Theme, status: ToolStatus): string {
  if (status === "pending" || status === "running") {
    return fgRgb(CLAUDE_RGB.terracotta, "●", theme, "accent");
  }
  if (status === "completed") {
    return theme.fg("success", "●");
  }
  return theme.fg(toolStatusColor(status), "●");
}

export function claudeCallHeading(
  theme: Theme,
  status: ToolStatus,
  toolLabel: string,
  argText: string,
  width: number,
  suffix = "",
): string {
  const dot = claudeDot(theme, status);
  const name = theme.bold(fgRgb(CLAUDE_RGB.brightWhite, toolLabel, theme, "text"));
  const prefix = `${dot} ${name}${theme.fg("dim", "(")}`;
  const close = `${theme.fg("dim", ")")}${suffix}`;
  const room = Math.max(4, width - visibleWidth(prefix) - visibleWidth(close));
  return fitToWidth(
    `${prefix}${theme.fg("text", fitToWidth(argText, room, { ellipsis: "…" }))}${close}`,
    width,
    { ellipsis: "…" },
  );
}

// ============================================================================
// Claude Code Read(path) / Read N files
// ============================================================================

function readSourceLines(member: ReadRow): { lines: string[]; notice: string; lineCount: number } {
  const text = (member.content ?? []).filter(b => b.type === "text").map(b => b.text ?? "").join("\n");
  if (member.status === "failed") {
    return { lines: text ? text.split("\n") : [], notice: "", lineCount: 0 };
  }
  let body = text;
  let notice = "";
  let explicitCount: number | undefined;
  const truncation = member.details?.truncation;
  if (truncation?.truncated) {
    if (truncation.firstLineExceedsLimit) {
      return { lines: [], notice: text, lineCount: 0 };
    }
    if (typeof truncation.content === "string" && text.startsWith(`${truncation.content}\n\n[Showing lines `)) {
      body = truncation.content;
      notice = text.slice(truncation.content.length + 2);
      explicitCount = truncation.outputLines;
    }
  } else {
    const footer = text.lastIndexOf("\n\n[");
    if (member.limit !== undefined && footer >= 0) {
      const candidate = text.slice(footer + 2);
      const match = candidate.match(/^\[\d+ more lines in file\. Use offset=(\d+) to continue\.\]$/u);
      if (match && Number(match[1]) === (member.offset ?? 1) + member.limit) {
        body = text.slice(0, footer);
        notice = candidate;
        explicitCount = member.limit;
      }
    }
  }
  const lines = body ? body.split("\n") : [];
  if (lines.at(-1) === "") lines.pop();
  return { lines, notice, lineCount: explicitCount ?? lines.length };
}

function readImageWarning(member: ReadRow): string {
  const raw = typeof member.details?.imageUnsupportedByModel === "string"
    ? clean(member.details.imageUnsupportedByModel).replace(/\n/gu, " ").trim()
    : "";
  return raw ? `[${raw} does not support images; it saw a placeholder instead]` : "";
}

export function renderClaudeReadGroup(
  member: ReadMember,
  expanded: boolean,
  theme: Theme,
  availableWidth: number,
  expandKeys = "ctrl+o",
): string[] {
  const safeWidth = normalizeWidth(availableWidth);
  if (!safeWidth || member.group.members[0] !== member) return [];
  const members = member.group.members;
  const hint = expandKeys ? theme.fg("dim", ` (${expandKeys} to expand)`) : "";

  if (members.length === 1) {
    const row = members[0]!;
    const path = clean(row.path).replace(/\n/gu, " ");
    const pending = row.status === "pending" || row.status === "running";
    const failed = row.status === "failed";
    const status: ToolStatus = failed ? fileFailureStatus(row.content) : row.status;
    const image = row.content?.some(b => b.type === "image");
    const { lines, notice, lineCount } = pending ? { lines: [], notice: "", lineCount: 0 } : readSourceLines(row);
    const out: string[] = [claudeCallHeading(theme, status, "Read", path || "(unknown)", safeWidth)];

    if (pending) {
      out.push(fitToWidth(`${theme.fg("dim", CONNECTOR)}${theme.fg("dim", "Reading…")}`, safeWidth));
      return out;
    }
    if (failed) {
      const err = clean(lines[0] ?? "Read failed");
      out.push(fitToWidth(`${theme.fg("dim", CONNECTOR)}${theme.fg(toolStatusColor(status), err)}`, safeWidth, { ellipsis: "…" }));
      return out;
    }
    let summary = image ? "Image loaded" : `Read ${plural(lineCount, "line", "lines")}`;
    if (!image && lineCount > 0 && (row.offset !== undefined || row.limit !== undefined)) {
      summary = `L${row.offset ?? 1}–${(row.offset ?? 1) + lineCount - 1} · ${summary}`;
    }
    if (row.details?.truncation?.truncated) summary += " · truncated";
    out.push(fitToWidth(`${theme.fg("dim", CONNECTOR)}${theme.fg("muted", summary)}${expanded || image ? "" : hint}`, safeWidth));

    if (expanded && lines.length > 0) {
      const shown = lines.slice(0, EXPANDED_READ_LINES);
      const numW = String((row.offset ?? 1) + shown.length - 1).length;
      const language = getLanguageFromPath(path);
      shown.forEach((line, idx) => {
        const num = String((row.offset ?? 1) + idx).padStart(numW);
        const sanitized = clean(line);
        const code = language ? (highlightCode(sanitized.slice(0, 1024), language)[0] ?? sanitized) : sanitized;
        out.push(fitToWidth(`${CONT_INDENT}${theme.fg("dim", `${num}  `)}${paintForeground(code, theme.getFgAnsi("toolDiffContext"))}`, safeWidth, { ellipsis: "…" }));
      });
      if (lineCount > shown.length) {
        out.push(fitToWidth(`${CONT_INDENT}${theme.fg("dim", `… +${lineCount - shown.length} lines`)}`, safeWidth));
      }
    }
    if (notice && (expanded || row.details?.truncation?.firstLineExceedsLimit)) {
      const contentWidth = Math.max(1, safeWidth - CONT_INDENT.length);
      for (const wrapped of wrapTextWithAnsi(clean(notice), contentWidth)) {
        out.push(fitToWidth(`${CONT_INDENT}${theme.fg("dim", wrapped)}`, safeWidth, { ellipsis: "…" }));
      }
    }
    const imageWarning = readImageWarning(row);
    if (imageWarning) {
      const contentWidth = Math.max(1, safeWidth - CONT_INDENT.length);
      for (const wrapped of wrapTextWithAnsi(imageWarning, contentWidth)) {
        out.push(fitToWidth(`${CONT_INDENT}${theme.fg("warning", wrapped)}`, safeWidth));
      }
    }
    return out;
  }

  const anyRunning = members.some(m => m.status === "pending" || m.status === "running");
  const anyFailed = members.some(m => m.status === "failed");
  const groupStatus: ToolStatus = anyRunning ? "running" : anyFailed ? "failed" : "completed";
  const verb = anyRunning ? "Reading" : "Read";
  const heading = fitToWidth(
    `${claudeDot(theme, groupStatus)} ${theme.bold(fgRgb(CLAUDE_RGB.brightWhite, `${verb} ${plural(members.length, "file", "files")}`, theme, "text"))}${expanded || anyRunning ? "" : hint}`,
    safeWidth,
  );
  const out = [heading];

  members.forEach((row, index) => {
    const path = clean(row.path).replace(/\n/gu, " ");
    const dir = dirname(path) === "." ? "" : `${dirname(path)}/`;
    const file = basename(path) || "(unknown)";
    const pending = row.status === "pending" || row.status === "running";
    const failed = row.status === "failed";
    const status: ToolStatus = failed ? fileFailureStatus(row.content) : row.status;
    const image = row.content?.some(b => b.type === "image");
    const { lines, notice, lineCount } = pending ? { lines: [], notice: "", lineCount: 0 } : readSourceLines(row);
    const lead = index === 0 ? CONNECTOR : CONT_INDENT;
    const meta = pending
      ? theme.fg("dim", " · reading…")
      : failed
        ? theme.fg(toolStatusColor(status), " · failed")
        : image
          ? theme.fg("dim", " · image loaded")
          : theme.fg("dim", ` · ${plural(lineCount, "line", "lines")}`);
    out.push(fitToWidth(`${theme.fg("dim", lead)}${theme.fg("dim", dir)}${theme.fg("text", file)}${meta}`, safeWidth, { ellipsis: "…" }));

    if (failed) {
      const err = clean(lines[0] ?? "Read failed");
      out.push(fitToWidth(`${CONT_INDENT}  ${theme.fg(toolStatusColor(status), err)}`, safeWidth, { ellipsis: "…" }));
    } else if (expanded && !pending && lines.length > 0) {
      const shown = lines.slice(0, 12);
      const numW = String((row.offset ?? 1) + shown.length - 1).length;
      shown.forEach((line, i) => {
        const num = String((row.offset ?? 1) + i).padStart(numW);
        out.push(fitToWidth(`${CONT_INDENT}  ${theme.fg("dim", `${num}  `)}${theme.fg("toolOutput", clean(line))}`, safeWidth, { ellipsis: "…" }));
      });
      if (lineCount > shown.length) {
        out.push(fitToWidth(`${CONT_INDENT}  ${theme.fg("dim", `… +${lineCount - shown.length} lines`)}`, safeWidth));
      }
    }
    if (!pending && !failed && notice && (expanded || row.details?.truncation?.firstLineExceedsLimit)) {
      const contentWidth = Math.max(1, safeWidth - CONT_INDENT.length - 2);
      for (const wrapped of wrapTextWithAnsi(clean(notice), contentWidth)) {
        out.push(fitToWidth(`${CONT_INDENT}  ${theme.fg("dim", wrapped)}`, safeWidth, { ellipsis: "…" }));
      }
    }
    const imageWarning = !pending && !failed ? readImageWarning(row) : "";
    if (imageWarning) {
      const contentWidth = Math.max(1, safeWidth - CONT_INDENT.length - 2);
      for (const wrapped of wrapTextWithAnsi(imageWarning, contentWidth)) {
        out.push(fitToWidth(`${CONT_INDENT}  ${theme.fg("warning", wrapped)}`, safeWidth));
      }
    }
  });

  return out;
}

// ============================================================================
// Claude Code Bash(command)
// ============================================================================

function trimBlankEdges(lines: readonly string[]): readonly string[] {
  let first = 0;
  let last = lines.length;
  while (first < last && !lines[first]!.trim()) first++;
  while (last > first && !lines[last - 1]!.trim()) last--;
  return lines.slice(first, last);
}

function collapseBlankRuns(lines: readonly string[]): string[] {
  return lines.filter((line, index) => line.trim() || lines[index - 1]?.trim());
}

function dedent(lines: readonly string[]): string[] {
  let shared = Infinity;
  for (const line of lines) if (line.trim()) shared = Math.min(shared, line.length - line.trimStart().length);
  return shared > 0 && Number.isFinite(shared) ? lines.map(line => line.slice(shared)) : [...lines];
}

function analyzeClaudeBash(member: BashMember): {
  body: string[];
  errorLine?: { text: string; color: "error" | "warning" };
  warning?: string;
} {
  const raw = (member.content ?? []).filter(b => b.type === "text").map(b => clean(b.text ?? "")).join("\n");
  const lines = raw ? raw.split("\n") : [];
  let bodyEnd = lines.length;
  let errorLine: { text: string; color: "error" | "warning" } | undefined;

  if (member.status === "failed" && lines.length > 0) {
    const last = lines.at(-1) ?? "";
    const hasBlankBefore = lines.length === 1 || lines.at(-2) === "";
    if (hasBlankBefore) {
      const exit = EXIT_CODE_RE.exec(last);
      if (exit) {
        errorLine = { text: `Error: Exit code ${exit[1]}`, color: "error" };
        bodyEnd = Math.max(0, lines.length - 2);
      } else if (last === "Command aborted") {
        errorLine = { text: "Interrupted", color: "warning" };
        bodyEnd = Math.max(0, lines.length - 2);
      } else if (TIMEOUT_RE.test(last)) {
        errorLine = { text: `Error: ${last}`, color: "warning" };
        bodyEnd = Math.max(0, lines.length - 2);
      }
    }
    errorLine ??= { text: "Error: Command failed", color: "error" };
  }

  let warning: string | undefined;
  const details = member.details as { fullOutputPath?: string; fullOutputError?: string; truncation?: { truncated?: boolean } } | undefined;
  if (typeof details?.fullOutputPath === "string" && details.fullOutputPath.trim()) {
    warning = `Truncated capture · ${clean(details.fullOutputPath).trim()}`;
  } else if (typeof details?.fullOutputError === "string" && details.fullOutputError.trim()) {
    warning = `Truncated capture · Could not save the full output: ${clean(details.fullOutputError).trim()}`;
  } else if (details?.truncation?.truncated) {
    warning = "Truncated capture · full output unavailable";
  }

  const sliced = lines.slice(0, bodyEnd);
  if (warning && sliced.length > 0 && sliced.at(-1)?.startsWith("[Showing ")) {
    sliced.pop();
  }
  const emptySentinel = !errorLine && member.status === "completed" && sliced.length === 1 && sliced[0] === "(no output)";
  const body = emptySentinel ? [] : dedent(collapseBlankRuns(trimBlankEdges(sliced)));
  return { body, errorLine, warning };
}

export function renderClaudeBashGroup(
  group: BashGroup,
  expanded: boolean,
  theme: Theme,
  availableWidth: number,
  expandKeys: string,
): string[] {
  const safeWidth = normalizeWidth(availableWidth);
  if (!safeWidth) return [];
  const out: string[] = [];

  for (const member of group.members) {
    if (member.status === "pending") continue;
    if (out.length) out.push("");

    const { body, errorLine, warning } = analyzeClaudeBash(member);
    const status: ToolStatus = errorLine?.color === "warning" ? "interrupted" : member.status;
    const cmd = clean(member.command || "…").replace(/\n/gu, " ");
    out.push(claudeCallHeading(theme, status, "Bash", cmd, safeWidth));

    const contentWidth = Math.max(1, safeWidth - CONT_INDENT.length);
    const visual = body.flatMap(l => wrapTextWithAnsi(l, contentWidth));
    let rows: Array<{ text: string; color: "toolOutput" | "dim" | "error" | "warning" }>;

    if (!visual.length) {
      rows = [{ text: member.status === "running" ? "Running…" : "(No output)", color: "dim" }];
    } else if (expanded || visual.length <= BASH_HEAD + BASH_TAIL + 1) {
      rows = visual.map(text => ({ text, color: "toolOutput" }));
    } else {
      const head = visual.slice(0, BASH_HEAD);
      const tail = visual.slice(-BASH_TAIL);
      const hidden = visual.length - head.length - tail.length;
      rows = [
        ...head.map(text => ({ text, color: "toolOutput" as const })),
        { text: `… +${hidden} lines${expandKeys ? ` (${expandKeys} to expand)` : ""}`, color: "dim" },
        ...tail.map(text => ({ text, color: "toolOutput" as const })),
      ];
    }

    if (errorLine) rows.push({ text: errorLine.text, color: errorLine.color });

    rows.forEach((row, idx) => {
      const lead = idx === 0 ? CONNECTOR : CONT_INDENT;
      out.push(fitToWidth(`${theme.fg("dim", lead)}${theme.fg(row.color, row.text)}`, safeWidth, { ellipsis: "…" }));
    });
    if (warning) {
      for (const wrapped of wrapTextWithAnsi(warning, contentWidth)) {
        out.push(fitToWidth(`${CONT_INDENT}${theme.fg("warning", wrapped)}`, safeWidth));
      }
    }
  }
  return out;
}

// ============================================================================
// Claude Code Update(path) / Write(path) Diff Rendering
// ============================================================================

export function renderClaudeMutationSummary(
  tool: "edit" | "write",
  path: string,
  stats: { added: number; removed: number },
  pureAddition: boolean,
  theme: Theme,
  width: number,
): string {
  let summary: string;
  if (tool === "write" && pureAddition) {
    summary = `Wrote ${theme.bold(theme.fg("text", String(stats.added)))} ${stats.added === 1 ? "line" : "lines"} to ${theme.fg("text", path)}`;
  } else {
    const parts: string[] = [];
    if (stats.added > 0) parts.push(`Added ${theme.bold(theme.fg("text", String(stats.added)))} ${stats.added === 1 ? "line" : "lines"}`);
    if (stats.removed > 0) parts.push(`removed ${theme.bold(theme.fg("text", String(stats.removed)))} ${stats.removed === 1 ? "line" : "lines"}`);
    summary = parts.length ? parts.join(", ") : "Updated file";
  }
  return fitToWidth(`${theme.fg("dim", CONNECTOR)}${theme.fg("muted", summary)}`, width, { ellipsis: "…" });
}

export function renderClaudeDiff(
  lines: readonly DisplayDiffLine[],
  theme: Theme,
  width: number,
  path: string,
  lineNumberWidth: number,
  pureWriteStyle: boolean,
  highlightedLines?: readonly string[],
): string[] {
  const safeWidth = normalizeWidth(width);
  if (!safeWidth) return [];
  const language = getLanguageFromPath(path);
  const codeFg = theme.getFgAnsi("toolDiffContext");

  return lines.map((line, index) => {
    if (line.kind === "hunk") {
      return fitToWidth(`${CONT_INDENT}${theme.fg("dim", "⋮")}`, safeWidth);
    }
    const num = line.lineNumber === undefined ? " ".repeat(lineNumberWidth) : String(line.lineNumber).padStart(lineNumberWidth);
    const gutter = `${ANSI_DIM}${ANSI_DEFAULT_FOREGROUND}${num}${ANSI_INTENSITY_RESET}`;
    const highlighted = highlightedLines?.[index] ?? line.highlightedText ?? (language
      ? (highlightCode(line.text.slice(0, 2048), language)[0] ?? line.text)
      : line.text);
    const coloredCode = paintForeground(highlighted, codeFg);

    if (pureWriteStyle) {
      return fitToWidth(`${CONT_INDENT}${gutter}  ${coloredCode}`, safeWidth, { ellipsis: "…" });
    }

    const sign = line.kind === "added"
      ? theme.fg("success", "+")
      : line.kind === "removed"
        ? theme.fg("error", "-")
        : " ";
    const body = line.kind === "removed" ? `${ANSI_DIM}${coloredCode}${ANSI_INTENSITY_RESET}` : coloredCode;
    const needsBg = line.kind === "added" || line.kind === "removed";
    const row = fitToWidth(`${CONT_INDENT}${gutter} ${sign}  ${body}`, safeWidth, {
      ellipsis: "…",
      pad: needsBg,
    });
    if (line.kind === "added") return paintFittedBackground(row, theme.getBgAnsi("toolSuccessBg"));
    if (line.kind === "removed") return paintFittedBackground(row, theme.getBgAnsi("toolErrorBg"), ANSI_DIM);
    return row;
  });
}

export function renderClaudeConnectorLine(
  text: string,
  color: "accent" | "muted" | "dim" | "error" | "warning" | "success",
  theme: Theme,
  width: number,
): string {
  return fitToWidth(`${theme.fg("dim", CONNECTOR)}${theme.fg(color, text)}`, width, { ellipsis: "…" });
}

export function renderClaudeDiffTruncation(remaining: number, theme: Theme, width: number, expandKeys: string): string {
  return fitToWidth(`${CONT_INDENT}${theme.fg("dim", `… +${remaining} lines${expandKeys ? ` (${expandKeys} to expand)` : ""}`)}`, width);
}

// ============================================================================
// Claude Code generic tool renderer for grep / find / ls via registerToolRenderer
// ============================================================================

function formatGenericArgs(toolName: string, args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  if (toolName === "grep") {
    const p = typeof args.pattern === "string" ? args.pattern : "";
    const path = typeof args.path === "string" ? `, path: "${args.path}"` : "";
    return `pattern: "${p}"${path}`;
  }
  if (toolName === "find") {
    return typeof args.pattern === "string" ? `pattern: "${args.pattern}"` : "";
  }
  if (toolName === "ls") {
    return typeof args.path === "string" ? args.path : ".";
  }
  return "";
}

function mapToolDisplayName(toolName: string): string {
  if (toolName === "grep") return "Search";
  if (toolName === "find") return "Glob";
  if (toolName === "ls") return "List";
  return toolName;
}

function resolveExpandKeys(getKeybindings: () => Pick<KeybindingsManager, "getKeys"> | undefined, context: object): string {
  const hints = context as { keyText?: typeof keyText };
  if (hints.keyText) return hints.keyText("app.tools.expand");
  const bindings = getKeybindings();
  if (!bindings) return keyText("app.tools.expand");
  return bindings.getKeys("app.tools.expand")
    .map(key => String(key).split("+").map(part => process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part).join("+"))
    .join("/");
}

const EMPTY_TOOL_MESSAGES: Record<"grep" | "find" | "ls", ReadonlySet<string>> = {
  grep: new Set(["No matches found"]),
  find: new Set(["No files found matching pattern"]),
  ls: new Set(["(empty directory)"]),
};

// Pi's grep formats match lines as `<path>:<line>: <text>` and context lines as `<path>-<line>- <text>`.
// Requiring the trailing space (or end-of-line on empty trimmed lines) prevents date filenames like
// `2026-11-28.log:7: hit` from matching `-11-`, while still taking the earliest valid separator so
// colons inside context text like `f-1- 12:30:45` do not override `-1- `.
const GREP_FIRST_SEPARATOR = /^.+?(:\d+:(?: |$)|-\d+-(?: |$))/u;

function hasTruncationMetadata(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  const d = details as {
    matchLimitReached?: number;
    resultLimitReached?: number;
    entryLimitReached?: number;
    linesTruncated?: boolean;
    truncation?: { truncated?: boolean };
  };
  return Boolean(
    d.truncation?.truncated
    || d.matchLimitReached !== undefined
    || d.resultLimitReached !== undefined
    || d.entryLimitReached !== undefined
    || d.linesTruncated,
  );
}

function splitGenericOutput(rawText: string, details: unknown): { bodyLines: string[]; notices: string[] } {
  const trimmed = rawText.trim();
  if (!trimmed) return { bodyLines: [], notices: [] };
  const all = trimmed.split("\n");
  if (!hasTruncationMetadata(details)) {
    return { bodyLines: all, notices: [] };
  }
  // Pi appends truncation notices after a blank separator line (`\n\n[...]`), never as an unseparated filename.
  const sepIndex = all.lastIndexOf("");
  if (sepIndex > 0) {
    const tail = all.slice(sepIndex + 1).map(l => l.trim()).filter(Boolean);
    if (tail.length > 0 && tail.every(l => l.startsWith("[") && l.endsWith("]"))) {
      return { bodyLines: all.slice(0, sepIndex), notices: tail };
    }
  }
  return { bodyLines: all, notices: [] };
}

function summarizeGenericOutput(
  toolName: "grep" | "find" | "ls",
  bodyLines: readonly string[],
): { summary: string; expandable: boolean } {
  if (bodyLines.length === 0) {
    const fallback = toolName === "grep" ? "No matches found" : toolName === "find" ? "No files found matching pattern" : "(empty directory)";
    return { summary: fallback, expandable: false };
  }
  if (bodyLines.length === 1 && EMPTY_TOOL_MESSAGES[toolName].has(bodyLines[0]!.trim())) {
    return { summary: bodyLines[0]!.trim(), expandable: false };
  }
  if (toolName === "grep") {
    let matches = 0;
    let contexts = 0;
    let unknown = 0;
    for (const line of bodyLines) {
      if (line === "--") continue;
      const firstSep = GREP_FIRST_SEPARATOR.exec(line)?.[1];
      if (firstSep?.startsWith(":")) matches++;
      else if (firstSep?.startsWith("-")) contexts++;
      else unknown++;
    }
    if (unknown === 0 && (matches > 0 || contexts > 0)) {
      return { summary: `Found ${plural(matches, "match", "matches")}`, expandable: true };
    }
    return { summary: `Found ${plural(bodyLines.length, "line", "lines")}`, expandable: true };
  }
  if (toolName === "find") {
    return { summary: `Found ${plural(bodyLines.length, "file", "files")}`, expandable: true };
  }
  return { summary: plural(bodyLines.length, "entry", "entries"), expandable: true };
}

function formatGenericTruncationDetails(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const d = details as {
    matchLimitReached?: number;
    resultLimitReached?: number;
    entryLimitReached?: number;
    linesTruncated?: boolean;
    truncation?: { truncated?: boolean; maxBytes?: number };
  };
  const warnings: string[] = [];
  if (typeof d.matchLimitReached === "number") warnings.push(`${d.matchLimitReached} matches limit`);
  if (typeof d.resultLimitReached === "number") warnings.push(`${d.resultLimitReached} results limit`);
  if (typeof d.entryLimitReached === "number") warnings.push(`${d.entryLimitReached} entries limit`);
  if (d.truncation?.truncated) {
    const kb = Math.round(((d.truncation.maxBytes ?? 51200) / 1024) * 10) / 10;
    warnings.push(`${kb}KB limit`);
  }
  if (d.linesTruncated) warnings.push("some lines truncated");
  return warnings.length ? `[Truncated: ${warnings.join(", ")}]` : undefined;
}

/** Style grep/find/ls dynamically based on the active theme so mounted cards switch cleanly both ways. */
export function registerClaudeGenericToolRenderer(
  pi: ExtensionAPI,
  getKeybindings: () => Pick<KeybindingsManager, "getKeys"> | undefined,
): void {
  if (typeof pi.registerToolRenderer !== "function") return;
  pi.registerToolRenderer((toolName, next): ToolRenderers | undefined => {
    if (toolName !== "grep" && toolName !== "find" && toolName !== "ls") {
      return next();
    }
    const fallback = next();
    const label = mapToolDisplayName(toolName);
    const compOf = (prev: Component | undefined) => prev instanceof ResponsiveLinesComponent ? prev : new ResponsiveLinesComponent();

    interface GenericRendererState {
      status?: ToolStatus;
      hasResult?: boolean;
      resultIsPartial?: boolean;
      resultIsError?: boolean;
      claudeCall?: ResponsiveLinesComponent;
      fallbackCall?: Component;
      fallbackResult?: Component;
    }

    const nativeBgAnsi = (state: GenericRendererState, theme: Theme): string => {
      if (!state.hasResult || state.resultIsPartial) return theme.getBgAnsi("toolPendingBg");
      return theme.getBgAnsi(state.resultIsError ? "toolErrorBg" : "toolSuccessBg");
    };

    const paintNativeRows = (
      lines: readonly string[],
      width: number,
      padX: number,
      bgAnsi: string,
      topPad: boolean,
      bottomPad: boolean,
    ): string[] => {
      const out: string[] = [];
      if (topPad) out.push(paintBackground("", width, bgAnsi));
      const left = " ".repeat(padX);
      for (const line of lines) {
        out.push(paintBackground(`${left}${line}`, width, bgAnsi));
      }
      if (bottomPad) out.push(paintBackground("", width, bgAnsi));
      return out;
    };

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        const state = context.state as GenericRendererState;
        const outputPad = normalizeOutputPad(context.outputPad);
        const comp = compOf(context.lastComponent ?? state.claudeCall);
        state.claudeCall = comp;
        if (!isClaudeTheme(theme)) {
          const delegated = fallback?.renderCall?.(args, theme, { ...context, lastComponent: state.fallbackCall });
          state.fallbackCall = delegated;
          const nativePad = context.outputPad ?? 1;
          comp.setRenderer((width) => {
            const boxPadX = resolveOutputPad(width, nativePad);
            const inner = Math.max(1, width - boxPadX * 2);
            const rendered = delegated
              ? delegated.render(inner)
              : [fitToWidth(`${theme.fg("toolTitle", theme.bold(toolName))} ${formatGenericArgs(toolName, args as Record<string, unknown>)}`, inner)];
            return paintNativeRows(rendered, width, boxPadX, nativeBgAnsi(state, theme), true, !state.hasResult);
          }, { linesAlreadyFit: true });
          return comp;
        }
        const argText = formatGenericArgs(toolName, args as Record<string, unknown>);
        comp.setRenderer((width) => {
          const pad = resolveOutputPad(width, outputPad);
          const status: ToolStatus = state.status ?? (context.executionStarted ? "running" : "pending");
          return padOutputLines([claudeCallHeading(theme, status, label, argText, width - pad * 2)], width, pad);
        }, { linesAlreadyFit: true });
        return comp;
      },
      renderResult(result, options, theme, context) {
        const state = context.state as GenericRendererState;
        const outputPad = normalizeOutputPad(context.outputPad);
        const comp = compOf(context.lastComponent);
        state.hasResult = true;
        state.resultIsPartial = options.isPartial;
        state.resultIsError = context.isError;
        state.status = options.isPartial ? "running" : (context.isError ? "failed" : "completed");
        state.claudeCall?.invalidate();

        if (!isClaudeTheme(theme)) {
          const delegated = fallback?.renderResult?.(result, options, theme, { ...context, lastComponent: state.fallbackResult });
          state.fallbackResult = delegated;
          const nativePad = context.outputPad ?? 1;
          comp.setRenderer((width) => {
            const boxPadX = resolveOutputPad(width, nativePad);
            const inner = Math.max(1, width - boxPadX * 2);
            const rendered = delegated ? delegated.render(inner) : [];
            return paintNativeRows(rendered, width, boxPadX, nativeBgAnsi(state, theme), false, true);
          }, { linesAlreadyFit: true });
          return comp;
        }
        if (options.isPartial) {
          comp.setRenderer(() => [], { linesAlreadyFit: true });
          return comp;
        }
        const rawText = result.content.filter(b => b.type === "text").map(b => clean(b.text ?? "")).join("\n");
        const { bodyLines, notices } = splitGenericOutput(rawText, result.details);
        const detailWarning = formatGenericTruncationDetails(result.details);
        const expandKeys = resolveExpandKeys(getKeybindings, context);
        comp.setRenderer((width) => {
          const pad = resolveOutputPad(width, outputPad);
          const inner = width - pad * 2;
          if (context.isError) {
            return padOutputLines([renderClaudeConnectorLine(bodyLines[0] ?? notices[0] ?? "Failed", "error", theme, inner)], width, pad);
          }
          const { summary, expandable } = summarizeGenericOutput(toolName, bodyLines);
          const hint = options.expanded || !expandable ? "" : theme.fg("dim", ` (${expandKeys} to expand)`);
          const out = [fitToWidth(`${theme.fg("dim", CONNECTOR)}${theme.fg("muted", summary)}${hint}`, inner)];
          if (options.expanded && expandable) {
            for (const line of bodyLines) {
              out.push(fitToWidth(`${CONT_INDENT}${theme.fg("toolOutput", line)}`, inner, { ellipsis: "…" }));
            }
          }
          const allNotices = notices.length > 0 ? notices : (detailWarning ? [detailWarning] : []);
          for (const notice of allNotices) {
            out.push(fitToWidth(`${CONT_INDENT}${theme.fg("warning", notice)}`, inner, { ellipsis: "…" }));
          }
          return padOutputLines(out, width, pad);
        }, { linesAlreadyFit: true });
        return comp;
      },
    };
  });
}
