import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Editor } from "@earendil-works/pi-tui";
import { findReferences } from "../dist/references.js";

const identity = value => value;
const theme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} };
const undoKey = "\x1b[45;5u";
const heapBudget = 128 * 1024 * 1024;

function sample(pasteBytes, nameLength) {
  const editor = new Editor(tui, theme);
  const paste = "x".repeat(pasteBytes);
  const reference = "$" + "a".repeat(nameLength);
  editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
  editor.insertTextAtCursor(` ${reference}.`);
  editor.handleInput("\x1b[D");
  const original = editor.getExpandedText();
  assert.equal(original, `${paste} ${reference}.`);
  assert.match(editor.getText(), /^\[paste #1 /);
  assert.deepEqual(findReferences(editor.getText()).map(value => value.name), [reference.slice(1)]);
  global.gc();
  const before = process.memoryUsage();
  let peakHeap = before.heapUsed, peakRss = before.rss, changes = 0;
  editor.onChange = () => { changes++; };
  const started = performance.now();
  // Reproduce the rejected probe strategy, not production behavior.
  for (let index = 0; index < reference.length; index++) {
    editor.handleInput("\x7f");
    const memory = process.memoryUsage();
    peakHeap = Math.max(peakHeap, memory.heapUsed);
    peakRss = Math.max(peakRss, memory.rss);
  }
  const elapsedMs = performance.now() - started;
  assert.equal(editor.getExpandedText(), `${paste} .`);
  editor.handleInput(undoKey);
  const oneUndoRestored = editor.getExpandedText() === original;
  let undoEvents = 1;
  while (editor.getExpandedText() !== original && undoEvents <= reference.length) {
    editor.handleInput(undoKey);
    undoEvents++;
  }
  assert.equal(editor.getExpandedText(), original);
  assert.equal(undoEvents, reference.length);
  editor.onChange = undefined;
  editor.setText("");
  return { elapsedMs, peakHeapDelta: peakHeap - before.heapUsed, peakRssDelta: peakRss - before.rss, peakRss, deletionChanges: changes - undoEvents, undoEvents, oneUndoRestored };
}

if (process.argv[2] === "--child") {
  const pasteBytes = Number(process.argv[3]), nameLength = Number(process.argv[4]);
  const first = sample(pasteBytes, nameLength);
  // Stop before larger/repeated allocations when the predeclared budget fails.
  if (first.peakHeapDelta > heapBudget) {
    console.log(JSON.stringify({ pasteBytes, nameLength, warmups: 0, samples: 1, stoppedAtBudget: true, ...first }));
  } else {
    for (let i = 0; i < 5; i++) sample(pasteBytes, nameLength);
    const samples = Array.from({ length: 20 }, () => sample(pasteBytes, nameLength));
    const times = samples.map(value => value.elapsedMs).sort((a, b) => a - b);
    console.log(JSON.stringify({ pasteBytes, nameLength, warmups: 5, samples: 20, stoppedAtBudget: false,
      medianMs: (times[9] + times[10]) / 2, maxMs: times.at(-1),
      peakHeapDelta: Math.max(...samples.map(value => value.peakHeapDelta)),
      peakRssDelta: Math.max(...samples.map(value => value.peakRssDelta)),
      peakRss: Math.max(...samples.map(value => value.peakRss)),
      undoEvents: first.undoEvents, oneUndoRestored: first.oneUndoRestored, deletionChanges: first.deletionChanges }));
  }
} else {
  const results = [];
  for (const [pasteBytes, nameLength] of [[1024 * 1024, 16], [1024 * 1024, 64], [10 * 1024 * 1024, 64]]) {
    const child = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), "--child", String(pasteBytes), String(nameLength)], { encoding: "utf8", timeout: 120_000 });
    assert.equal(child.status, 0, child.stderr);
    let exited = false;
    try { process.kill(child.pid, 0); } catch (error) { exited = error.code === "ESRCH"; }
    assert.equal(exited, true, "Audit child must be reaped before proceeding");
    results.push({ ...JSON.parse(child.stdout), pid: child.pid, exitCode: child.status, reaped: exited });
  }
  const output = { node: process.version, platform: process.platform, arch: process.arch, heapBudget, results,
    contractSatisfied: results.every(result => result.peakHeapDelta <= heapBudget && result.oneUndoRestored) };
  console.log(JSON.stringify(output, null, 2));
  if (process.argv.includes("--assert-contract")) assert.equal(output.contractSatisfied, true, "Per-character native deletion violates the atomic-edit cost and undo contract");
}
