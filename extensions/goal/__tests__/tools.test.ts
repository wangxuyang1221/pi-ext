import { expect, it, vi } from "vitest";
import { Check } from "typebox/value";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { registerGoalTools, renderGoalPrompt } from "../src/tools.js";
import type { GoalRecord } from "../src/storage.js";
const record: GoalRecord = { schemaVersion: 1, recordId: "r", ownerSessionId: "s", cwd: "/test", sessionFile: "/test/session", revision: 1, generation: 1, continuationDeferral: false, recoveredFrom: null,
  goal: { goalId: "g", generation: 1, objective: "A<&> {{ tokens_used }}", status: "active", tokensUsed: 12, tokenBudget: 10, elapsedSeconds: 5, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } };
it("rejects invalid wire budgets before host integer coercion can change their meaning", () => {
  const tools = new Map<string, any>();
  const handlers = new Map<string, (event: any) => unknown>();
  registerGoalTools({ on: (name: string, handler: (event: any) => unknown) => handlers.set(name, handler), registerTool: (tool: any) => tools.set(tool.name, tool) } as unknown as ExtensionAPI,
    { get: async () => record, create: async () => record, update: async () => record });
  for (const budget of [1.5, "2", true]) {
    const call = { type: "toolCall" as const, id: "wire", name: "create_goal", arguments: { objective: "x", token_budget: budget } };
    handlers.get("message_end")!({ message: { role: "assistant", content: [call] } });
    const args = validateToolArguments(tools.get("create_goal"), call);
    expect(Number.isSafeInteger(args.token_budget)).toBe(true);
    expect(handlers.get("tool_call")!({ toolName: "create_goal", toolCallId: "wire", input: args })).toEqual({ block: true, reason: "Goal budgets must be positive safe integers when provided." });
  }
  handlers.get("message_end")!({ message: { role: "assistant", content: [{ type: "toolCall", id: "valid", name: "create_goal", arguments: { objective: "x", token_budget: 2 } }] } });
  expect(handlers.get("tool_call")!({ toolName: "create_goal", toolCallId: "valid", input: { objective: "x", token_budget: 2 } })).toBeUndefined();
});
it("accepts a user-requested pause and returns the persisted status", async () => {
  const tools = new Map<string, any>();
  const update = vi.fn(async () => ({ ...record, goal: { ...record.goal!, status: "budget_limited" as const } }));
  registerGoalTools({ on: () => {}, registerTool: (tool: any) => tools.set(tool.name, tool) } as unknown as ExtensionAPI, { get: async () => record, create: async () => record, update });
  const tool = tools.get("update_goal");
  expect(Check(tool.parameters, { status: "paused" })).toBe(true);
  const result = await tool.execute("pause", { status: "paused" }, undefined, undefined, {});
  expect(update).toHaveBeenCalledWith({}, "paused");
  expect(result.details.goal.status).toBe("budget_limited");
  expect(tool.description).toContain("explicit request");
});
it("validates Unicode objectives and safe positive budgets before calling the store", async () => {
  const tools = new Map<string, any>();
  const create = vi.fn(async () => record);
  registerGoalTools({ on: () => {}, registerTool: (tool: any) => tools.set(tool.name, tool) } as unknown as ExtensionAPI, { get: async () => record, create, update: async () => record });
  const run = (args: unknown) => tools.get("create_goal").execute("id", args, undefined, undefined, {});
  for (const args of [{ objective: " " }, { objective: "😀".repeat(4001) }, { objective: "x", token_budget: 0 }, { objective: "x", token_budget: 1.5 }, { objective: "x", token_budget: Number.MAX_SAFE_INTEGER + 1 }, { objective: "x", extra: true }]) await expect(run(args)).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
  await run({ objective: "  " + "😀".repeat(4000) + " ", token_budget: 1 });
  expect(create).toHaveBeenCalledWith({}, "😀".repeat(4000), 1);
});
it("rejects extra get/update arguments and cancelled invocations before storage access", async () => {
  const tools = new Map<string, any>();
  const access = { get: vi.fn(async () => record), create: vi.fn(async () => record), update: vi.fn(async () => record) };
  registerGoalTools({ on: () => {}, registerTool: (tool: any) => tools.set(tool.name, tool) } as unknown as ExtensionAPI, access);
  for (const [name, args] of [["get_goal", { extra: 1 }], ["get_goal", null], ["get_goal", []], ["update_goal", { status: "active" }], ["update_goal", { status: "complete", extra: 1 }], ["update_goal", null]] as const) {
    await expect(tools.get(name).execute("id", args, undefined, undefined, {})).rejects.toThrow();
  }
  const signal = AbortSignal.abort();
  for (const [name, args] of [["get_goal", {}], ["create_goal", { objective: "x" }], ["update_goal", { status: "complete" }]] as const) await expect(tools.get(name).execute("id", args, signal, undefined, {})).rejects.toThrow();
  for (const fn of Object.values(access)) expect(fn).not.toHaveBeenCalled();
});
it("exposes only the three upstream goal schemas and reports persisted usage with escaped prompts", async () => {
  const tools = new Map<string, any>();
  const get = vi.fn(async () => record);
  const create = vi.fn(async () => record);
  const update = vi.fn(async () => record);
  registerGoalTools({ on: () => {}, registerTool: (tool: any) => tools.set(tool.name, tool) } as unknown as ExtensionAPI, { get, create, update });
  expect([...tools.keys()]).toEqual(["get_goal", "create_goal", "update_goal"]);
  for (const [name, args] of [["get_goal", {}], ["create_goal", { objective: "x", token_budget: 1 }], ["update_goal", { status: "complete" }]] as const) {
    expect(Check(tools.get(name).parameters, args)).toBe(true);
    expect(Check(tools.get(name).parameters, { ...args, extra: 1 })).toBe(false);
  }
  for (const status of ["active", "usage_limited", "budget_limited"]) expect(Check(tools.get("update_goal").parameters, { status })).toBe(false);
  const response = await tools.get("get_goal").execute("id", {}, undefined, undefined, {});
  expect(JSON.parse(response.content[0].text)).toMatchObject({ remainingTokens: 0, completionBudgetReport: null, goal: { threadId: "s", tokensUsed: 12, timeUsedSeconds: 5, tokenBudget: 10 } });
  const prompt = renderGoalPrompt(record.goal!);
  expect(prompt).toContain("A&lt;&amp;&gt; {{ tokens_used }}");
  expect(prompt).toContain("- Tokens used: 12");
  expect(prompt).toContain("Completion audit:");
  expect(prompt).toContain("at least three consecutive goal turns");
});
