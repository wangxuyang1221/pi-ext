import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { inline } from "./codemode-data.js";
import type { CodemodeCall, CodemodeRow } from "./codemode-model.js";

export type ChildRenderer = (call: CodemodeCall, width: number, theme: Theme) => string[];
export const callLabel = (call: CodemodeCall): string => `${call.model ? "Model " : ""}${call.name} ${inline(call.args.path ?? call.args.command ?? call.args.preview ?? "", 1024)}`.trim();
export const duration = (ms?: number): string => ms === undefined ? "" : `${(ms / 1000).toFixed(1)}s`;
export const statusColor = (status: string): "muted" | "warning" | "error" => status === "error" || status === "failed" ? "error" : ["running", "pending", "cancelled", "unknown", "interrupted", "timed_out"].includes(status) ? "warning" : "muted";
const scriptLabels = { pending: "Preparing", running: "Running", completed: "Script completed", failed: "Script failed", interrupted: "Interrupted", timed_out: "Timed out", unknown: "Status unavailable" };

/** Visits visible children only; siblings keep start order, descendants stay with their parent. */
export function treeCalls(row: CodemodeRow, limit: number): CodemodeCall[] {
  const output: CodemodeCall[] = [], stack = [{ items: row.children.get(row.id) ?? [], index: 0 }];
  while (stack.length && output.length < limit) {
    const top = stack.at(-1)!;
    const call = top.items[top.index++];
    if (!call) { stack.pop(); continue; }
    output.push(call);
    const children = row.children.get(call.id);
    if (children?.length) stack.push({ items: children, index: 0 });
  }
  return output;
}

export function renderCodemodeTree(row: CodemodeRow, options: { theme: Theme; width: number; expanded: boolean; child?: ChildRenderer; expandHint?: string }): string[] {
  const { theme, width, expanded, child } = options;
  if (width <= 0) return [];
  const warning = row.failures.size > 0 || row.incomplete || row.counts.unknown > 0;
  const color = row.status === "completed" && warning ? "warning" : statusColor(row.status);
  const lines = [theme.fg(color, theme.bold(`${expanded ? "▾" : "▸"} Codemode · ${scriptLabels[row.status]}${row.durationMs === undefined ? "" : ` · ${duration(row.durationMs)}`}`)),
    theme.fg("dim", `  ${row.calls.length}${row.incomplete ? "+" : ""} calls · ${row.counts.ok} completed · ${row.counts.running} running · ${row.counts.error} failed${row.counts.cancelled ? ` · ${row.counts.cancelled} cancelled` : ""}${row.counts.unknown ? ` · ${row.counts.unknown} unknown` : ""}`)];
  const visible = treeCalls(row, expanded ? 1024 : 5);
  for (const [index, call] of visible.entries()) {
    const indent = "  " + "  ".repeat(Math.min(call.depth, 6));
    const branch = `${indent}${index === visible.length - 1 && visible.length === row.calls.length ? "└─" : "├─"} `;
    const contentWidth = Math.max(1, width - visibleWidth(branch));
    const body = expanded && child ? child(call, contentWidth, theme) : [];
    if (body.length) for (const [n, text] of body.entries()) lines.push((n === 0 ? branch : " ".repeat(visibleWidth(branch))) + text);
    else lines.push(theme.fg(statusColor(call.status), `${branch}${callLabel(call)} · ${call.status}${call.durationMs === undefined ? "" : ` · ${duration(call.durationMs)}`}`));
  }
  if (row.calls.length > visible.length) lines.push(theme.fg("dim", `  … ${row.calls.length - visible.length} more calls${options.expandHint ? ` · ${options.expandHint}` : ""}`));
  let shownErrors = 0;
  for (const call of row.failures.values()) {
    if (shownErrors++ === 3) break;
    lines.push(theme.fg(statusColor(call.status), `  ! ${callLabel(call)} · ${inline(call.error ?? call.status)}`));
  }
  if (row.failures.size > 3) lines.push(theme.fg("warning", `  ! ${row.failures.size - 3} more failed/cancelled calls · /inspect`));
  if (row.incomplete) lines.push(theme.fg("warning", row.evicted ? "  ! UI history evicted; details unavailable" : "  ! Incomplete metadata; counts are a lower bound"));
  if (expanded && row.restored) lines.push(theme.fg("dim", "  History contains metadata only; raw child results unavailable"));
  if (["failed", "interrupted", "timed_out"].includes(row.status)) {
    const marker = row.output.lastIndexOf("Script error:\n");
    const diagnostic = marker >= 0 ? row.output.slice(marker + 14) : row.output;
    lines.push(theme.fg(color, `  ! ${inline(diagnostic) || scriptLabels[row.status]}`));
  }
  lines.push(theme.fg("dim", "  Output to model"));
  const payload = row.output.replace(/^Script (?:completed|failed)\nWall time [^\n]+\n(?:\n)?Output:\n/u, "");
  // Preview extraction stops at the visible budget, rather than splitting every line.
  const limit = expanded ? 16 : 2;
  let offset = 0, shown = 0;
  while (offset < payload.length && shown < limit) {
    const end = payload.indexOf("\n", offset), stop = end < 0 ? payload.length : end;
    const clipped = stop - offset > 2048;
    const line = payload.slice(offset, Math.min(stop, offset + 2048));
    offset = end < 0 ? payload.length : end + 1;
    if (!line.trim()) continue;
    lines.push(`    ${line}${clipped ? "…" : ""}`); shown++;
  }
  if (!shown) lines.push(theme.fg("dim", `    ${row.status === "running" ? "Waiting for script output…" : "(No output)"}`));
  if (offset < payload.length || row.output.length >= 65536) lines.push(theme.fg("dim", "    … Preview limited · /inspect for captured output"));
  if (row.outputPath) lines.push(theme.fg("dim", `  Full output: ${inline(row.outputPath, 2048)}`));
  if (expanded) lines.push(theme.fg("dim", "  /inspect · Calls / Script / Output"));
  return lines.map(line => truncateToWidth(line, Math.max(0, width), "…"));
}

