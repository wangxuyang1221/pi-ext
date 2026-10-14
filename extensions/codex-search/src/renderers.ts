import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, keyHint, truncateHead, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { ResolvedConfig } from "./config.ts";
import type { WebSearchDetails } from "./index.ts";
import type { SearchActivity, SearchAnimations } from "./animation.ts";
import { createStandaloneRenderers } from "./standalone-renderers.ts";

type Status = "pending" | "running" | "completed" | "partial" | "failed" | "timed_out" | "interrupted" | "unknown";
interface Summary { status: Status; total: number; completed: number; failed: number; sources: number; elapsedMs?: number; message?: string }
interface RowState {
  activity?: SearchActivity; summary?: Summary; details?: unknown; validDetails?: WebSearchDetails; content?: unknown; partial?: boolean; error?: boolean;
  expanded?: { content: unknown; details: unknown; args: unknown; text: string };
}
interface SearchArgs { queries?: string[]; freshness?: string; search_context_size?: string }
/** Persist only typed diagnostics; arbitrary result prose is never classified as a timeout. */
export interface SearchFailureMetadata { searchFailure: { kind: string; cancelled: boolean } }
function failureOf(value: unknown): SearchFailureMetadata["searchFailure"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const failure = (value as Partial<SearchFailureMetadata>).searchFailure;
  return failure && typeof failure.kind === "string" && typeof failure.cancelled === "boolean" ? failure : undefined;
}
const tones = { pending: "warning", running: "warning", completed: "muted", partial: "warning", failed: "error", timed_out: "warning", interrupted: "warning", unknown: "dim" } as const;
const titles: Record<Status, string> = { pending: "Searching web", running: "Searching web", completed: "Searched web", partial: "Searched web", failed: "Web search failed", timed_out: "Web search timed out", interrupted: "Web search interrupted", unknown: "Web search" };
function resultStatus(details: WebSearchDetails | undefined, partial: boolean, error: boolean, failure: SearchFailureMetadata["searchFailure"] | undefined): Status {
  if (error) return failure?.cancelled ? "interrupted" : failure?.kind === "timeout" ? "timed_out" : "failed";
  if (partial) return "running";
  if (!details) return "unknown";
  if (details.failedQueryCount > 0) return details.successes.length ? "partial" : "failed";
  return details.successes.length ? "completed" : "unknown";
}
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clean = (value: string) => stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
const duration = (ms: number) => ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${Math.round(ms / 1000)}s`;
class SearchComponent implements Component {
  draw: (width: number) => string[];
  constructor(draw: (width: number) => string[]) { this.draw = draw; }
  render(width: number): string[] { return this.draw(Math.max(0, width)); }
  invalidate(): void {}
}
function component(previous: Component | undefined, draw: (width: number) => string[]): SearchComponent {
  const value = previous instanceof SearchComponent ? previous : new SearchComponent(draw);
  value.draw = draw;
  return value;
}
function detailsOf(value: unknown): WebSearchDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const d = value as WebSearchDetails;
  return Array.isArray(d.successes) && d.successes.every(item => item && Array.isArray(item.citations))
    && Array.isArray(d.failures) && d.failures.every(item => item && typeof item.message === "string")
    && Number.isInteger(d.queryCount) && d.queryCount >= 0
    && Number.isInteger(d.failedQueryCount) && d.failedQueryCount >= 0 && d.failedQueryCount <= d.queryCount ? d : undefined;
}
function currentSummary(state: RowState): Summary | undefined {
  if (state.activity?.status === "cancelled") return { ...state.summary, total: state.summary?.total ?? 0, completed: 0, failed: 0, sources: 0, status: "interrupted", message: "Search cancelled" };
  return state.summary;
}
function fit(primary: string, extras: string[], width: number, theme: Theme): string {
  let text = primary;
  for (const extra of extras) {
    const next = text + theme.fg("dim", " · ") + extra;
    if (visibleWidth(next) <= width) text = next;
  }
  return truncateToWidth(text, Math.max(0, width));
}
function expandHint(expanded: boolean, theme: Theme): string {
  const label = expanded ? "collapse" : "expand";
  try { return keyHint("app.tools.expand", label); }
  catch { return theme.fg("dim", `ctrl+o ${label}`); }
}

function expandedText(content: readonly { type: string; text?: string }[], details: WebSearchDetails | undefined, args: SearchArgs | undefined, config: ResolvedConfig): string {
  function* sections(): Generator<string> {
    yield "Queries";
    const queries = Array.isArray(args?.queries) ? args.queries : Array.isArray(details?.queries) ? details.queries : [];
    for (const [i, query] of queries.entries()) if (typeof query === "string") yield `${i + 1}. ${query}`;
    yield "Settings";
    yield `${details?.api ?? "responses"} · ${details?.searchContextSize ?? args?.search_context_size ?? config.defaultSearchContextSize} · ${details?.freshness ?? args?.freshness ?? config.defaultFreshness}`;
    if (details?.model) yield `Model: ${details.model}`;
    if (details?.failures.length) {
      yield `Failures (${details.failures.length})`;
      for (const item of details.failures) yield `[${item.kind}] ${item.query}: ${item.message}`;
    }
    yield "Results";
    for (const part of content) if (part.type === "text" && part.text) yield part.text;
  }
  let raw = "";
  let clipped = false;
  for (const part of sections()) {
    const remaining = DEFAULT_MAX_BYTES - raw.length;
    if (remaining <= 0) { clipped = true; break; }
    raw += part.slice(0, remaining) + "\n";
    if (part.length > remaining) { clipped = true; break; }
  }
  const truncated = truncateHead(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  const safe = stripTerminalSequences(truncated.content).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trimEnd();
  return safe + (clipped || truncated.truncated ? "\n... display truncated" : "");
}

/** Render compact search rows; standalone actions retain their existing renderer. */
export function createSearchRenderers(config: ResolvedConfig, labelsFor: (args: Record<string, unknown>) => string[], animations: SearchAnimations): Pick<ToolDefinition, "renderShell" | "renderCall" | "renderResult"> {
  if (config.searchApi === "standalone") return createStandaloneRenderers(config, labelsFor, animations);
  return {
    renderShell: "self",
    renderCall(input, theme, context) {
      const state = context.state as RowState;
      state.activity = animations.watch(context.toolCallId, context.invalidate, false) ?? state.activity;
      const args = input && typeof input === "object" ? input as Record<string, unknown> : {};
      const queries = Array.isArray(args.queries) ? args.queries.filter((q): q is string => typeof q === "string") : [];
      return component(context.lastComponent, width => {
        const status = currentSummary(state)?.status ?? (context.executionStarted ? "running" : "pending");
        const head = `${theme.fg(tones[status], "⌕")} ${theme.fg("toolTitle", theme.bold(titles[status]))}`;
        const suffix = queries.length > 1 ? ` +${count(queries.length - 1, "query", "queries")}` : "";
        const available = width - visibleWidth(head) - visibleWidth(suffix) - 3;
        const preview = queries.length && available >= 5 ? ` (${truncateToWidth(clean(queries[0]!.slice(0, 512)) + (queries[0]!.length > 512 ? "…" : ""), available)}${suffix})`
          : queries.length ? ` (${count(queries.length, "query", "queries")})` : "";
        return [truncateToWidth(head + theme.fg("dim", preview), width)];
      });
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const state = context.state as RowState;
      const details = state.details === result.details && state.summary ? state.validDetails : detailsOf(result.details);
      const args = context.args as SearchArgs | undefined;
      const needsMessage = context.isError || !details;
      const content = needsMessage ? result.content : undefined;
      if (state.details !== result.details || state.content !== content || state.partial !== isPartial || state.error !== context.isError || !state.summary) {
        state.details = result.details; state.validDetails = details; state.content = content; state.partial = isPartial; state.error = context.isError;
        state.expanded = undefined;
        const failure = failureOf(result.details) ?? (details?.failure ? { kind: details.failure.kind, cancelled: false } : undefined);
        const status = resultStatus(details, isPartial, context.isError, failure);
        state.summary = { status,
          total: details?.total ?? details?.queryCount ?? (Array.isArray(args?.queries) ? args.queries.length : 0),
          completed: details?.completed ?? 0, failed: details?.failedQueryCount ?? 0,
          sources: details?.successes.reduce((n, item) => n + item.citations.length, 0) ?? 0,
          elapsedMs: details?.elapsedMs,
          message: content ? clean(content.slice(0, 24).find(item => item.type === "text")?.text?.slice(0, 1024) ?? "") : details?.failure?.message,
        };
      }
      if (expanded && (state.expanded?.content !== result.content || state.expanded.details !== result.details || state.expanded.args !== args)) {
        state.expanded = { content: result.content, details: result.details, args, text: expandedText(result.content, details, args, config) };
      }
      return component(context.lastComponent, width => {
        const data = currentSummary(state)!;
        const problem = ["failed", "timed_out", "interrupted", "unknown"].includes(data.status);
        const primary = data.status === "running" ? `${data.completed}/${data.total} queries completed`
          : data.status === "partial" ? `${data.total - data.failed}/${data.total} succeeded · ${data.failed} failed`
          : problem ? data.message || (data.status === "unknown" ? "Result unavailable" : "Search failed") : count(data.sources, "source");
        const extras = problem || data.status === "running" ? [] : data.status === "partial" ? [count(data.sources, "source")] : [count(data.total, "query", "queries")];
        if (!problem && data.elapsedMs !== undefined) extras.push(duration(data.elapsedMs));
        const tone = data.status === "partial" || problem ? tones[data.status] : "text";
        const text = fit(theme.fg(tone, primary), [...extras.map(item => theme.fg("text", item)), expandHint(expanded, theme)], width - 4, theme);
        const lines = [truncateToWidth(theme.fg("dim", "  └ ") + text, width)];
        if (expanded && state.expanded) {
          const indent = " ".repeat(Math.min(4, Math.max(0, width - 1)));
          for (const paragraph of state.expanded.text.split("\n")) {
            const tone = /^(Queries|Settings|Results|Model:|\.\.\. display truncated)/.test(paragraph) ? "dim" : "text";
            for (const line of wrapTextWithAnsi(theme.fg(tone, paragraph), Math.max(1, width - indent.length))) {
              if (lines.length >= DEFAULT_MAX_LINES) break;
              lines.push(truncateToWidth(indent + line, width));
            }
            if (lines.length >= DEFAULT_MAX_LINES) { lines.push(truncateToWidth(theme.fg("dim", indent + "... display truncated"), width)); break; }
          }
        }
        return lines;
      });
    },
  };
}
