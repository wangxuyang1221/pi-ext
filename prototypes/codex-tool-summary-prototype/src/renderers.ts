// PROTOTYPE: Success-summary alternatives, composed with production tool renderers.
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { ResponsiveLinesComponent } from "../../../extensions/codex-ui/src/responsive-lines.js";
import { sanitizeDiagnosticText } from "../../../extensions/mcp/src/diagnostics.js";

export type Variant = 1 | 2 | 3 | 4;
export interface LabState {
  variant: Variant;
  writeInProgress: boolean;
  invalidators: Map<string, () => void>;
  hint(theme: Theme, expanded: boolean): string;
}
interface Metadata { fields: string[]; expandable: boolean }
const metadataKey = Symbol("summary-lab-metadata");

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
}

function metadata(result: { content: { type: string; text?: string }[] }): Metadata {
  const text = result.content.filter(item => item.type === "text").map(item => item.text ?? "").join("\n");
  let type = text ? "Text" : "Empty";
  try { if (text.trim()) { JSON.parse(text); type = "JSON"; } } catch { /* Plain-text fixture. */ }
  return { fields: [type, formatBytes(Buffer.byteLength(text))], expandable: Boolean(text) };
}

// The preview is intentionally bounded by rendered rows rather than Codex's approximate budget.
export function codexPreview(text: string, theme: Theme, width: number): string[] {
  if (width <= 0 || !text.trim()) return [];
  let source = sanitizeDiagnosticText(text, 32 * 1024);
  try {
    const json = JSON.stringify(JSON.parse(source));
    let quoted = false;
    let escaped = false;
    source = "";
    for (const character of json) {
      source += character;
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === "," || character === ":") source += " ";
    }
  } catch { /* Keep plain text unchanged. */ }
  const indent = width >= 5 ? 4 : 0;
  const contentWidth = width - indent;
  const lines = wrapTextWithAnsi(source, contentWidth);
  const preview = lines.slice(0, 5);
  if (lines.length > preview.length) {
    const last = preview.length - 1;
    preview[last] = truncateToWidth(preview[last]!, Math.max(0, contentWidth - 3), "") + ".".repeat(Math.min(3, contentWidth));
  }
  return preview.map((line, index) => theme.fg("dim", `${indent ? index === 0 ? "  └ " : "    " : ""}${truncateToWidth(line, contentWidth, "")}`));
}

function summaryWidth(width: number): number {
  return Math.min(110, width >= 72 ? width - 8 : width);
}

export function alignRight(left: string, right: string, width: number): string {
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (!right || gap < 2) return truncateToWidth(left, width, "...");
  return `${left}${" ".repeat(gap)}${right}`;
}

function component(renderer: (width: number) => string[]): Component {
  const result = new ResponsiveLinesComponent();
  result.setRenderer(renderer);
  return result;
}

function wrapWriteTool(base: ToolDefinition, lab: LabState): ToolDefinition {
  return {
    ...base,
    renderShell: "self",
    async execute() { throw new Error("Tool execution is disabled in this UI prototype."); },
    renderCall(args, theme, context) {
      lab.invalidators.set(context.toolCallId, context.invalidate);
      return component(width => {
        // Restored rows may have a settled result before argsComplete is set by the host.
        const pending = lab.writeInProgress || context.isPartial;
        const failed = context.isError && !lab.writeInProgress;
        const color = failed ? "error" : pending ? "warning" : "success";
        const params = args as Record<string, unknown>;
        // Fixtures use relative paths. Never inspect content while arguments are streaming.
        const path = sanitizeDiagnosticText(String(params.path ?? ""), 4096);
        const title = `${theme.fg(color, "•")} ${theme.fg("toolTitle", theme.bold("Write"))} ${theme.fg("accent", path)}`;
        let suffix = "";
        if (!pending && !failed && typeof params.content === "string") {
          const lines = params.content ? params.content.split("\n").length : 0;
          suffix = theme.fg("dim", ` (${lines} ${lines === 1 ? "line" : "lines"})`);
        }
        return [truncateToWidth(title + suffix, width, "...")];
      });
    },
    renderResult(result, options, theme, context) {
      const failure = context.isError && !options.isPartial
        ? base.renderResult!(result, options, theme, { ...context, lastComponent: undefined })
        : undefined;
      return component(width => lab.writeInProgress ? [] : failure?.render(width) ?? []);
    },
  };
}