export type InspectorTab = "Calls" | "Script" | "Output";
export interface InspectorState { tab: InspectorTab; selected: number; scroll: number }

/** Already-prepared detail lines are supplied by the bounded presentation cache. */
export function renderInspector(row: CodemodeRow, state: InspectorState, theme: Theme, width: number, height: number, detail: readonly string[]): string[] {
  const fit = (line: string) => truncateToWidth(line, Math.max(0, width), "…");
  const lines = [theme.bold(`Codemode inspector · ${scriptLabels[row.status]}`), (["Calls", "Script", "Output"] as const).map(tab => tab === state.tab ? `[${tab}]` : tab).join("  ")];
  const bodyHeight = Math.max(1, height - 4);
  const offset = Math.min(state.scroll, Math.max(0, detail.length - bodyHeight));
  const body = detail.slice(offset, offset + bodyHeight);
  if (state.tab === "Calls" && width >= 90) {
    const leftWidth = Math.floor(width * 0.4), start = Math.max(0, state.selected - bodyHeight + 1);
    for (let i = 0; i < Math.max(body.length, Math.min(bodyHeight, row.calls.length - start)); i++) {
      const call = row.calls[start + i];
      const left = truncateToWidth(call ? `${start + i === state.selected ? ">" : " "} ${callLabel(call)} · ${call.status}` : "", leftWidth, "…");
      lines.push(left + " ".repeat(Math.max(0, leftWidth - visibleWidth(left))) + " │ " + (body[i] ?? ""));
    }
  } else lines.push(...body);
  lines.push(theme.fg("dim", "Tab: view · ↑↓: call · PgUp/PgDn: scroll"), theme.fg("dim", "Esc: close"));
  return lines.slice(0, Math.max(0, height)).map(fit);
}
export function wrapDetail(lines: readonly string[], width: number): string[] {
  return lines.flatMap(line => wrapTextWithAnsi(line, Math.max(1, width)));
}
