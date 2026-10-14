import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createSearchRenderers } from "../src/renderers.mjs";
const themes = await import(pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")));
const theme = themes.loadThemeFromPath(resolve("themes/codex-pi.json"), "truecolor");
themes.setThemeInstance(theme);
const args = { queries: ["Anthropic 争议言论与官方回应", "Claude model welfare", "AI safety", "Scaling policy", "Other query"], freshness: "live", search_context_size: "high" };
const result = (overrides = {}) => ({ content: [{ type: "text", text: "Offline search fixture" }], isError: false,
  details: { status: "completed", total: 5, completed: 5, failed: 0, elapsedMs: 6000, sources: [{ title: "Fixture source", url: "https://example.com/source" }], ...overrides } });
function row() {
  const tool = { name: "codex_search", ...createSearchRenderers() };
  return new ToolExecutionComponent(tool.name, "test-search", args, { showImages: false }, tool, { requestRender() {} }, process.cwd());
}
const plain = (tool, width = 100) => tool.render(width).map(stripTerminalSequences);

test("batch suffix uses the singular noun for one additional query", () => {
  const tool = { name: "codex_search", ...createSearchRenderers() };
  const cell = new ToolExecutionComponent(tool.name, "pair", { queries: ["One", "Two"] }, { showImages: false }, tool, { requestRender() {} }, process.cwd());
  cell.updateResult(result({ total: 2 }));
  assert.match(plain(cell)[1], /\+1 query\)/);
});

test("completed search uses two compact lines and only the host leading blank", () => {
  const tool = row(); tool.updateResult(result());
  const lines = plain(tool);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "");
  assert.match(lines[1], /^⌕ Searched web .*\+4 queries/);
  assert.match(lines[2], /^  └ 1 source · 5 queries · 6s/);
  assert(!lines.join("\n").includes("responses/high/live"));
  const adjacent = [...lines, ...lines];
  assert.equal(adjacent.slice(3, 5).filter(line => !line.trim()).length, 1);
});

test("progress updates in place and partial failures remain visible on narrow terminals", () => {
  const tool = row(); tool.markExecutionStarted();
  tool.updateResult(result({ status: "running", completed: 2, elapsedMs: 2000 }), true);
  assert.match(plain(tool)[2], /2\/5 queries completed/);
  tool.updateResult(result({ status: "partial", completed: 5, failed: 1 }));
  assert.match(plain(tool, 40)[2], /4\/5 succeeded · 1 failed/);
  assert(tool.render(40)[1].includes(theme.fg("warning", "⌕")));
  for (const status of ["timed_out", "interrupted", "failed"]) {
    tool.updateResult(result({ status, message: status === "timed_out" ? "Request timed out" : "Fixture stopped" }));
    assert.match(plain(tool).join("\n"), status === "timed_out" ? /Request timed out/ : /Fixture stopped/);
    assert(tool.render(100)[1].includes(theme.fg(status === "failed" ? "error" : "warning", "⌕")));
  }
  for (const width of [1, 12, 24, 40, 80, 120]) assert(tool.render(width).every(line => visibleWidth(line) <= width));
});

test("native expansion reveals full queries and source URLs without boundary padding", () => {
  const tool = row(); tool.updateResult(result()); tool.setExpanded(true);
  const lines = plain(tool, 40);
  assert.match(lines.join("\n"), /Claude model welfare/);
  assert.match(lines.join("\n"), /https:\/\/example.com\/source/);
  assert.match(lines.join("\n"), /responses · high · live/);
  assert(lines.at(-1).trim());
  assert(tool.render(40).every(line => visibleWidth(line) <= 40));
  tool.setExpanded(false);
  assert.equal(plain(tool).length, 3);
});