export function wrapSummaryTool(base: ToolDefinition, kind: "mcp" | "write", lab: LabState): ToolDefinition {
  if (kind === "write") return wrapWriteTool(base, lab);
  return {
    ...base,
    renderShell: "self",
    async execute() { throw new Error("Tool execution is disabled in this UI prototype."); },
    renderCall(args, theme, context) {
      lab.invalidators.set(context.toolCallId, context.invalidate);
      const original = base.renderCall!(args, theme, { ...context, lastComponent: undefined });
      return component(width => {
        const variant = lab.variant;
        const limit = summaryWidth(width);
        let title = original.render(width)[0] ?? "";
        const meta = context.state[metadataKey] as Metadata | undefined;
        if (variant === 4 && !context.isPartial) {
          const color = context.isError || !meta ? "error" : "success";
          title = title.replace(theme.fg("dim", "•"), theme.fg(color, theme.bold("•")));
        }
        if (variant !== 3 || context.isPartial || context.isError || !meta) return [truncateToWidth(title, width, "...")];
        const hint = meta.expandable ? lab.hint(theme, context.expanded) : "";
        const fields = meta.fields.slice(1);
        const candidates = [
          [...fields, hint].filter(Boolean).join(theme.fg("dim", " · ")),
          hint,
          "",
        ];
        const fullTitle = title;
        // Never reserve metadata space by truncating the title further.
        const selected = candidates.find(value => visibleWidth(fullTitle) + visibleWidth(value) + 2 <= limit) ?? "";
        return [alignRight(fullTitle, theme.fg("dim", selected), limit)];
      });
    },
    renderResult(result, options, theme, context) {
      const meta = metadata(result);
      const failed = context.isError || Boolean((result.details as { isError?: boolean } | undefined)?.isError);
      context.state[metadataKey] = failed || options.isPartial ? undefined : meta;
      const original = base.renderResult!(result, options, theme, { ...context, lastComponent: undefined });
      return component(width => {
        if (options.isPartial || context.isError || (result.details as { isError?: boolean } | undefined)?.isError) {
          return original.render(width);
        }
        const variant = lab.variant;
        if (variant === 4) {
          if (options.expanded) return original.render(width).slice(1).map(line => theme.fg("dim", stripTerminalSequences(line)));
          const text = result.content.filter(item => item.type === "text").map(item => item.type === "text" ? item.text : "").join("\n");
          return codexPreview(text, theme, summaryWidth(width));
        }
        const limit = summaryWidth(width);
        const hint = meta.expandable ? lab.hint(theme, options.expanded) : "";
        const fields = theme.fg("dim", meta.fields.join(" · "));
        let summary: string[] = [];
        if (variant === 1) {
          const prefix = `${theme.fg("dim", "  └ ")}${theme.fg("muted", "Completed")}`;
          const candidates = [
            `${prefix}${theme.fg("dim", " · ")}${fields}${hint ? theme.fg("dim", " · ") + hint : ""}`,
            `${prefix}${hint ? theme.fg("dim", " · ") + hint : ""}`,
            prefix,
          ];
          summary = [truncateToWidth(candidates.find(value => visibleWidth(value) <= limit) ?? prefix, limit, "...")];
        } else if (variant === 2) {
          summary = [alignRight(`  ${fields}`, hint, limit)];
        }
        // The production MCP renderer owns JSON formatting, sanitization and output bounds.
        const detail = options.expanded ? original.render(width).slice(1) : [];
        return [...summary, ...detail];
      });
    },
  };
}
