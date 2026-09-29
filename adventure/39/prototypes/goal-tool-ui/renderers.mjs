import { stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const labels = { active: "Active", paused: "Paused", blocked: "Blocked", complete: "Complete", budget_limited: "Budget limited", usage_limited: "Usage limited" };
const actions = {
  get_goal: ["Reading goal", "Read goal"],
  create_goal: ["Creating goal", "Created goal"],
  update_goal: ["Updating goal", "Updated goal"],
};
const cleanBlock = value => stripTerminalSequences(String(value ?? "")).replace(/\r\n?/gu, "\n").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu, " ").trim();
const clean = value => cleanBlock(value).replace(/\s+/gu, " ").trim();
const resultText = result => result?.content?.filter(item => item.type === "text").map(item => item.text).join("\n") ?? "";
const interrupted = result => resultText(result) === "Goal tool invocation was cancelled.";
const tokens = value => value < 1000 ? String(value) : `${Number((value / 1000).toFixed(1))}k`;
const elapsed = value => `${Math.floor(value / 60)}m ${String(Math.floor(value % 60)).padStart(2, "0")}s`;
function component(paint) {
  return { invalidate() {}, render(width) { return width > 0 ? paint(width).map(line => truncateToWidth(line, width, "…")) : []; } };
}

/** Prototype-only decorator. The production executor, schema, and model payload are untouched. */
export function decorateGoalTool(tool, preferences) {
  return { ...tool, renderShell: "self",
    renderCall(args, theme, context) {
      const state = context.state;
      if (!state.registered) {
        preferences.rows?.add(context.invalidate);
        state.registered = true;
      }
      state.context = context;
      return component(() => {
        const goal = state.result?.details?.goal;
        const partial = state.context.isPartial;
        const error = state.context.isError;
        const color = partial || (error && interrupted(state.result)) ? "warning" : error ? "error" : "success";
        const title = error ? `${tool.label} ${interrupted(state.result) ? "interrupted" : "failed"}` : actions[tool.name][partial ? 0 : 1];
        const suffix = !error && goal ? labels[goal.status] ?? clean(goal.status) : partial ? clean(args.objective ?? args.status) : "";
        return [`${theme.fg(color, "⏺")} ${theme.bold(title)}${suffix ? theme.fg("dim", ` · ${suffix}`) : ""}`];
      });
    },
    renderResult(result, options, theme, context) {
      context.state.result = result;
      return component(width => {
        const goal = result.details?.goal;
        const indent = width >= 8 ? "     " : "";
        const branch = width >= 8 ? "  ⎿  " : "";
        const wrap = (text, tone = "text") => cleanBlock(text).split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(1, width - indent.length)))
          .map((line, index) => theme.fg("dim", index ? indent : branch) + theme.fg(tone, line));
        if (context.isError) {
          const error = cleanBlock(resultText(result)) || "Goal operation failed";
          return options.expanded ? wrap(error, interrupted(result) ? "warning" : "error")
            : [branch + theme.fg(interrupted(result) ? "warning" : "error", error.split("\n")[0])];
        }
        if (options.isPartial) return [branch + theme.fg("dim", "Working…")];
        if (!goal) return wrap(result.details?.goal === null ? "No goal" : resultText(result) || "Result unavailable", "dim");
        const budget = goal.tokenBudget == null ? "" : ` / ${tokens(goal.tokenBudget)}`;
        if (!options.expanded) {
          const lines = [theme.fg("dim", branch) + clean(goal.objective)];
          if (preferences.density === "summary") lines.push(theme.fg("dim", `${indent}${tokens(goal.tokensUsed)}${budget} tokens · ${elapsed(goal.timeUsedSeconds)}`));
          if (String(result.details.usageVisibility).startsWith("incomplete")) lines.push(theme.fg("warning", `${indent}Observed usage only`));
          return lines;
        }
        const exact = value => Number(value).toLocaleString("en-US");
        const fields = [cleanBlock(goal.objective),
          `Status: ${labels[goal.status] ?? goal.status}`,
          `Tokens: ${exact(goal.tokensUsed)}${goal.tokenBudget == null ? " · No budget" : ` / ${exact(goal.tokenBudget)}`}`,
          `Remaining: ${result.details.remainingTokens == null ? "Unbounded" : exact(result.details.remainingTokens)}`,
          `Elapsed: ${elapsed(goal.timeUsedSeconds)}`,
          `Usage: ${clean(result.details.usageVisibility)}`,
          `Thread: ${clean(goal.threadId)}`,
          `Created: ${new Date(goal.createdAt * 1000).toISOString()}`,
          `Updated: ${new Date(goal.updatedAt * 1000).toISOString()}`,
        ];
        return fields.flatMap((field, index) => field.split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(1, width - indent.length)))
          .map((line, wrapped) => theme.fg("dim", index === 0 && wrapped === 0 ? branch : indent) + theme.fg(index ? "dim" : "text", line)));
      });
    },
  };
}
