import { keyHint } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { TOOL_STATUS_GLYPH, toolStatusMarker } from "../../../extensions/codex-ui/src/tool-status.ts";

const component = render => ({ render, invalidate() {} });
const clean = value => String(value ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
const count = (n, singular, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;
function hint(expanded, theme) {
  try { return keyHint("app.tools.expand", expanded ? "collapse" : "expand"); }
  catch { return theme.fg("dim", `ctrl+o ${expanded ? "collapse" : "expand"}`); }
}
function fitParts(primary, extras, width, theme) {
  let text = primary;
  for (const extra of extras) {
    const next = `${text}${theme.fg("dim", " · ")}${extra}`;
    if (visibleWidth(next) <= width) text = next;
  }
  return truncateToWidth(text, Math.max(0, width));
}
export function createSearchRenderers() {
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      return component(width => {
        const data = context.state.search;
        const status = data?.status ?? (context.executionStarted ? "running" : "pending");
        const title = status === "completed" || status === "partial" ? "Searched web"
          : status === "failed" ? "Web search failed" : status === "timed_out" ? "Web search timed out"
          : status === "interrupted" ? "Web search interrupted" : "Searching web";
        const marker = status === "partial" ? theme.fg("warning", TOOL_STATUS_GLYPH) : toolStatusMarker(theme, status);
        const head = `${marker} ${theme.fg("toolTitle", theme.bold(title))}`;
        const queries = Array.isArray(args.queries) ? args.queries : [];
        const suffix = queries.length > 1 ? ` +${count(queries.length - 1, "query", "queries")}` : "";
        const available = width - visibleWidth(head) - visibleWidth(suffix) - 3;
        const preview = available >= 5 && queries.length ? ` (${truncateToWidth(clean(queries[0]), available)}${suffix})`
          : queries.length ? ` (${count(queries.length, "query", "queries")})` : "";
        return [truncateToWidth(head + theme.fg("dim", preview), width)];
      });
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      context.state.search = result.details?.status ? result.details : {
        status: context.isError ? "failed" : isPartial ? "running" : "completed",
        message: result.content?.filter(item => item.type === "text").map(item => item.text).join(" "),
      };
      return component(width => {
        const data = context.state.search;
        const total = data?.total ?? context.args.queries?.length ?? 0;
        const sources = data?.sources?.length ?? 0;
        const status = data.status;
        const failed = data.failed ?? 0;
        const problem = ["failed", "timed_out", "interrupted"].includes(status);
        const primary = status === "running" ? `${data.completed ?? 0}/${total} queries completed`
          : status === "partial" ? `${total - failed}/${total} succeeded · ${failed} failed`
          : problem ? clean(data.message || "Search failed") : count(sources, "source");
        const body = theme.fg(status === "failed" ? "error" : problem || status === "partial" ? "warning" : "text", primary);
        const extras = problem ? [] : status === "partial" ? [count(sources, "source")]
          : status === "running" ? [] : [count(total, "query", "queries")];
        if (!problem) extras.push(`${Math.round((data?.elapsedMs ?? 0) / 1000)}s`);
        const text = fitParts(body, [...extras.map(text => theme.fg("text", text)), hint(expanded, theme)], width - 4, theme);
        const lines = [truncateToWidth(theme.fg("dim", "  └ ") + text, width)];
        if (expanded) {
          const add = (value, tone = "text") => {
            const indent = " ".repeat(Math.min(4, Math.max(0, width - 1)));
            for (const line of wrapTextWithAnsi(theme.fg(tone, clean(value)), Math.max(1, width - indent.length))) {
              lines.push(truncateToWidth(indent + line, width));
            }
          };
          add("Queries", "dim");
          (context.args.queries ?? []).forEach((query, index) => add(`${index + 1}. ${query}`));
          add("Settings", "dim");
          add(`responses · ${context.args.search_context_size ?? "high"} · ${context.args.freshness ?? "live"}`, "dim");
          if (data.failed) add(`Failures: ${data.failed} query failed (offline fixture)`, "warning");
          add("Sources (offline fixtures)", "dim");
          if (!sources) add(status === "running" ? "Waiting for sources" : "No sources", "dim");
          for (const source of data.sources ?? []) { add(source.title); add(source.url, "dim"); }
        }
        return lines;
      });
    },
  };
}
