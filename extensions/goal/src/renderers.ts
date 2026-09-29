import type { ThemeColor, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";

const labels = { active: "Active", paused: "Paused", blocked: "Blocked", complete: "Complete", budget_limited: "Budget limited", usage_limited: "Usage limited" };
const actions = {
  get_goal: ["Reading goal", "Read goal", "Get goal"],
  create_goal: ["Creating goal", "Created goal", "Create goal"],
  update_goal: ["Updating goal", "Updated goal", "Update goal"],
} as const;
interface DisplayGoal {
  objective: string;
  status: keyof typeof labels;
  tokensUsed: number;
  tokenBudget: number | null;
  timeUsedSeconds: number;
  threadId: string;
  createdAt: number;
  updatedAt: number;
}
interface DisplayDetails { goal: DisplayGoal | null; remainingTokens: number | null; usageVisibility: string }
interface RowState { details?: DisplayDetails; cancelled?: boolean }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && !Number.isNaN(new Date(value * 1000).getTime());
function detailsOf(value: unknown): DisplayDetails | undefined {
  if (!object(value)) return;
  if (value.goal === null) return { goal: null, remainingTokens: null, usageVisibility: typeof value.usageVisibility === "string" ? value.usageVisibility : "" };
  const goal = value.goal;
  if (!object(goal) || typeof goal.objective !== "string" || typeof goal.status !== "string" || !Object.hasOwn(labels, goal.status)
    || !count(goal.tokensUsed) || !(goal.tokenBudget === null || count(goal.tokenBudget) && goal.tokenBudget > 0)
    || typeof goal.timeUsedSeconds !== "number" || !Number.isFinite(goal.timeUsedSeconds) || goal.timeUsedSeconds < 0
    || typeof goal.threadId !== "string" || !timestamp(goal.createdAt) || !timestamp(goal.updatedAt)
    || !(value.remainingTokens === null || count(value.remainingTokens)) || typeof value.usageVisibility !== "string") return;
  return value as unknown as DisplayDetails;
}
// Strip terminal commands before removing residual controls. Never sanitize model data in place.
const cleanBlock = (value: string) => stripTerminalSequences(value).replace(/\r\n?/gu, "\n").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu, " ").trim();
const cleanLine = (value: string) => cleanBlock(value).replace(/\s+/gu, " ");
const tokens = (value: number) => value < 1000 ? String(value) : `${Number((value / 1000).toFixed(1))}k`;
const exact = (value: number) => value.toLocaleString("en-US");
const elapsed = (value: number) => `${Math.floor(value / 60)}m ${String(Math.floor(value % 60)).padStart(2, "0")}s`;
class GoalComponent implements Component {
  private width?: number;
  private lines?: string[];
  constructor(private paint: (width: number) => string[]) {}
  update(paint: (width: number) => string[]): this { this.paint = paint; this.invalidate(); return this; }
  invalidate(): void { this.lines = undefined; }
  render(width: number): string[] {
    if (this.lines && this.width === width) return this.lines;
    this.width = width;
    return this.lines = width > 0 ? this.paint(width).map(line => truncateToWidth(line, width, "…")) : [];
  }
}
function component(previous: Component | undefined, paint: (width: number) => string[]): Component {
  return previous instanceof GoalComponent ? previous.update(paint) : new GoalComponent(paint);
}
/** Display-only hooks. State belongs to one invocation, never the live Goal store. */
export function goalRenderers(name: keyof typeof actions): Pick<ToolDefinition<TSchema, unknown, RowState>, "renderShell" | "renderCall" | "renderResult"> {
  return {
    renderShell: "self",
    renderCall(_args, theme, context) {
      return component(context.lastComponent, () => {
        const goal = context.state.details?.goal;
        const cancelled = context.isError && context.state.cancelled;
        const color = context.isPartial || cancelled ? "warning" : context.isError ? "error" : "success";
        const title = context.isPartial ? actions[name][0] : context.isError ? `${actions[name][2]} ${cancelled ? "interrupted" : "failed"}` : actions[name][1];
        return [`${theme.fg(color, "⏺")} ${theme.bold(title)}${!context.isPartial && !context.isError && goal ? theme.fg("dim", ` · ${labels[goal.status]}`) : ""}`];
      });
    },
    renderResult(result, options, theme, context) {
      const details = detailsOf(result.details);
      const rawText = !details || context.isError
        ? result.content.filter(item => item.type === "text" && typeof item.text === "string").map(item => item.type === "text" ? item.text : "").join("\n") : "";
      const text = cleanBlock(rawText);
      context.state.details = details;
      // This is the exact error emitted by Goal's aborted-call guard, not a keyword heuristic.
      context.state.cancelled = rawText === "Goal tool invocation was cancelled.";
      const incomplete = object(result.details) && typeof result.details.usageVisibility === "string" && result.details.usageVisibility.startsWith("incomplete");
      return component(context.lastComponent, width => {
        const indent = width >= 8 ? "     " : "";
        const branch = width >= 8 ? "  ⎿  " : "";
        const wrap = (value: string) => value.split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(1, width - indent.length)));
        const block = (value: string, tone: ThemeColor, expanded: boolean) => (expanded ? wrap(value) : [value.split("\n")[0]!]).map((line, index) => theme.fg("dim", index ? indent : branch) + theme.fg(tone, line));
        const warning = incomplete ? wrap("Observed usage only").map(line => theme.fg("warning", indent + line)) : [];
        if (options.isPartial) return [branch + theme.fg("dim", "Working…")];
        if (context.isError) return block(text || "Goal operation failed", context.state.cancelled ? "warning" : "error", options.expanded);
        if (!details) return [...block(text || "Result unavailable", "dim", options.expanded), ...warning];
        const goal = details.goal;
        if (goal === null) return [...block("No goal", "dim", false), ...warning];
        if (!options.expanded) return [theme.fg("dim", branch) + cleanLine(goal.objective),
          theme.fg("dim", `${indent}${tokens(goal.tokensUsed)}${goal.tokenBudget === null ? "" : ` / ${tokens(goal.tokenBudget)}`} tokens · ${elapsed(goal.timeUsedSeconds)}`), ...warning];
        const fields = [cleanBlock(goal.objective), `Status: ${labels[goal.status]}`,
          `Tokens: ${exact(goal.tokensUsed)}${goal.tokenBudget === null ? " · No budget" : ` / ${exact(goal.tokenBudget)}`}`,
          `Remaining: ${details.remainingTokens === null ? "Unbounded" : exact(details.remainingTokens)}`,
          `Elapsed: ${elapsed(goal.timeUsedSeconds)}`, `Usage: ${cleanLine(details.usageVisibility)}`,
          `Thread: ${cleanLine(goal.threadId)}`, `Created: ${new Date(goal.createdAt * 1000).toISOString()}`, `Updated: ${new Date(goal.updatedAt * 1000).toISOString()}`];
        return [...fields.flatMap((field, index) => wrap(field).map((line, part) => theme.fg("dim", index === 0 && part === 0 ? branch : indent) + theme.fg(index ? "dim" : "text", line))), ...warning];
      });
    },
  };
}
