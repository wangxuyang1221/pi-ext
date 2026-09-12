// PROTOTYPE: Adapt the referenced terminal layouts, not their execution backends.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { fitToWidth, normalizeWidth } from "../../../extensions/codex-ui/src/layout.js";
import type { BashFixture } from "./fixtures.js";
import { clean } from "./renderers.js";
import { renderHybrid } from "./cli-hybrid.js";

export type CliStyle = "codex" | "claude" | "hybrid";

function wrap(text: string, width: number): string[] {
  return wrapTextWithAnsi(clean(text), Math.max(1, width));
}

function commandLines(command: string, first: string, continuation: string, width: number): string[] {
  const [head = "", ...tail] = clean(command).split("\n");
  const [firstLine = "", ...firstOverflow] = wrap(head, width - visibleWidth(first));
  return [first + firstLine, ...[
    ...firstOverflow, ...tail.flatMap(line => wrap(line, width - visibleWidth(continuation))),
  ].map(line => continuation + line)];
}

function statusColor(row: BashFixture): "success" | "error" | "warning" {
  return row.status === "completed" ? "success" : row.status === "failed" ? "error" : "warning";
}

function capture(row: BashFixture, style: CliStyle): string[] {
  const lines = [...row.output];
  const diagnostic = row.status === "cancelled" ? "Interrupted" : row.status === "timeout" ? "Error: Command timed out"
    : style === "claude" && row.status === "failed" ? `Error: Exit code ${row.exitCode ?? "?"}` : undefined;
  if (diagnostic && lines[0] !== diagnostic) lines.unshift(diagnostic);
  if (!lines.length && row.status === "completed") lines.push(style === "claude" ? "(No content)" : "(no output)");
  return lines;
}

function renderCodex(row: BashFixture, expanded: boolean, theme: Theme, width: number, expandKey: string): string[] {
  if (expanded) {
    const result = row.status === "running" ? "Running…" : row.status === "completed" ? "✓"
      : row.status === "cancelled" ? "Interrupted" : row.status === "timeout" ? "Command timed out" : `✗ (${row.exitCode ?? "?"})`;
    return [
      ...commandLines(row.command, theme.fg("accent", "$ "), "  ", width),
      ...capture(row, "codex").flatMap(line => wrap(line, width)).map(line => theme.fg("dim", line)),
      `${theme.fg(statusColor(row), result)} ${theme.fg("dim", `• ${(row.durationMs / 1000).toFixed(1)}s`)}`,
    ];
  }
  const command = commandLines(row.command, `${theme.fg(statusColor(row), "•")} ${theme.bold(row.status === "running" ? "Running" : "Ran")} `, theme.fg("dim", "  │ "), width);
  const lines = command.length <= 3 ? command : [...command.slice(0, 3), theme.fg("dim", `  │ … +${command.length - 3} lines`)];
  const output = capture(row, "codex").flatMap(line => wrap(line, width - 4));
  const preview = output.length <= 5 ? output : [
    ...output.slice(0, 2), `… +${output.length - 4} lines${expandKey ? ` (${expandKey} to expand)` : ""}`, ...output.slice(-2),
  ];
  lines.push(...preview.map((line, index) => theme.fg("dim", `${index ? "    " : "  └ "}${line}`)));
  return lines;
}

function renderClaude(row: BashFixture, expanded: boolean, theme: Theme, width: number, expandKey: string): string[] {
  const prefix = `${theme.fg(statusColor(row), "⏺")} ${theme.bold("Bash")}(`;
  const command = expanded
    ? commandLines(row.command + ")", prefix, "  ", width)
    : [prefix + fitToWidth(clean(row.command).replace(/\n/gu, " "), Math.max(0, width - visibleWidth(prefix) - 1), { ellipsis: "…" }) + ")"];
  const output = capture(row, "claude").flatMap(line => wrap(line, width - 5));
  if (row.status === "running" && output.length === 0) output.push("Running…");
  const preview = expanded || output.length <= 3 ? output : [
    ...output.slice(0, 3), `… +${output.length - 3} lines${expandKey ? ` (${expandKey} to expand)` : ""}`,
  ];
  const bodyColor = row.status === "failed" ? "error" : row.status === "timeout" || row.status === "cancelled" ? "warning" : "text";
  return [...command, ...preview.map((line, index) =>
    theme.fg("dim", index ? "     " : "  ⎿  ") + theme.fg(line.startsWith("… +") ? "dim" : bodyColor, line))];
}

export function renderCliRows(rows: BashFixture[], style: CliStyle, expanded: boolean, theme: Theme, availableWidth: number, expandKey = "ctrl+o"): string[] {
  const width = normalizeWidth(availableWidth);
  if (!width) return [];
  if (style === "hybrid") return renderHybrid(rows, expanded, theme, width);
  return rows.filter(row => row.status !== "pending").flatMap((row, index) => [
    ...(index ? [""] : []), ...(style === "codex" ? renderCodex : renderClaude)(row, expanded, theme, width, expandKey),
    ...(row.truncated ? [theme.fg("warning", "  Truncated capture · full output unavailable")] : []),
  ]).map(line => fitToWidth(line, width));
}
