import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entry = import.meta.resolve("@earendil-works/pi-tui");
const fixedCommit = "ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc";
const hash = text => createHash("sha256").update(text).digest("hex");
const sources = [];
for (const [local, remote] of [
  ["undo-stack.js.map", "packages/tui/src/undo-stack.ts"],
  ["components/editor.js.map", "packages/tui/src/components/editor.ts"],
]) {
  const map = JSON.parse(readFileSync(new URL(local, entry), "utf8"));
  assert.equal(map.sourcesContent.length, 1);
  const installed = map.sourcesContent[0];
  const official = execFileSync("gh", ["api", `repos/earendil-works/pi/contents/${remote}?ref=${fixedCommit}`, "-H", "Accept: application/vnd.github.raw+json"], { encoding: "utf8" });
  assert.equal(hash(installed), hash(official));
  sources.push({ local: fileURLToPath(new URL(local, entry)), official: `https://github.com/earendil-works/pi/blob/${fixedCommit}/${remote}`, sha256: hash(installed) });
}

// Isolated source audit only. UndoStack is not exported by the package entry.
// Product editing tests use only CustomEditor public methods, never its private stack.
const { UndoStack } = await import(new URL("undo-stack.js", entry).href);
const stack = new UndoStack();
const count = 4096;
for (let sequence = 0; sequence < count; sequence++) {
  const value = { sequence, nested: { value: sequence }, pastes: new Map([[1, `paste ${sequence}`]]) };
  stack.push(value);
  value.nested.value = -1;
  value.pastes.clear();
}
assert.equal(stack.length, count);
for (let sequence = count - 1; sequence >= 0; sequence--) {
  assert.deepEqual(stack.pop(), { sequence, nested: { value: sequence }, pastes: new Map([[1, `paste ${sequence}`]]) });
}
assert.equal(stack.length, 0);
assert.equal(stack.pop(), undefined);
for (let sequence = 0; sequence < count; sequence++) stack.push({ sequence });
stack.clear();
assert.equal(stack.length, 0);
assert.equal(stack.pop(), undefined);
const version = JSON.parse(readFileSync(new URL("../package.json", entry), "utf8")).version;
assert.equal(version, "0.86.0");
console.log(JSON.stringify({ node: process.version, piTui: version, fixedCommit, sources, pushed: count, poppedInOrder: count, deepCloneVerified: true, clearVerified: true, applicationLevelCapacity: null, eviction: "none" }, null, 2));
