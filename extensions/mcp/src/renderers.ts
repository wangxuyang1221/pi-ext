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

interface RendererContext {
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
  error: boolean;
  kind: "Empty" | "Image" | "JSON" | "Mixed" | "Text";
  size: number;
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
  component.setRenderer((width) => [formatMcpCallLine(
    names,
    argumentSummary,
    context.isPartial,
    context.isError,
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
  const presentation = prepareResultPresentation(result, context.isError);
  component.setRenderer((width) => renderMcpResultLines(
    presentation,
    options,
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
    theme.fg("dim", "•"),
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

  const expandable = presentation.detail.length > 0;
  const expandHint = expandable
    ? formatExpandHint(options.expanded ? "collapse" : "expand", theme)
    : undefined;
  const fields: SummaryField[] = presentation.error
    ? [
      ...(presentation.detail
        ? [{
          text: theme.fg("dim", inlinePreview(presentation.detail, MAX_ERROR_PREVIEW_WIDTH)),
          priority: 90,
          order: 10,
        }]
        : []),
      ...(expandHint ? [{ text: expandHint, priority: 100, order: 20 }] : []),
    ]
    : [
      { text: theme.fg("dim", presentation.kind), priority: 90, order: 10 },
      { text: theme.fg("dim", formatBytes(presentation.size)), priority: 80, order: 20 },
      ...(expandHint ? [{ text: expandHint, priority: 100, order: 30 }] : []),
    ];
  const outcome = presentation.error
    ? theme.fg("error", "Failed")
    : theme.fg("success", "Completed");
  const lines = [formatResultSummary(outcome, fields, theme, summaryWidth)];

  if (options.expanded && expandable) {
    lines.push(...renderExpandedDetail(presentation, theme, summaryWidth));
  }
  return lines;
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
  const color: ThemeColor = presentation.error ? "error" : "toolOutput";
  const sourceLines = formatExpandedText(presentation.detail, presentation.kind).split("\n");
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
  let structured = false;
  if (detail.length === 0 && details?.structuredContent !== undefined) {
    detail = safeJson(details.structuredContent);
    structured = true;
  }
  const size = Buffer.byteLength(detail, "utf8");
  detail = sanitizeDiagnosticText(detail, DEFAULT_MAX_BYTES);

  const hasText = detail.trim().length > 0;
  const json = hasText && (structured || parseJson(detail) !== undefined);
  const kind = hasImage && hasText
    ? "Mixed"
    : hasImage
      ? "Image"
      : json
        ? "JSON"
        : hasText
          ? "Text"
          : "Empty";

  return {
    detail,
    error: contextIsError || details?.isError === true,
    kind,
    size,
  };
}

function formatExpandedText(detail: string, kind: ResultPresentation["kind"]): string {
  if (kind !== "JSON") return detail;
  const parsed = parseJson(detail);
  if (parsed === undefined) return detail;
  try {
    return JSON.stringify(parsed, null, 2) ?? detail;
  } catch {
    return detail;
  }
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) return `${formatDecimal(kibibytes)} KB`;
  return `${formatDecimal(kibibytes / 1024)} MB`;
}

function formatDecimal(value: number): string {
  return value >= 10 ? `${Math.round(value)}` : value.toFixed(1);
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
