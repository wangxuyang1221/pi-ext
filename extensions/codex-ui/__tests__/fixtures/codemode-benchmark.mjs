import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { CodemodeStore } from "../../dist/codemode-model.js";
import { CodemodePresentation } from "../../dist/codemode-presentation.js";
import { renderCodemodeTree } from "../../dist/codemode-view.js";

// No model, filesystem tool or network calls. Timings are observations, not pass thresholds.
const theme = { fg: (_name, text) => text, bold: text => text };
const measured = fn => { const start = performance.now(); fn(); return +(performance.now() - start).toFixed(3); };
const rows = [];
for (const count of [24, 256, 1024]) for (const outputBytes of [1024, 1024 * 1024]) {
  const store = new CodemodeStore();
  const payload = "output\n".repeat(Math.ceil(outputBytes / 7)).slice(0, outputBytes);
  const ingestMs = measured(() => {
    store.event({ type: "tool_execution_start", toolCallId: "p", toolName: "codemode", args: { code: "// benchmark" } });
    for (let i = 0; i < count; i++) {
      const event = { toolName: "fixture", toolCallId: `p/${i}`, parentToolCallId: "p" };
      store.event({ ...event, type: "tool_execution_start", args: { path: `file-${i}.txt` } });
      store.event({ ...event, type: "tool_execution_end", result: { content: [{ type: "text", text: payload }] } });
    }
    store.event({ type: "tool_execution_end", toolCallId: "p", toolName: "codemode", result: { content: [] } });
  });
  const row = store.latest();
  assert.equal(row.calls.length, count);
  let bodyPreparations = 0;
  renderCodemodeTree(row, { theme, width: 120, expanded: false, child: () => { bodyPreparations++; return []; } });
  assert.equal(bodyPreparations, 0);
  const presentation = new CodemodePresentation(store, new Map());
  const coldTreeMs = measured(() => presentation.tree(row, theme, 120, true, "/fixture", "ctrl+o"));
  const hotTreeMs = measured(() => presentation.tree(row, theme, 120, true, "/fixture", "ctrl+o"));
  const state = { tab: "Calls", selected: count - 1, scroll: 0 };
  let detail;
  const coldInspectMs = measured(() => { detail = presentation.detail(row, state, theme, 80, "/fixture"); });
  const hotInspectMs = measured(() => {
    assert.equal(presentation.detail(row, { ...state, scroll: 20 }, theme, 80, "/fixture"), detail);
  });
  assert.ok(store.results.bytes <= store.results.budget);
  const stats = presentation.stats();
  assert.ok(stats.layouts.chargedBytes <= stats.layouts.limitBytes);
  rows.push({ count, outputBytes, ingestMs, coldTreeMs, hotTreeMs, coldInspectMs, hotInspectMs,
    retainedResults: store.results.size, resultBytes: store.results.bytes, layoutBytes: stats.layouts.chargedBytes });
  store.clear(); presentation.clear();
  assert.equal(store.results.bytes, 0);
  assert.equal(store.size, 0);
  assert.equal(presentation.stats().layouts.chargedBytes, 0);
}
console.log(JSON.stringify({ node: process.version, pi: "1.3.0", rows }, null, 2));
