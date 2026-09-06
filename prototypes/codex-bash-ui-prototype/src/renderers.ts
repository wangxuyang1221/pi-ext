import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { fitToWidth, normalizeWidth } from "../../../extensions/codex-ui/src/layout.js";
import type { BashFixture, Status } from "./fixtures.js";

export function clean(text: string): string {
  return stripTerminalSequences(text)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/\t/gu, "  ");
}

function statusMark(status: Status, theme: Theme): string {
  if (status === "completed") return theme.fg("success", "✓");
  if (status === "failed") return theme.fg("error", "×");
  if (status === "timeout") return theme.fg("warning", "!");
  if (status === "cancelled") return theme.fg("warning", "■");
  if (status === "running") return theme.fg("accent", "◌");
  return theme.fg("dim", "○");
}

function duration(row: BashFixture): string {
  if (row.status === "pending") return "queued";
  const seconds = `${(row.durationMs / 1000).toFixed(1)}s`;
  if (row.status === "running") return `${seconds} running`;
  if (row.status === "failed") return `${seconds} exit ${row.exitCode ?? "?"}`;
  if (row.status === "timeout" || row.status === "cancelled") return `${seconds} ${row.status}`;
  return seconds;
}

function isFailure(row: BashFixture): boolean {
  return row.status === "failed" || row.status === "timeout" || row.status === "cancelled";
}

function withMetadata(left: string, right: string, width: number): string {
  if (visibleWidth(left) + visibleWidth(right) + 3 > width) return fitToWidth(left, width, { ellipsis: "…" });
  return `${left}${" ".repeat(width - visibleWidth(left) - visibleWidth(right))}${right}`;
}

function outputPrefix(last: boolean, width: number): string {
  return width >= 16 ? (last ? "        " : "  │     ") : "";
}

function commandLines(row: BashFixture, expanded: boolean, last: boolean, theme: Theme, width: number): string[] {
  const branch = width >= 16 ? (last ? "  ╰ " : "  ├ ") : "";
  const prefix = width >= 8 ? `${theme.fg("borderMuted", branch)}${statusMark(row.status, theme)} ${theme.fg("dim", "$ ")}` : "";
  const meta = theme.fg(isFailure(row) ? "warning" : "dim", duration(row));
  const reserve = width >= 64 ? visibleWidth(meta) + 3 : 0;
  const available = Math.max(1, width - visibleWidth(prefix) - reserve);
  const contentWidth = expanded ? available : Math.min(120, available);
  const command = clean(row.command);
  const lines = expanded ? wrapTextWithAnsi(command, contentWidth)
    : [fitToWidth(command.replace(/\n/gu, " "), contentWidth, { ellipsis: "..." })];
  return lines.map((line, index) => {
    const lead = index === 0 ? prefix : theme.fg("borderMuted", outputPrefix(last, width));
    const text = `${lead}${theme.fg("toolTitle", line)}`;
    return index === 0 && reserve ? withMetadata(text, meta, width) : fitToWidth(text, width);
  });
}

function outputLines(row: BashFixture, expanded: boolean, last: boolean, theme: Theme, width: number): string[] {
  const prefix = theme.fg("borderMuted", outputPrefix(last, width));
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  let lines: string[];
  if (expanded) {
    const empty = row.status === "pending" ? "Queued" : row.status === "running" ? "Waiting for output…" : "(no output)";
    // Preserve every captured line, including blank lines. Only the command blocks add spacing.
    lines = (row.output.length ? row.output : [empty])
      .flatMap(line => wrapTextWithAnsi(clean(line), contentWidth));
  } else {
    // Even errors and running output stay folded until the user expands results.
    lines = [];
  }
  const result = lines.map(line => fitToWidth(`${prefix}${theme.fg("toolOutput", line)}`, width));
  if (row.truncated) result.push(fitToWidth(`${prefix}${theme.fg("warning", "Truncated capture · full output unavailable")}`, width));
  return result;
}

export function renderGroup(rows: BashFixture[], expanded: boolean, theme: Theme, availableWidth: number, toggleHint: string): string[] {
  const width = normalizeWidth(availableWidth);
  if (!width) return [];
  const counts = [
    ["completed", "succeeded"], ["failed", "failed"], ["running", "running"],
    ["pending", "queued"], ["timeout", "timed out"], ["cancelled", "cancelled"],
  ].flatMap(([status, label]) => {
    const count = rows.filter(row => row.status === status).length;
    return count ? [`${count} ${label}`] : [];
  });
  // Read and Edited reserve two cells for their marker and following space.
  const title = `${width >= 8 ? "  " : ""}${theme.fg("toolTitle", theme.bold("Bash"))} ${theme.fg("dim", `· ${rows.length} commands${counts.length ? ` · ${counts.join(" · ")}` : ""}`)}`;
  const lines = [withMetadata(title, toggleHint, width)];
  rows.forEach((row, index) => {
    const last = index === rows.length - 1;
    if (expanded && index > 0) lines.push(width >= 16 ? theme.fg("borderMuted", "  │") : "");
    lines.push(...commandLines(row, expanded, last, theme, width));
    lines.push(...outputLines(row, expanded, last, theme, width));
  });
  return lines;
}
