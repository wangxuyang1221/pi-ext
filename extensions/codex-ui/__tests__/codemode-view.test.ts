import assert from "node:assert/strict";
import { test } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CodemodeStore } from "../src/codemode-model.js";
import { renderCodemodeTree, treeCalls } from "../src/codemode-view.js";
import { CodemodePresentation } from "../src/codemode-presentation.js";
const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text } as Theme;
function fixture() {
  const store = new CodemodeStore(); store.event({ type: "tool_execution_start", toolName: "codemode", toolCallId: "p", args: { code: "SCRIPT_SOURCE" } });
  for (let i = 0; i < 24; i++) {
    store.event({ type: "tool_execution_start", toolName: "read", toolCallId: `p/${i}`, parentToolCallId: "p", args: { path: `文件-${i}.ts` } });
    store.event({ type: "tool_execution_end", toolName: "read", toolCallId: `p/${i}`, parentToolCallId: "p", isError: i === 6, result: { content: [{ type: "text", text: i === 6 ? "denied\nsecond line" : "SOURCE" }] } });
  }
  store.event({ type: "tool_execution_end", toolName: "codemode", toolCallId: "p", isError: false, result: { content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\nPAYLOAD" }] } });
  return store;
}
test("collapsed tree shows five calls and keeps a later failure visible without rendering hidden bodies", () => {
  const store = fixture();
  const lines = renderCodemodeTree(store.get("p")!, { theme, width: 120, expanded: false });
  const text = lines.join("\n");
  assert.match(text, /Script completed/); assert.match(text, /19 more calls/); assert.match(text, /文件-6.ts.*denied/);
  assert.match(text, /PAYLOAD/); assert.doesNotMatch(text, /SOURCE|SCRIPT_SOURCE|文件-23/);
  assert.ok(lines.every(line => !line.includes("\n")));
});

test("output preview marks a clipped long line even on a wide terminal", () => {
  const store = fixture();
  store.get("p")!.output = "x".repeat(3000);
  const lines = renderCodemodeTree(store.get("p")!, { theme, width: 4096, expanded: false });
  assert.ok(lines.some(line => line === `    ${"x".repeat(2048)}…`));
});

test("tree preserves parent ownership when a sibling starts before a descendant", () => {
  const store = new CodemodeStore();
  store.event({ type: "tool_execution_start", toolName: "codemode", toolCallId: "p" });
  for (const [id, parentToolCallId] of [["p/1", "p"], ["p/2", "p"], ["p/1/1", "p/1"]]) store.event({ type: "tool_execution_start", toolName: "read", toolCallId: id, parentToolCallId, args: {} });
  assert.deepEqual(treeCalls(store.get("p")!, 3).map(call => call.id), ["p/1", "p/1/1", "p/2"]);
});

test("tree fits narrow terminals and does not prepare collapsed child bodies", () => {
  const store = fixture(); let prepared = 0;
  for (const width of [0, 1, 24, 40, 80, 120]) for (const expanded of [false, true]) {
    const lines = renderCodemodeTree(store.get("p")!, { theme, width, expanded, child: () => { prepared++; return ["x".repeat(1000)]; } });
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
  assert.equal(prepared, 24 * 5);
});

test("expanded Bash uses the native expanded output rather than its three-line preview", () => {
  const store = new CodemodeStore();
  store.event({ type: "tool_execution_start", toolName: "codemode", toolCallId: "p" });
  store.event({ type: "tool_execution_start", toolName: "bash", toolCallId: "p/1", parentToolCallId: "p", args: { command: "printf fixture" } });
  store.event({ type: "tool_execution_end", toolName: "bash", toolCallId: "p/1", parentToolCallId: "p", result: { content: [{ type: "text", text: "first\nsecond\nthird\nfourth\nfifth" }] } });
  const presentation = new CodemodePresentation(store, new Map());
  assert.match(presentation.tree(store.get("p")!, theme, 80, true, "/repo", "ctrl+o").join("\n"), /fifth/);
});

test("a child update preserves cached sibling bodies", () => {
  const store = new CodemodeStore();
  store.event({ type: "tool_execution_start", toolName: "codemode", toolCallId: "p" });
  for (const id of ["p/1", "p/2"]) store.event({ type: "tool_execution_start", toolName: "custom", toolCallId: id, parentToolCallId: "p", args: {} });
  const presentation = new CodemodePresentation(store, new Map());
  const row = store.get("p")!;
  const sibling = presentation.child(row.calls[0], 80, theme, "/repo");
  const changed = presentation.child(row.calls[1], 80, theme, "/repo");
  store.event({ type: "tool_execution_update", toolName: "custom", toolCallId: "p/2", parentToolCallId: "p", partialResult: { content: [{ type: "text", text: "updated" }] } });
  assert.equal(presentation.child(row.calls[0], 80, theme, "/repo"), sibling);
  assert.notEqual(presentation.child(row.calls[1], 80, theme, "/repo"), changed);
});

test("hot child and inspector renders reuse preparation, and low power does not retain stale styles", () => {
  const store = fixture(); let low = false;
  const presentation = new CodemodePresentation(store, new Map(), () => low);
  const row = store.get("p")!;
  const before = presentation.child(row.calls[0], 80, theme, "/repo");
  assert.equal(presentation.child(row.calls[0], 80, theme, "/repo"), before);
  const state = { tab: "Calls" as const, selected: 0, scroll: 0 };
  const first = presentation.detail(row, state, theme, 80, "/repo");
  assert.equal(presentation.detail(row, { ...state, scroll: 100 }, theme, 80, "/repo"), first);
  const hits = presentation.stats().layouts.hits;
  assert.ok(hits >= 2);
  low = true;
  assert.notEqual(presentation.child(row.calls[0], 80, theme, "/repo"), before);
  store.results.clear();
  assert.match(presentation.child(row.calls[0], 80, theme, "/repo").join("\n"), /Raw result unavailable/);
  assert.ok(presentation.stats().layouts.chargedBytes <= presentation.stats().layouts.limitBytes);
});
