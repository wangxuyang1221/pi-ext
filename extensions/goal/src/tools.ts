import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { goalRenderers } from "./renderers.js";
import { StringEnum } from "@earendil-works/pi-ai";
import type { Goal, GoalRecord } from "./storage.js";
import { GET_DESCRIPTION, CREATE_DESCRIPTION, UPDATE_DESCRIPTION, OBJECTIVE_DESCRIPTION, BUDGET_DESCRIPTION, STATUS_DESCRIPTION, CONTINUATION_TEMPLATE, UPDATED_TEMPLATE, BUDGET_TEMPLATE } from "./upstream.js";

export interface GoalToolAccess {
  get(ctx: ExtensionContext): Promise<GoalRecord | undefined>;
  create(ctx: ExtensionContext, objective: string, budget?: number): Promise<GoalRecord>;
  update(ctx: ExtensionContext, status: "complete" | "blocked" | "paused"): Promise<GoalRecord>;
}
/** Render the pinned upstream template; replacements never reinterpret objective data. */
export function renderGoalPrompt(goal: Goal, edited = false, budget = false): string {
  const values: Record<string, string> = {
    objective: goal.objective.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    time_used_seconds: String(goal.elapsedSeconds),
    tokens_used: String(goal.tokensUsed), token_budget: goal.tokenBudget === undefined ? "none" : String(goal.tokenBudget),
    remaining_tokens: goal.tokenBudget === undefined ? edited ? "unknown" : "unbounded" : String(Math.max(0, goal.tokenBudget - goal.tokensUsed)),
  };
  return (budget ? BUDGET_TEMPLATE : edited ? UPDATED_TEMPLATE : CONTINUATION_TEMPLATE).replace(/{{ (\w+) }}/g, (_match, key: string) => values[key]!);
}
function response(record?: GoalRecord, completed = false) {
  const goal = record?.goal;
  const data = {
    goal: goal ? { threadId: record.ownerSessionId, objective: goal.objective, status: goal.status, tokenBudget: goal.tokenBudget ?? null, tokensUsed: goal.tokensUsed, timeUsedSeconds: goal.elapsedSeconds, createdAt: Math.floor(Date.parse(goal.createdAt) / 1000), updatedAt: Math.floor(Date.parse(goal.updatedAt) / 1000) } : null,
    usageVisibility: goal?.usageIncomplete ? "incomplete: reported tokens include only observed usage" : "observed",
    remainingTokens: goal?.tokenBudget === undefined ? null : Math.max(0, goal.tokenBudget - goal.tokensUsed),
    completionBudgetReport: completed && goal?.status === "complete" && (goal.tokenBudget !== undefined || goal.elapsedSeconds > 0)
      ? "Goal achieved. Report final usage from this tool result's structured goal fields. If `goal.tokenBudget` is present, include token usage from `goal.tokensUsed` and `goal.tokenBudget`. If `goal.timeUsedSeconds` is greater than 0, summarize elapsed time in a concise, human-friendly form appropriate to the response language." : null,
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data };
}
function validateCall(args: unknown, allowed: string[], signal?: AbortSignal): asserts args is Record<string, unknown> {
  if (signal?.aborted) throw new Error("Goal tool invocation was cancelled.");
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => !allowed.includes(key))) throw new Error("Invalid goal arguments; additional properties are not allowed.");
}
/** Register the three upstream goal tools, with strict argument schemas. */
export function registerGoalTools(pi: ExtensionAPI, access: GoalToolAccess): void {
  pi.registerTool({ ...goalRenderers("get_goal"), name: "get_goal", label: "Get goal", description: GET_DESCRIPTION, parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, args, signal, _update, ctx) => { validateCall(args, [], signal); return response(await access.get(ctx)); } });
  pi.registerTool({ ...goalRenderers("create_goal"), name: "create_goal", label: "Create goal", description: CREATE_DESCRIPTION,
    parameters: Type.Object({ objective: Type.String({ description: OBJECTIVE_DESCRIPTION }), token_budget: Type.Optional(Type.Integer({ description: BUDGET_DESCRIPTION })) }, { additionalProperties: false }),
    execute: async (_id, args, signal, _update, ctx) => {
      validateCall(args, ["objective", "token_budget"], signal);
      if (!args || Object.keys(args).some(key => !["objective", "token_budget"].includes(key)) || typeof args.objective !== "string" || !args.objective.trim() || [...args.objective.trim()].length > 4000) throw new Error("Goal objective must contain 1 to 4000 Unicode characters; additional properties are not allowed.");
      if (args.token_budget !== undefined && (!Number.isSafeInteger(args.token_budget) || args.token_budget <= 0)) throw new Error("Goal budgets must be positive safe integers when provided.");
      return response(await access.create(ctx, args.objective.trim(), args.token_budget));
    } });
  pi.registerTool({ ...goalRenderers("update_goal"), name: "update_goal", label: "Update goal", description: UPDATE_DESCRIPTION,
    parameters: Type.Object({ status: StringEnum(["complete", "blocked", "paused"] as const, { description: STATUS_DESCRIPTION }) }, { additionalProperties: false }),
    execute: async (_id, args, signal, _update, ctx) => {
      validateCall(args, ["status"], signal);
      if (args.status !== "complete" && args.status !== "blocked" && args.status !== "paused") throw new Error("Goal status must be complete, blocked, or paused.");
      return response(await access.update(ctx, args.status), args.status === "complete");
    } });
}
