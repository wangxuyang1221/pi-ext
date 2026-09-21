import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const modulePath = process.argv[2];
if (!modulePath) throw new Error("Provide the compiled probe.js path");
const { createEditor, deleteReference, paste, undoGroup, undoKey } = await import(pathToFileURL(modulePath).href);
const tick = () => new Promise(resolve => setImmediate(resolve));
const bytes = 32 * 1024;
const nameLength = 64;
const groupCount = 3;

async function collect() {
  for (let i = 0; i < 3; i++) { await tick(); global.gc(); }
  return process.memoryUsage();
}

async function measure(mode) {
  assert.equal(typeof global.gc, "function");
  let editor = createEditor();
  const payload = "p".repeat(bytes), name = "a".repeat(nameLength);
  paste(editor, payload);
  editor.insertTextAtCursor(` $${name} $${name} $${name}`);
  const original = editor.getExpandedText();
  const points = [{ stage: "seeded-after-gc", ...await collect() }];
  const groups = [];
  let deleteMs = 0;
  for (let i = 0; i < groupCount; i++) {
    const start = performance.now();
    groups.push(deleteReference(editor, "backward"));
    deleteMs += performance.now() - start;
    if (i < groupCount - 1) { editor.handleInput("\x7f"); groups.push({ steps: 1 }); }
    points.push({ stage: `group-${i + 1}-after-gc`, ...await collect() });
  }
  assert.equal(editor.getExpandedText(), `${payload} `);
  const nativeDeletionSteps = groups.reduce((sum, group) => sum + group.steps, 0);
  assert.equal(nativeDeletionSteps, 197);
  let releasedEditor, submittedBytes;
  if (mode === "undo") {
    while (groups.length) undoGroup(editor, groups.pop());
    assert.equal(editor.getExpandedText(), original);
    points.push({ stage: "groups-popped-after-gc", ...await collect() });
    editor.handleInput(undoKey); editor.handleInput(undoKey);
    assert.equal(editor.getText(), "");
    points.push({ stage: "seed-history-popped-after-gc", ...await collect() });
  } else if (mode === "setText") {
    editor.setText("");
    assert.equal(editor.getText(), "");
    points.push({ stage: "setText-empty-after-gc", ...await collect() });
    editor.handleInput(undoKey);
    assert.equal(editor.getExpandedText(), `${payload} `);
    while (groups.length) undoGroup(editor, groups.pop());
    assert.equal(editor.getExpandedText(), original);
    points.push({ stage: "clear-and-groups-undone-after-gc", ...await collect() });
  } else if (mode === "submit") {
    editor.onSubmit = text => { assert.equal(text, payload); submittedBytes = text.length; };
    editor.handleInput("\r");
    assert.equal(submittedBytes, bytes);
    for (let i = 0; i < nativeDeletionSteps + 3; i++) editor.handleInput(undoKey);
    assert.equal(editor.getExpandedText(), "");
    editor.onSubmit = undefined;
    points.push({ stage: "submitted-after-gc", ...await collect() });
  } else if (mode === "drop") {
    const reference = new WeakRef(editor);
    editor = undefined;
    points.push({ stage: "editor-dropped-after-gc", ...await collect() });
    releasedEditor = reference.deref() === undefined;
  } else throw new Error(`Unknown mode: ${mode}`);
  return { mode, bytes, nameLength, groupCount, nativeDeletionSteps, deleteMs, points, releasedEditor, submittedBytes };
}

if (process.argv[3] === "--child") {
  console.log(JSON.stringify(await measure(process.argv[4])));
} else {
  const results = [];
  for (const mode of ["undo", "setText", "submit", "drop"]) {
    const child = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), modulePath, "--child", mode], { encoding: "utf8", timeout: 60_000 });
    assert.equal(child.status, 0, child.stderr);
    let reaped = false;
    try { process.kill(child.pid, 0); } catch (error) { reaped = error.code === "ESRCH"; }
    assert.equal(reaped, true);
    results.push({ ...JSON.parse(child.stdout), pid: child.pid, exitCode: child.status, reaped });
  }
  console.log(JSON.stringify({ node: process.version, arch: process.arch, results }, null, 2));
}
