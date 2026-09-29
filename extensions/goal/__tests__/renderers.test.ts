import { beforeAll, expect, it, vi } from "vitest";
import { initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { registerGoalTools } from "../src/tools.js";
import type { GoalRecord } from "../src/storage.js";

beforeAll(() => initTheme("dark"));
const record: GoalRecord = { schemaVersion: 1, recordId: "r", ownerSessionId: "test-session", cwd: "/test", sessionFile: "/test/session", revision: 1, generation: 1, continuationDeferral: false, recoveredFrom: null,
  goal: { goalId: "g", generation: 1, objective: "统一 Goal 工具 UI", status: "complete", tokensUsed: 12480, tokenBudget: 50000, elapsedSeconds: 192, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:03:12Z" } };
function tools(value: GoalRecord | undefined = record) {
  const registered = new Map<string, ToolDefinition<any, any>>();
  registerGoalTools({ registerTool: (tool: ToolDefinition<any, any>) => registered.set(tool.name, tool) } as ExtensionAPI,
    { get: async () => value, create: async () => value!, update: async () => value! });
  return registered;
}
function host(tool: ToolDefinition<any, any>, args = {}) {
  const row = new ToolExecutionComponent(tool.name, "test", args, { showImages: false }, tool, { requestRender() {} } as any, process.cwd());
  row.setArgsComplete(); row.markExecutionStarted();
  return row;
}
const plain = (row: ToolExecutionComponent, width = 100) => row.render(width).map(stripTerminalSequences).join("\n");
async function completed(name = "update_goal", value: GoalRecord | undefined = record) {
  const tool = tools(value).get(name)!;
  const args = name === "update_goal" ? { status: "complete" } : name === "create_goal" ? { objective: "request" } : {};
  const result = await tool.execute("test", args, undefined, undefined, {} as any);
  const row = host(tool, args);
  row.updateResult({ ...result, isError: false });
  return { row, result };
}
it("reuses two row-local components across redraws and refreshes theme, width and snapshots", async () => {
  const tool = tools().get("update_goal")!;
  const execute = vi.spyOn(tool, "execute");
  const result = await tool.execute("test", { status: "complete" }, undefined, undefined, {} as any);
  const row = host(tool, { status: "complete" }); row.updateResult({ ...result, isError: false });
  const internals = row as any;
  const call = internals.callRendererComponent;
  const output = internals.resultRendererComponent;
  const stateKeys = Object.keys(internals.rendererState).sort();
  const before = row.render(80).join("\n");
  const snapshot = JSON.stringify(result);
  for (let index = 0; index < 1000; index++) {
    row.setExpanded(index % 2 === 0); row.invalidate(); row.render([40, 80, 120][index % 3]!);
    expect(internals.callRendererComponent).toBe(call);
    expect(internals.resultRendererComponent).toBe(output);
    expect(Object.keys(internals.rendererState).sort()).toEqual(stateKeys);
  }
  expect(execute).toHaveBeenCalledTimes(1);
  row.setExpanded(false);
  initTheme("light"); row.invalidate();
  expect(row.render(80).join("\n")).not.toBe(before);
  expect(plain(row)).toContain("Updated goal · Complete");
  initTheme("dark"); row.invalidate();
  expect(row.render(80).join("\n")).toBe(before);
  const later = structuredClone(record); later.goal!.status = "blocked"; later.goal!.objective = "Later goal";
  await completed("update_goal", later);
  expect(plain(row)).not.toContain("Later goal"); expect(plain(row)).toContain("Complete");
  expect(JSON.stringify(result)).toBe(snapshot);
});
it("falls back safely for malformed details and sanitizes only display text at every width", async () => {
  const { row, result } = await completed();
  const hostile = "中文🙂\u001b[2J\u001b]52;c;YQ==\u0007\u009b2J\u202e".repeat(80) + "\nLAST-MARKER";
  result.details.goal.objective = hostile;
  result.details.usageVisibility = "incomplete: reported tokens include only observed usage";
  const snapshot = JSON.stringify(result);
  row.updateResult({ ...result, isError: false });
  for (const expanded of [false, true]) {
    row.setExpanded(expanded);
    for (const width of [0, 1, 2, 4, 8, 12, 40, 80, 120]) {
      const lines = row.render(width);
      expect(lines.every(line => visibleWidth(line) <= width), `Overflow at ${width}`).toBe(true);
      expect(lines.join("\n")).not.toMatch(/\u001b\[2J|\u001b\]52|[\u0007\u009b\u202e]/u);
      if (width >= 40) expect(plain(row, width)).toContain("Observed usage only");
    }
    if (expanded) expect(plain(row, 40)).toContain("LAST-MARKER");
    else expect(plain(row, 40)).not.toContain("LAST-MARKER");
  }
  expect(JSON.stringify(result)).toBe(snapshot);
  const invalid = [undefined, null, [], "oops", {}, { goal: {} }, { ...result.details, goal: { ...result.details.goal, createdAt: 1e100 } }, { ...result.details, goal: { ...result.details.goal, tokensUsed: NaN } }, { ...result.details, goal: { ...result.details.goal, status: "unknown" } }, { ...result.details, remainingTokens: "0" }];
  for (const details of invalid) {
    row.updateResult({ content: [{ type: "text", text: "Fallback\u001b[2J\n" + "detail\n".repeat(200) + "END" }], details, isError: false });
    row.setExpanded(false);
    expect(plain(row)).toContain("Fallback"); expect(plain(row)).not.toMatch(/No goal|NaN|Invalid Date|tokens ·/);
    expect(row.render(40).length).toBeLessThanOrEqual(5);
    row.setExpanded(true); expect(plain(row)).toContain("END");
    expect(row.render(40).join("\n")).not.toContain("\u001b[2J");
  }
  row.updateResult({ content: [], details: {}, isError: false });
  expect(plain(row)).toContain("Result unavailable");
});
it("separates invocation lifecycle from every goal status and recognizes only exact cancellation", async () => {
  const theme = getThemeByName("dark")!;
  const tool = tools().get("update_goal")!;
  const row = host(tool, { status: "paused" });
  expect(plain(row)).toContain("Updating goal");
  expect(row.render(100).join("\n")).toContain(theme.fg("warning", "⏺"));
  for (const [status, label] of [["active", "Active"], ["paused", "Paused"], ["blocked", "Blocked"], ["complete", "Complete"], ["budget_limited", "Budget limited"], ["usage_limited", "Usage limited"]] as const) {
    const value = structuredClone(record); value.goal!.status = status;
    const result = (await completed("get_goal", value)).result;
    row.updateResult({ ...result, isError: false });
    expect(plain(row)).toContain(`Updated goal · ${label}`);
    expect(row.render(100).join("\n")).toContain(theme.fg("success", "⏺"));
  }
  for (const [text, title, color] of [["Operation cancelled by remote database.\nSecond line", "failed", "error"], ["Goal tool invocation was cancelled.", "interrupted", "warning"]] as const) {
    row.updateResult({ content: [{ type: "text", text }], details: undefined, isError: true });
    expect(plain(row)).toContain(`Update goal ${title}`);
    expect(row.render(100).join("\n")).toContain(theme.fg(color, "⏺"));
    expect(plain(row)).not.toContain("Second line");
    row.setExpanded(true); expect(plain(row)).toContain(text.split("\n").at(-1)); row.setExpanded(false);
  }
  row.updateResult({ content: [{ type: "text", text: "progress" }], details: undefined, isError: false }, true);
  expect(plain(row)).toContain("Updating goal"); expect(plain(row)).toContain("Working…");
  const empty = host(tools().get("get_goal")!);
  empty.updateResult({ content: [], details: { goal: null }, isError: false });
  expect(plain(empty)).toContain("Read goal"); expect(plain(empty)).toContain("No goal");
});
it("expands exact snapshot fields and keeps unbounded and incomplete usage explicit", async () => {
  const value = structuredClone(record);
  value.goal!.objective = "First line\n最后一行🙂";
  value.goal!.usageIncomplete = true;
  delete value.goal!.tokenBudget;
  const { row } = await completed("get_goal", value);
  expect(plain(row)).toContain("12.5k tokens · 3m 12s");
  expect(plain(row)).toContain("Observed usage only");
  row.setExpanded(true);
  for (const field of ["First line", "最后一行🙂", "Status: Complete", "Tokens: 12,480 · No budget", "Remaining: Unbounded", "Elapsed: 3m 12s", "Thread: test-session", "Created: 2026-01-01T00:00:00.000Z", "Updated: 2026-01-01T00:03:12.000Z", "Observed usage only"]) expect(plain(row)).toContain(field);
  expect(plain(row)).not.toContain("Report final usage");
  const budgeted = (await completed()).row;
  budgeted.setExpanded(true);
  expect(plain(budgeted)).toContain("Tokens: 12,480 / 50,000");
  expect(plain(budgeted)).toContain("Remaining: 37,520");
  budgeted.setExpanded(false);
  expect(plain(budgeted)).not.toContain("Thread:");
});
it("renders the three registered tools as summary without changing model results", async () => {
  for (const [name, title] of [["get_goal", "Read goal"], ["create_goal", "Created goal"], ["update_goal", "Updated goal"]]) {
    const { row, result } = await completed(name);
    const snapshot = JSON.stringify(result);
    expect(plain(row)).toContain(`⏺ ${title} · Complete`);
    expect(plain(row)).toContain("⎿  统一 Goal 工具 UI");
    expect(plain(row)).toContain("12.5k / 50k tokens · 3m 12s");
    expect(plain(row)).not.toMatch(/threadId|completionBudgetReport/);
    expect(JSON.parse(result.content[0].text)).toEqual(result.details);
    expect(JSON.stringify(result)).toBe(snapshot);
  }
});
