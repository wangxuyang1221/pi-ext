// PROTOTYPE: Only Read rendering changes. Group membership is fixture-defined.
import { basename, dirname } from "node:path";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { ReadFixture } from "./fixtures.js";
export type Variant = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const FILE_COLORS = ["cyan", "soft", "blue"] as const;
export type FileColor = typeof FILE_COLORS[number];
export interface LabState {
  fileColor?: FileColor;
  variant: Variant;
  pending: boolean;
  fixtures: ReadFixture[];
  invalidators: Map<string, () => void>;
}
interface RecordData {
  args: ReadFixture["args"];
  text?: string;
  failed?: boolean;
  partial?: boolean;
  truncated?: boolean;
  image?: boolean;
  preview?: { source: string; lines: string[] };
}
const component = (render: (width: number) => string[]): Component => ({ render, invalidate() {} });
const clean = (text: string) => stripTerminalSequences(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, "").replace(/\t/gu, "  ");
function lineCount(text: string): number { return text ? text.replace(/\n$/u, "").split("\n").length : 0; }
function withMeta(left: string, right: string, width: number): string {
  if (visibleWidth(left) + visibleWidth(right) <= width) return left + right;
  const available = width - visibleWidth(right);
  return available >= 16 ? truncateToWidth(left, available, "…") + right : truncateToWidth(left, width, "…");
}
function detail(record: RecordData, theme: Theme, width: number, preview: boolean): string[] {
  const lines: string[] = [];
  const push = (text: string) => {
    for (const line of wrapTextWithAnsi(text, Math.max(1, width - 4))) lines.push(`  │ ${line}`);
  };
  if (!preview) push(theme.fg("dim", clean(record.args.path)));
  const source = clean(record.text ?? "").replace(/\n$/u, "").split("\n");
  if (!record.text) return lines;
  const shown = source.slice(0, preview ? 3 : 80);
  shown.forEach((line, index) => push(theme.fg("dim", String((record.args.offset ?? 1) + index).padStart(3) + "  ") + theme.fg("toolOutput", line)));
  if (source.length > shown.length) push(theme.fg("dim", `… ${source.length - shown.length} more lines`));
  return lines;
}
function boundedPreview(record: RecordData, theme: Theme, width: number, count: number): string[] {
  const source = record.text ?? "";
  if (!source) return [];
  if (record.preview?.source !== source) {
    const lines: string[] = [];
    let start = 0;
    // Extract only three prefixes. Long source lines never create extra screen rows.
    for (let index = 0; index < 3 && start < source.length; index++) {
      const newline = source.indexOf("\n", start);
      const end = newline < 0 ? source.length : newline;
      lines.push(clean(source.slice(start, Math.min(end, start + 512))) + (end - start > 512 ? "…" : ""));
      start = end + 1;
    }
    record.preview = { source, lines };
  }
  const lines = record.preview.lines.map((line, index) => truncateToWidth(
    theme.fg("borderMuted", "  │ ") + theme.fg("dim", String((record.args.offset ?? 1) + index).padStart(3) + "  ")
      + theme.fg("toolOutput", line), width, "…"));
  if (count > record.preview.lines.length) lines.push(truncateToWidth(theme.fg("dim", `  └ … ${count - record.preview.lines.length} more lines`), width, "…"));
  return lines;
}
function filenameText(filename: string, color: FileColor, theme: Theme): string {
  if (color === "cyan") return theme.fg("accent", filename);
  // Fixed truecolor swatches are local to this disposable comparison, not theme changes.
  const rgb = color === "soft" ? "138;191;196" : "157;181;206";
  return `\u001b[38;2;${rgb}m${filename}\u001b[39m`;
}
function renderRecord(record: RecordData, variant: Variant, pendingOverride: boolean, expanded: boolean, theme: Theme, width: number, color: FileColor): string[] {
  const pending = pendingOverride || record.partial || record.text === undefined;
  const failed = !pending && record.failed;
  const path = clean(record.args.path);
  const filename = basename(path);
  const styledFilename = filenameText(filename, color, theme);
  const dir = dirname(path) === "." ? "./" : `${dirname(path)}/`;
  const count = lineCount(record.text ?? "");
  const meta = pending ? "Reading…" : failed ? "Failed" : record.image ? "Image loaded"
    : record.args.offset !== undefined || record.args.limit !== undefined
      ? count ? `L${record.args.offset ?? 1}–${(record.args.offset ?? 1) + count - 1} · ${count} lines` : "0 lines"
      : `${count} ${count === 1 ? "line" : "lines"}`;
  const suffix = `${meta}${!pending && record.truncated ? " · truncated" : ""}`;
  const mark = theme.fg(failed ? "error" : pending ? "warning" : "success", failed ? "×" : pending ? "◌" : "✓");
  const title = `${mark} ${theme.fg("muted", "Read")} ${styledFilename}`;
  const right = theme.fg(failed ? "error" : "dim", ` · ${suffix}`);
  let lines: string[];
  if (variant === 2) {
    const size = Math.min(width, 96);
    const inner = Math.max(1, size - 4);
    const header = withMeta(`${mark} ${theme.bold(styledFilename)}`, right, inner);
    const directory = withMeta(theme.fg("dim", dir), theme.fg("muted", " · Read"), inner);
    const fill = (text: string) => {
      const fitted = truncateToWidth(text, inner, "…");
      return theme.bg("selectedBg", `│ ${fitted}${" ".repeat(Math.max(0, inner - visibleWidth(fitted)))} │`);
    };
    lines = [theme.fg("borderMuted", `╭${"─".repeat(Math.max(0, size - 2))}╮`), fill(header), fill(directory), theme.fg("borderMuted", `╰${"─".repeat(Math.max(0, size - 2))}╯`)];
  } else if (variant === 5) {
    lines = [withMeta(`${theme.fg(failed ? "error" : pending ? "warning" : "muted", "●")} ${theme.fg("muted", pending ? "Reading" : "Read")} ${styledFilename}`, "", width),
      withMeta(theme.fg("borderMuted", "│ ") + theme.fg("dim", dir), right, width)];
  } else {
    const heading = variant === 4 || variant === 6
      ? `${mark} ${styledFilename}${theme.fg("dim", `  ${dir}`)}`
      : `${variant === 3 ? theme.fg("dim", expanded ? "▾ " : "▸ ") : ""}${title}`;
    lines = [withMeta(heading, right, width)];
  }
  if (failed) lines.push(theme.fg("error", `  × ${clean(record.text ?? "Read failed").split("\n")[0]}`));
  if (!pending && !failed) {
    if (variant === 6 && !expanded) lines.push(...boundedPreview(record, theme, width, count));
    else if (expanded || variant === 3) lines.push(...detail(record, theme, width, !expanded));
  }
  return lines.map(line => truncateToWidth(line, width, "…"));
}
export function wrapReadTool(base: ToolDefinition, lab: LabState): ToolDefinition {
  const records = new Map<string, RecordData>();
  return {
    ...base,
    async execute() { throw new Error("Tool execution is disabled in this UI prototype."); },
    renderCall(args, theme, context) {
      lab.invalidators.set(context.toolCallId, context.invalidate);
      const record = records.get(context.toolCallId) ?? { args: args as ReadFixture["args"] };
      record.args = args as ReadFixture["args"];
      records.set(context.toolCallId, record);
      const original = base.renderCall!(args, theme, { ...context, lastComponent: undefined });
      return component(width => {
        if (width <= 0) return [];
        if (lab.variant === 0) return original.render(width);
        if ((lab.variant === 4 || lab.variant === 6) && lab.fixtures.length > 1) {
          if (context.toolCallId !== lab.fixtures.at(-1)!.id) return [];
          const header = theme.fg("toolTitle", `${context.expanded ? "▾" : "▸"} Read ${lab.fixtures.length} files`);
          return [truncateToWidth(header, width), ...lab.fixtures.flatMap(fixture => {
            const member = records.get(fixture.id) ?? { args: fixture.args };
            return renderRecord(member, lab.variant, lab.pending, context.expanded, theme, Math.max(1, width - 2), lab.fileColor ?? "soft")
              .map(line => truncateToWidth(`  ${line}`, width));
          })];
        }
        return renderRecord(record, lab.variant, lab.pending, context.expanded, theme, width, lab.fileColor ?? "soft");
      });
    },
    renderResult(result, options, theme, context) {
      const record = records.get(context.toolCallId) ?? { args: context.args as ReadFixture["args"] };
      record.text = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
      record.failed = context.isError;
      record.partial = options.isPartial;
      record.truncated = Boolean((result.details as { truncation?: { truncated?: boolean } } | undefined)?.truncation?.truncated);
      record.image = result.content.some(item => item.type === "image");
      records.set(context.toolCallId, record);
      const original = base.renderResult!(result, { ...options, isPartial: options.isPartial || lab.pending }, theme, { ...context, lastComponent: undefined });
      return component(width => lab.variant === 0 ? original.render(width) : []);
    },
  };
}
