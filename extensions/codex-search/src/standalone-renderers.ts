import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text, type Component } from "@earendil-works/pi-tui";
import type { ResolvedConfig } from "./config.ts";
import type { WebSearchDetails } from "./index.ts";
import { searchSpinner, type SearchActivity, type SearchAnimations } from "./animation.ts";

const palette = {
  title: "#A6DADC", number: "#E0E3E6", query: "#C1C7CE", body: "#B9C2CB",
  meta: "#929DA8", mode: "#B8C0C8", sources: "#A8CCEC", success: "#78D99A",
};
type Role = keyof typeof palette;
const fallback: Record<Role, Parameters<Theme["fg"]>[0]> = {
  title: "accent", number: "text", query: "text", body: "text", meta: "dim", mode: "muted", sources: "accent", success: "success",
};
function color(theme: Theme, role: Role, text: string): string {
  // Preserve theme semantics on light/unknown themes and non-truecolor terminals.
  if (!["codex-pi", "dark"].includes(theme.name ?? "") || !theme.getFgAnsi("accent").includes("38;2;")) {
    return theme.fg(fallback[role], text);
  }
  const hex = palette[role].slice(1);
  return `\x1b[38;2;${hex.match(/../g)!.map(v => parseInt(v, 16)).join(";")}m${text}\x1b[39m`;
}
function shell(content: string, top: boolean): Component {
  const box = new Box(1, 0);
  if (top) box.addChild(new Spacer(1));
  box.addChild(new Text(content, 0, 0));
  if (!top) box.addChild(new Spacer(1));
  return box;
}
function inline(value: string, limit = 110): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
function asArgs(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
function duration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${Math.max(1, Math.round(ms / 1000))}s`;
}
function firstLine(text: string, limit = 110): string {
  // Scan only through the first non-empty line, never split a potentially large response.
  const match = /\S[^\r\n]*/.exec(text);
  return match ? inline(match[0].slice(0, limit + 1), limit) : "";
}
function detailsOf(value: unknown): WebSearchDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const details = value as WebSearchDetails;
  return Array.isArray(details.successes) && Array.isArray(details.failures) && typeof details.queryCount === "number" ? details : undefined;
}

/** Preserve the existing standalone action presentation independently of search rows. */
export function createStandaloneRenderers(config: ResolvedConfig, labelsFor: (args: Record<string, unknown>) => string[], animations: SearchAnimations): Pick<ToolDefinition, "renderShell" | "renderCall" | "renderResult"> {
  return {
    renderShell: "self",
    renderCall(input, theme, context) {
      const activity = animations.watch(context.toolCallId, context.invalidate) ?? context.state.searchActivity as SearchActivity | undefined;
      if (activity) context.state.searchActivity = activity;
      const args = asArgs(input);
      const labels = labelsFor(args);
      const displayName = config.searchApi === "standalone" ? "Codex Standalone Web" : "Web Search";
      const label = labels.length === 1 ? inline(labels[0]!, 90) : `${labels.length} actions`;
      const requested = args.search_context_size ?? config.defaultSearchContextSize;
      const size = config.searchApi === "standalone" && requested === "low" ? "medium" : requested;
      const mode = `${config.searchApi}/${size}${config.searchApi === "standalone" ? "" : `/${args.freshness ?? config.defaultFreshness}`}`;
      let text = color(theme, "title", `${activity?.status === "running" ? searchSpinner(activity) : "●"} `) + color(theme, "title", displayName) + color(theme, "number", `(${label})`) +
        ` ${color(theme, "meta", "[")}${color(theme, "mode", mode)}${color(theme, "meta", "]")}`;
      if (labels.length > 1) text += "\n" + labels.map((query, index) =>
        color(theme, "meta", `  ${index === labels.length - 1 ? "└" : "├"} `) + color(theme, "query", inline(query))).join("\n");
      return shell(text, true);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = detailsOf(result.details);
      const activity = context.state.searchActivity as SearchActivity | undefined;
      if (activity?.status === "cancelled") return shell(theme.fg("warning", "Web search cancelled."), false);
      if (isPartial) {
        const completed = details?.completed ?? 0;
        const total = details?.total ?? labelsFor(asArgs(context.args)).length;
        const elapsed = activity ? Math.max(0, (activity.endedAt ?? Date.now()) - activity.startedAt) : details?.elapsedMs;
        const time = elapsed === undefined ? "" : ` · ${Math.floor(elapsed / 1000)}s`;
        return shell(color(theme, "body", `Searching ${completed}/${total}${time}${completed >= total && total > 0 ? " (finalizing)" : " …"}`), false);
      }
      if (!details || context.isError) {
        const body = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
        if (context.isError) return shell(theme.fg("warning", `⚠ Web search failed${body ? `: ${expanded ? body : firstLine(body)}` : ""}`), false);
        // A legacy result with no metadata must not be labelled as verified success.
        return shell(color(theme, "body", expanded ? body : firstLine(body)), false);
      }
      const total = details.queryCount;
      const failed = details.failedQueryCount;
      const ok = Math.max(0, total - failed);
      const webActions = details.successes.reduce((sum, item) => sum + item.searchCalls.length, 0);
      const sources = details.successes.reduce((sum, item) => sum + item.citations.length, 0);
      const operations = details.api === "standalone" ? webActions || total : total;
      const noun = details.api === "standalone" ? "action" : "search";
      const plural = details.api === "standalone" ? "actions" : "searches";
      let text: string;
      if (!ok) text = theme.fg("warning", `⚠ Web search failed (${details.failure?.kind ?? details.failures[0]?.kind ?? "unknown"})`);
      else {
        text = failed ? theme.fg("warning", "⚠ ") : color(theme, "success", "✓") + " ";
        text += color(theme, "body", "Did ") + color(theme, "number", failed ? `${ok}/${total}` : `${operations}`) +
          color(theme, "body", ` ${(failed ? total : operations) === 1 ? noun : plural}`);
        if (details.elapsedMs !== undefined) text += color(theme, "body", " in ") + color(theme, "number", duration(details.elapsedMs));
        if (details.api === "responses" && webActions) text += color(theme, "meta", " · ") + color(theme, "number", `${webActions}`) + color(theme, "body", ` web action${webActions === 1 ? "" : "s"}`);
        if (sources) text += color(theme, "meta", " · ") + color(theme, "sources", `${sources} source${sources === 1 ? "" : "s"}`);
      }
      if (expanded) {
        text += "\n" + color(theme, "mode", `Model: ${details.model}`);
        if (failed) text += "\n" + theme.fg("warning", `Failures (${failed}):`) + "\n" + details.failures.map((item, i) =>
          color(theme, "query", `  ${i + 1}. [${item.kind}] ${inline(item.query, 60)}: ${inline(item.message, 100)}`)).join("\n");
        const body = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
        if (body) text += "\n\n" + body.split("\n").map(line => color(theme, "body", line)).join("\n");
      } else {
        if (details.api === "standalone" && details.successes[0]?.text) {
          const item = details.successes[0];
          const action = item.searchCalls[0]?.actionType;
          const label = action === "open_page" || action === "click" ? "Opened" : action === "find_in_page" ? "Found" : action === "screenshot" ? "Screenshot" : "Result";
          text += "\n" + color(theme, "query", `${label}: ${firstLine(item.text, 120)}`);
        }
        if (details.failures[0]) text += "\n" + color(theme, "query", inline(details.failures[0].message));
      }
      return shell(text, false);
    },
  };
}
