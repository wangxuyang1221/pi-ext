import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  keyHint,
  type Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import {
  DEFAULT_FIELD_BYTES,
  sanitizeDiagnosticText,
} from "./diagnostics.js";

interface McpRowState {
  mcpStatus?: "pending" | "success" | "error";
}

interface RendererContext {
  state?: McpRowState;
  lastComponent: Component | undefined;
  isPartial: boolean;
  isError: boolean;
}

interface ResultRenderOptions {
  expanded: boolean;
  isPartial: boolean;
}

interface McpToolNames {
  serverName: string;
  toolName: string;
}

interface ResultContent {
  type?: unknown;
  text?: unknown;
  mimeType?: unknown;
}

interface ResultPresentation {
  detail: string;
  preview: string;
  expandedDetail: string;
  error: boolean;
}

interface SummaryField {
  text: string;
  priority: number;
  order: number;
}

const MAX_ARGUMENT_PREVIEW_WIDTH = 240;
const MAX_ARGUMENT_SOURCE_CHARS = 2048;
const MAX_ERROR_PREVIEW_WIDTH = 240;
const MCP_SUMMARY_MAX_WIDTH = 110;
const MCP_SUMMARY_MIN_GUTTER_WIDTH = 8;
const MCP_SUMMARY_GUTTER_MIN_TERMINAL_WIDTH = 72;
const MCP_RESULT_BRANCH = "  └ ";
const MCP_DETAIL_INDENT = "    ";
const MCP_DETAIL_MIN_CONTENT_WIDTH = 4;
const SENSITIVE_ARGUMENT_KEY = /api[-_]?key|access[-_]?token|authorization|password|passwd|secret|cookie/i;

class ResponsiveLinesComponent implements Component {
  private renderer: (width: number) => string[] = () => [];
  // One bounded, unthemed result per host row. No width history or global cache.
  private prepared?: { content: unknown; structured: unknown; presentation: ResultPresentation };

  prepare(result: unknown, isError: boolean): ResultPresentation {
    const record = asRecord(result);
    const details = asRecord(record?.details);
    if (!this.prepared || this.prepared.content !== record?.content || this.prepared.structured !== details?.structuredContent) {
      this.prepared = { content: record?.content, structured: details?.structuredContent,
        presentation: prepareResultPresentation(result, isError) };
    }
    this.prepared.presentation.error = isError || details?.isError === true;
    return this.prepared.presentation;
  }

  setRenderer(renderer: (width: number) => string[]): void {
    this.renderer = renderer;
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    return this.renderer(safeWidth).map((line) => truncateToWidth(line, safeWidth, ""));
  }

  invalidate(): void {}
}

export function renderMcpToolCall(
  args: unknown,
  names: McpToolNames,
  theme: Theme,
  context: RendererContext,
): Component {
  const component = getResponsiveComponent(context.lastComponent);
  const argumentSummary = formatMcpToolArguments(args);
  const state = context.state ?? {};
  component.setRenderer((width) => [formatMcpCallLine(
    names,
    argumentSummary,
    context.isPartial || state.mcpStatus === undefined || state.mcpStatus === "pending",
    context.isError || state.mcpStatus === "error",
    theme,
    width,
  )]);
  return component;
}

export function renderMcpToolResult(
  result: unknown,
  options: ResultRenderOptions,
  theme: Theme,
  context: RendererContext,
): Component {
  const component = getResponsiveComponent(context.lastComponent);
  const presentation = component.prepare(result, context.isError);
  const pending = options.isPartial || result == null;
  if (context.state) {
    context.state.mcpStatus = pending ? "pending" : presentation.error ? "error" : "success";
  }
  component.setRenderer((width) => renderMcpResultLines(
    presentation,
    { ...options, isPartial: pending },
    theme,
    width,
  ));
  return component;
}

function getResponsiveComponent(previous: Component | undefined): ResponsiveLinesComponent {
  return previous instanceof ResponsiveLinesComponent
    ? previous
    : new ResponsiveLinesComponent();
}

function formatMcpCallLine(
  names: McpToolNames,
  argumentSummary: string,
  isPartial: boolean,
  isError: boolean,
  theme: Theme,
  width: number,
): string {
  const action = isError ? "Call failed for" : isPartial ? "Calling" : "Called";
  const safeServerName = sanitizeDiagnosticText(names.serverName, DEFAULT_FIELD_BYTES);
  const safeToolName = sanitizeDiagnosticText(names.toolName, DEFAULT_FIELD_BYTES);
  const base = [
    theme.fg(isError ? "error" : isPartial ? "dim" : "success", "•"),
    theme.fg("toolTitle", theme.bold(action)),
    theme.fg("accent", theme.bold(`${safeServerName} / ${safeToolName}`)),
  ].join(" ");
  const summaryWidth = getSummaryWidth(width);

  if (!argumentSummary) {
    return truncateToWidth(base, summaryWidth, "...");
  }

  const argumentWidth = summaryWidth - visibleWidth(base) - 3;
  if (argumentWidth < 8) {
    return truncateToWidth(base, summaryWidth, "...");
  }

  const argument = truncateToWidth(argumentSummary, argumentWidth, "...");
  return `${base} ${theme.fg("dim", `(${argument})`)}`;
}

