import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { CustomEditor, initTheme } from "@earendil-works/pi-coding-agent";
import { createLabelEditor, releaseLabelEditor } from "../dist/label-editor.js";

assert.equal(typeof global.gc, "function", "Run with --expose-gc");
initTheme("dark", false);
const same = text => text;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function collect() { await tick(); global.gc(); await tick(); global.gc(); return process.memoryUsage(); }
function fixture(name) {
  const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} };
  const base = new CustomEditor(tui, { borderColor: same, selectList: { selectedPrefix: same, selectedText: same, description: same, scrollInfo: same, noMatch: same } }, { matches: () => false });
  return createLabelEditor(base, { names: () => new Set([name]), icon: () => "cube", tui });
}
const summary = values => ({ medianMs: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)], maxMs: Math.max(...values) });
const results = [];
for (const count of [10, 100, 1000]) {
  const name = "abcdefgh", labels = Array(count).fill("$" + name).join(" ");
  const raw = "x ".repeat(Math.floor((100 * 1024 - labels.length - 1) / 2)) + " " + labels;
  const editor = fixture(name);
  for (const width of [8, 16, 80, 120]) {
    const cold = [], cached = [];
    for (let i = -5; i < 20; i++) {
      editor.setText(raw);
      let start = performance.now(); editor.render(width); const coldMs = performance.now() - start;
      start = performance.now(); editor.render(width); const cachedMs = performance.now() - start;
      if (i >= 0) { cold.push(coldMs); cached.push(cachedMs); }
      assert.equal(editor.getExpandedText(), raw);
    }
    results.push({ kind: "layout", bytes: raw.length, count, width, cold: summary(cold), cached: summary(cached), afterGC: await collect() });
  }
  releaseLabelEditor(editor);
}
for (const [pasteBytes, nameLength] of [[1024, 64], [1024, 256], [1024, 1024], [100 * 1024, 64], [1024 * 1024, 64]]) {
  const name = "a".repeat(nameLength), editor = fixture(name), paste = "p".repeat(pasteBytes);
  editor.handleInput(`\x1b[200~${paste}\x1b[201~`); editor.insertTextAtCursor(` $${name}`);
  const times = [], heaps = [], rss = [];
  for (let i = -5; i < 20; i++) {
    const before = await collect(), start = performance.now(); editor.handleInput("\x7f"); const duration = performance.now() - start;
    assert.equal(editor.getExpandedText(), paste + " ");
    const after = process.memoryUsage();
    if (i >= 0) { times.push(duration); heaps.push(after.heapUsed - before.heapUsed); rss.push(after.rss - before.rss); }
    editor.handleInput("\x1b[45;5u"); assert.equal(editor.getExpandedText(), paste + ` $${name}`);
  }
  editor.handleInput("\r");
  results.push({ kind: "delete-undo", pasteBytes, nameLength, ...summary(times), observedHeapDelta: Math.max(...heaps), observedRssDelta: Math.max(...rss), submittedAfterGC: await collect() });
  releaseLabelEditor(editor);
}
let disposable = fixture("alpha");
disposable.handleInput(`\x1b[200~${"x".repeat(32768)}\x1b[201~`); disposable.insertTextAtCursor(" $alpha"); disposable.handleInput("\x7f");
const reference = new WeakRef(disposable); releaseLabelEditor(disposable); disposable = undefined;
await collect(); assert.equal(reference.deref(), undefined);
console.log(JSON.stringify({ node: process.version, pid: process.pid, warmup: 5, samples: 20, results, releasedEditor: true, notes: "Boundary samples are not allocation peaks; RSS need not shrink. No destructive/OOM workload was attempted." }, null, 2));
