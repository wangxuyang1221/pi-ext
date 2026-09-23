import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { loadRoles } from "../src/roles.js";

test("loads user JSONC roles with optional fields and ignores other directories and extensions", () => {
  const root = mkdtempSync(join(process.cwd(), ".sa-roles-"));
  try {
    mkdirSync(join(root, "agents"));
    mkdirSync(join(root, "agents", "nested"));
    writeFileSync(join(root, "agents", "worker.jsonc"), '// Defaults\n{"description":"Build things","model":"provider/org/model","thinkingLevel":"high","fast":false,}');
    writeFileSync(join(root, "agents", "empty.jsonc"), "{}");
    writeFileSync(join(root, "agents", "ignored.json"), "{}");
    writeFileSync(join(root, "agents", "nested", "ignored.jsonc"), "{}");
    const snapshot = loadRoles(root);
    assert.deepEqual([...snapshot.roles], [["empty", {}], ["worker", { description: "Build things", model: "provider/org/model", thinkingLevel: "high", fast: false }]]);
    assert.deepEqual(snapshot.diagnostics, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("isolates malformed roles and discards old values when a new snapshot is loaded", () => {
  const root = mkdtempSync(join(process.cwd(), ".sa-roles-"));
  try {
    assert.deepEqual([...loadRoles(root).roles], []);
    mkdirSync(join(root, "agents"));
    writeFileSync(join(root, "agents", "worker.jsonc"), '{"fast":true}');
    const previous = loadRoles(root);
    const invalid = {
      worker: '{"fast":"true"}', syntax: '{"fast":', array: "[]", nil: "null",
      description: '{"description":false}', model: '{"model":"short"}', thinking: '{"thinkingLevel":"extreme"}',
      instructions: '{"instructions":"Do this"}', unexpected: '{"extra":1}',
    };
    for (const [name, bytes] of Object.entries(invalid)) writeFileSync(join(root, "agents", `${name}.jsonc`), bytes);
    writeFileSync(join(root, "agents", "valid.jsonc"), "{}");
    const next = loadRoles(root);
    assert.deepEqual([...next.roles], [["valid", {}]]);
    assert.equal(next.diagnostics.length, Object.keys(invalid).length);
    for (const name of Object.keys(invalid)) assert.ok(next.diagnostics.some(message => message.includes(`${name}.jsonc:`) && message.split(":").at(-1)!.trim().length > 0));
    assert.equal(previous.roles.get("worker")?.fast, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