function renderMcpResultLines(
  presentation: ResultPresentation,
  options: ResultRenderOptions,
  theme: Theme,
  width: number,
): string[] {
  const summaryWidth = getSummaryWidth(width);
  if (options.isPartial) {
    return [formatResultSummary(
      theme.fg("accent", theme.bold("Running")),
      [{ text: theme.fg("dim", "waiting for response"), priority: 100, order: 10 }],
      theme,
      summaryWidth,
    )];
  }

  if (!presentation.error) {
    if (!presentation.preview.trim()) return [];
    if (options.expanded) return renderExpandedDetail(presentation, theme, summaryWidth);
    const preview = presentation.preview;
    const indent = summaryWidth >= 8 ? MCP_DETAIL_INDENT : "";
    const contentWidth = Math.max(1, summaryWidth - indent.length);
    const { lines, truncated } = previewLines(preview, contentWidth);
    if (truncated) lines[lines.length - 1] = `${truncateToWidth(lines[lines.length - 1]!, Math.max(0, contentWidth - 3), "")}...`;
    return lines.map((line, index) => theme.fg("dim", `${indent && index === 0 ? MCP_RESULT_BRANCH : indent}${line}`));
  }

  const expandable = presentation.detail.length > 0;
  const expandHint = expandable
    ? formatExpandHint(options.expanded ? "collapse" : "expand", theme)
    : undefined;
  const fields: SummaryField[] = [
    ...(presentation.detail
      ? [{
        text: theme.fg("dim", inlinePreview(presentation.detail, MAX_ERROR_PREVIEW_WIDTH)),
        priority: 90,
        order: 10,
      }]
      : []),
    ...(expandHint ? [{ text: expandHint, priority: 100, order: 20 }] : []),
  ];
  const outcome = theme.fg("error", "Failed");
  const lines = [formatResultSummary(outcome, fields, theme, summaryWidth)];

  if (options.expanded && expandable) {
    lines.push(...renderExpandedDetail(presentation, theme, summaryWidth));
  }
  return lines;
}

const previewSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function previewLines(text: string, width: number): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let line = "";
  let cells = 0;
  for (const { segment } of previewSegmenter.segment(text)) {
    const size = segment === "\n" ? 0 : visibleWidth(segment);
    if (segment === "\n" || cells + size > width) {
      lines.push(line);
      if (lines.length === 5) return { lines, truncated: true };
      line = "";
      cells = 0;
      if (segment === "\n") continue;
    }
    line += segment;
    cells += size;
  }
  lines.push(line);
  return { lines, truncated: false };
}

function formatResultSummary(
  outcome: string,
  fields: readonly SummaryField[],
  theme: Theme,
  width: number,
): string {
  const prefix = `${theme.fg("dim", MCP_RESULT_BRANCH)}${outcome}`;
  const separator = theme.fg("dim", " · ");
  const availableWidth = Math.max(0, width - visibleWidth(prefix) - visibleWidth(separator));
  const selected: SummaryField[] = [];
  let usedWidth = 0;

  for (const field of [...fields].sort((left, right) => right.priority - left.priority)) {
    const fieldWidth = visibleWidth(field.text);
    const extraWidth = (selected.length > 0 ? visibleWidth(separator) : 0) + fieldWidth;
    if (usedWidth + extraWidth <= availableWidth) {
      selected.push(field);
      usedWidth += extraWidth;
    }
  }

  if (selected.length === 0) return truncateToWidth(prefix, width, "...");
  selected.sort((left, right) => left.order - right.order);
  return truncateToWidth(
    `${prefix}${separator}${selected.map((field) => field.text).join(separator)}`,
    width,
    "...",
  );
}

function renderExpandedDetail(
  presentation: ResultPresentation,
  theme: Theme,
  width: number,
): string[] {
  const indent = width >= MCP_DETAIL_INDENT.length + MCP_DETAIL_MIN_CONTENT_WIDTH
    ? MCP_DETAIL_INDENT
    : "";
  const contentWidth = Math.max(1, width - visibleWidth(indent));
  const color: ThemeColor = presentation.error ? "error" : "dim";
  const sourceLines = presentation.expandedDetail.split("\n");
  const output: string[] = [];
  let displayTruncated = false;

  outer: for (const sourceLine of sourceLines) {
    const safeLine = sanitizeDiagnosticText(sourceLine, DEFAULT_MAX_BYTES);
    const wrapped = safeLine.length === 0
      ? [""]
      : wrapTextWithAnsi(theme.fg(color, safeLine), contentWidth);
    for (const line of wrapped) {
      if (output.length >= DEFAULT_MAX_LINES) {
        displayTruncated = true;
        break outer;
      }
      output.push(truncateToWidth(`${indent}${line}`, width, ""));
    }
  }

  if (displayTruncated) {
    output.push(truncateToWidth(
      `${indent}${theme.fg("dim", "... display truncated")}`,
      width,
      "",
    ));
  }
  return output;
}

