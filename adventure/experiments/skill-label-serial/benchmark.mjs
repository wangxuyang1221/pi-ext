import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CustomEditor } from "@earendil-works/pi-coding-agent";

const modulePath = process.argv[2];
if (!modulePath) throw new Error("Provide the compiled editor.js path");
const { SerialEditorProbe } = await import(pathToFileURL(modulePath).href);
const identity = value => value;
const theme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} };
const budget = 128 * 1024 * 1024;

async function sample(bytes) {
  const base = new CustomEditor(tui, theme, { matches: () => false });
  const name = "a".repeat(64), payload = "x".repeat(bytes);
  const editor = new SerialEditorProbe(base, new Set([name]));
  await editor.pasteAtEnd(payload);
  await editor.insertAtEnd(` $${name}`);
  const original = editor.getExpandedText();
  assert.equal(original, `${payload} $${name}`);
  global.gc();
  const before = process.memoryUsage();
  let peakHeap = before.heapUsed, peakRss = before.rss, changes = 0;
  editor.onChange = () => { changes++; };
  const record = () => { const memory = process.memoryUsage(); peakHeap = Math.max(peakHeap, memory.heapUsed); peakRss = Math.max(peakRss, memory.rss); };
  const start = performance.now();
  editor.handleInput("\x7f");
  assert.equal(editor.getExpandedText(), `${payload} `);
  assert.equal(changes, 1);
  record();
  await editor.settled();
  const elapsedMs = performance.now() - start;
  record();
  assert.equal(base.getExpandedText(), `${payload} `);
  editor.handleInput("\x1b[45;5u");
  assert.equal(editor.getExpandedText(), original);
  await editor.settled();
  assert.equal(base.getExpandedText(), original);
  assert.equal(changes, 2);
  await editor.dispose();
  return { elapsedMs, peakHeapDelta: peakHeap - before.heapUsed, peakRssDelta: peakRss - before.rss, peakRss, userUndoEvents: 1 };
}

if (process.argv[3] === "--child") {
  const bytes = Number(process.argv[4]);
  const first = await sample(bytes);
  assert.ok(first.peakHeapDelta <= budget && first.peakRssDelta <= budget, "Stop at the predeclared memory budget");
  for (let i = 0; i < 5; i++) await sample(bytes);
  const samples = [];
  for (let i = 0; i < 20; i++) samples.push(await sample(bytes));
  const times = samples.map(value => value.elapsedMs).sort((a, b) => a - b);
  console.log(JSON.stringify({ bytes, nameLength: 64, warmups: 5, samples: 20,
    medianMs: (times[9] + times[10]) / 2, maxMs: times.at(-1),
    peakHeapDelta: Math.max(...samples.map(value => value.peakHeapDelta)),
    peakRssDelta: Math.max(...samples.map(value => value.peakRssDelta)),
    peakRss: Math.max(...samples.map(value => value.peakRss)), userUndoEvents: 1 }));
} else {
  const results = [];
  for (const bytes of [1024 * 1024, 10 * 1024 * 1024]) {
    const child = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), modulePath, "--child", String(bytes)], { encoding: "utf8", timeout: 120_000 });
    assert.equal(child.status, 0, child.stderr);
    let reaped = false;
    try { process.kill(child.pid, 0); } catch (error) { reaped = error.code === "ESRCH"; }
    assert.equal(reaped, true);
    const result = JSON.parse(child.stdout);
    assert.ok(result.peakHeapDelta <= budget && result.peakRssDelta <= budget);
    results.push({ ...result, pid: child.pid, exitCode: child.status, reaped });
  }
  console.log(JSON.stringify({ node: process.version, arch: process.arch, budget, results }, null, 2));
}
