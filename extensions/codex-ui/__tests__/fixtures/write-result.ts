import assert from "node:assert/strict";
import type { CodexWriteChange } from "../../src/write-changes.js";

export function hasWriteChange(result: { details: unknown }): boolean {
  return typeof result.details === "object" && result.details !== null && "codexWrite" in result.details;
}

export function writeChange(result: { details: unknown }): CodexWriteChange {
  assert.ok(hasWriteChange(result), "Expected persisted Write metadata");
  const change = (result.details as { codexWrite: unknown }).codexWrite;
  assert.ok(typeof change === "object" && change !== null && "version" in change);
  assert.equal(change.version, 1);
  return change as CodexWriteChange;
}

export function writePatch(result: { details: unknown }): string {
  const patch = writeChange(result).patch;
  assert.equal(typeof patch, "string", "Expected a captured Write patch");
  return patch!;
}