function prepareResultPresentation(result: unknown, contextIsError: boolean): ResultPresentation {
  const record = asRecord(result);
  const details = asRecord(record?.details);
  const content = Array.isArray(record?.content)
    ? record.content.map((item) => asRecord(item) ?? {}) as ResultContent[]
    : [];
  const textParts: string[] = [];
  let hasImage = false;

  for (const item of content) {
    if (item.type === "text" && typeof item.text === "string") {
      textParts.push(item.text);
      continue;
    }
    if (item.type === "image") {
      hasImage = true;
      continue;
    }
    if (Object.keys(item).length > 0) textParts.push(safeJson(item));
  }

  let detail = textParts.join("\n");
  if (detail.length === 0 && details?.structuredContent !== undefined) {
    detail = safeJson(details.structuredContent);
  }
  detail = sanitizeDiagnosticText(detail, DEFAULT_MAX_BYTES);

  const hasText = detail.trim().length > 0;
  const parsed = hasText ? parseJson(detail) : undefined;
  const json = !hasImage && parsed !== undefined;

  let preview = hasImage && !hasText ? "Image" : detail;
  let expandedDetail = preview;
  if (json) {
    try {
      preview = sanitizeDiagnosticText(compactJson(parsed), DEFAULT_MAX_BYTES);
      expandedDetail = sanitizeDiagnosticText(JSON.stringify(parsed, null, 2), DEFAULT_MAX_BYTES);
    } catch {
      preview = detail;
      expandedDetail = detail;
    }
  }
  return { detail, preview, expandedDetail, error: contextIsError || details?.isError === true };
}

function compactJson(value: unknown): string {
  // Match complete JSON strings before punctuation so escapes and string contents stay intact.
  return safeJson(value).replace(/"(?:[^"\\]|\\.)*"|[:,]/gu, token => token === ":" || token === "," ? `${token} ` : token);
}

function formatMcpToolArguments(args: unknown): string {
  if (!isRecord(args)) return "";
  const entries = ownEntries(args, 8);
  if (entries.length === 0) return "";

  const preferredString = entries.find(
    ([key, value]) =>
      !SENSITIVE_ARGUMENT_KEY.test(key)
      && typeof value === "string"
      && value.trim().length > 0,
  )?.[1];
  if (typeof preferredString === "string") {
    return inlinePreview(preferredString, MAX_ARGUMENT_PREVIEW_WIDTH);
  }

  return inlinePreview(
    safeJson(summarizeArgumentValue(args, 0, new WeakSet<object>())),
    MAX_ARGUMENT_PREVIEW_WIDTH,
  );
}

function summarizeArgumentValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return inlinePreview(value, 120);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  if (depth >= 2) return Array.isArray(value) ? `[... +${value.length} items]` : "{...}";

  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 3).map((item) => summarizeArgumentValue(item, depth + 1, seen));
    if (value.length > items.length) items.push(`... +${value.length - items.length} items`);
    seen.delete(value);
    return items;
  }

  const entries = ownEntries(value as Record<string, unknown>, 5);
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, 4)) {
    result[key] = SENSITIVE_ARGUMENT_KEY.test(key)
      ? "[redacted]"
      : summarizeArgumentValue(item, depth + 1, seen);
  }
  if (entries.length > 4) result["..."] = "more fields";
  seen.delete(value);
  return result;
}

function formatExpandHint(description: "collapse" | "expand", theme: Theme): string {
  try {
    return keyHint("app.tools.expand", description);
  } catch {
    return `${theme.fg("dim", "ctrl+o")} ${theme.fg("muted", description)}`;
  }
}

function getSummaryWidth(width: number): number {
  const gutterWidth = width >= MCP_SUMMARY_GUTTER_MIN_TERMINAL_WIDTH
    ? MCP_SUMMARY_MIN_GUTTER_WIDTH
    : 0;
  return Math.max(1, Math.min(MCP_SUMMARY_MAX_WIDTH, width - gutterWidth));
}

function inlinePreview(text: string, maxWidth: number): string {
  const boundedSource = text.slice(0, MAX_ARGUMENT_SOURCE_CHARS);
  const safeText = sanitizeDiagnosticText(boundedSource, DEFAULT_FIELD_BYTES)
    .replace(/\s+/gu, " ")
    .trim();
  return truncateToWidth(safeText, maxWidth, "...");
}

function ownEntries(value: Record<string, unknown>, limit: number): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    entries.push([key, value[key]]);
    if (entries.length >= limit) break;
  }
  return entries;
}

function parseJson(value: string): unknown | undefined {
  const source = value.trim();
  if (!source) return undefined;
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

function normalizeWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
