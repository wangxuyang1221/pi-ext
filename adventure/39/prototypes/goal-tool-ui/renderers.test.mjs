import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { decorateGoalTool } from "./renderers.mjs";

initTheme("dark");
const details = {
  goal: { objective: "统一 Goal 工具 UI", status: "complete", tokensUsed: 12480, tokenBudget: 50000,
    timeUsedSeconds: 192, threadId: "fixture-session", createdAt: 1770000000, updatedAt: 1770000192 },
  remainingTokens: 37520, usageVisibility: "observed", completionBudgetReport: "Report final usage.",
};
const result = { content: [{ type: "text", text: JSON.stringify(details) }], details };
const base = { name: "update_goal", label: "Update goal", parameters: {}, description: "Original description", execute: async () => result };
function host(tool, args = { status: "complete" }) {
  const row = new ToolExecutionComponent(tool.name, "test", args, { showImages: false }, tool, { requestRender() {} }, process.cwd());
  row.setArgsComplete(); row.markExecutionStarted();
  return row;
}
const plain = (row, width = 100) => row.render(width).map(stripTerminalSequences).join("\n");

test("summary replaces default JSON without changing execution or payload", async () => {
  const tool = decorateGoalTool(base, { density: "summary" });
  assert.equal(tool.execute, base.execute);
  assert.equal(tool.parameters, base.parameters);
  assert.equal(tool.description, base.description);
  assert.equal(await tool.execute(), result);
  const row = host(tool);
  row.updateResult({ ...result, isError: false });
  const text = plain(row);
  assert.match(text, /⏺ Updated goal · Complete/);
  assert.match(text, /⎿  统一 Goal 工具 UI/);
  assert.match(text, /12\.5k \/ 50k tokens · 3m 12s/);
  assert.doesNotMatch(text, /"threadId"|completionBudgetReport/);
});

test("switching density updates existing rows while expansion keeps exact details", () => {
  const preferences = { density: "summary" };
  const row = host(decorateGoalTool(base, preferences));
  row.updateResult({ ...result, isError: false });
  assert.match(plain(row), /tokens/);
  preferences.density = "minimal";
  row.invalidate();
  assert.doesNotMatch(plain(row), /tokens/);
  assert.match(plain(row), /统一 Goal 工具 UI/);
  row.setExpanded(true);
  assert.match(plain(row), /Tokens: 12,480 \/ 50,000/);
  assert.match(plain(row), /Remaining: 37,520/);
  assert.match(plain(row), /Thread: fixture-session/);
  row.setExpanded(false);
  assert.doesNotMatch(plain(row), /Thread:|Tokens:/);
});

test("errors, empty results, running calls and hostile long text remain readable at narrow widths", () => {
  const tool = decorateGoalTool(base, { density: "summary" });
  const row = host(tool);
  assert.match(plain(row), /Updating goal/);
  row.updateResult({ content: [{ type: "text", text: "No goal exists.\nCreate a goal first." }], details: undefined, isError: true });
  assert.match(plain(row), /Update goal failed/);
  assert.match(plain(row), /No goal exists/);
  assert.doesNotMatch(plain(row), /Create a goal first/);
  row.setExpanded(true);
  assert.match(plain(row), /Create a goal first/);
  const empty = host(decorateGoalTool({ ...base, name: "get_goal" }, { density: "summary" }), {});
  empty.updateResult({ content: [], details: { goal: null }, isError: false });
  assert.match(plain(empty), /Read goal/);
  assert.match(plain(empty), /No goal/);
  const long = structuredClone(result);
  long.details.goal.objective = "中文🙂\x1b[2J\x07".repeat(80) + " LAST-MARKER";
  long.details.usageVisibility = "incomplete: reported tokens include only observed usage";
  const snapshot = JSON.stringify(long);
  row.updateResult({ ...long, isError: false });
  row.setExpanded(false);
  assert.match(plain(row), /Observed usage only/);
  row.setExpanded(true);
  for (const width of [1, 4, 12, 40, 80, 120]) {
    const lines = row.render(width);
    assert.ok(lines.every(line => visibleWidth(line) <= width), `Overflow at ${width}`);
    assert.ok(lines.every(line => !line.includes("\x1b[2J") && !line.includes("\x07")), "Unsafe terminal sequences");
  }
  assert.match(plain(row, 40), /LAST-MARKER/);
  assert.equal(JSON.stringify(long), snapshot);
});

test("rerendering retains one invalidator per row for live variant switching", () => {
  const preferences = { density: "summary", rows: new Set() };
  const row = host(decorateGoalTool(base, preferences));
  row.updateResult({ ...result, isError: false });
  for (let n = 0; n < 20; n++) { row.invalidate(); row.render(100); }
  assert.equal(preferences.rows.size, 1);
});
