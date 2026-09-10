import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const archive = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
const fromArchive = path => execFileSync("tar", ["-xOf", archive, `package/${path}`], { encoding: "utf8" });
const manifest = JSON.parse(fromArchive("package.json"));
assert.equal(manifest.pi.extensions.length, 7);
assert.equal(manifest.license, "(MIT AND Apache-2.0)");
const files = ["LICENSE", "extensions/goal/LICENSE", "extensions/goal/NOTICE", "extensions/goal/UPSTREAM.md",
  "docs/goal-storage-acceptance.md", "docs/goal-lifecycle-acceptance.md", "docs/goal-execution-report.md", "docs/goal-budget-acceptance.md",
  "docs/goal-descendant-acceptance.md", "docs/goal-ui-acceptance.md", "docs/goal-integration-acceptance.md", "docs/goal-provider-support.md",
  ...manifest.pi.extensions.map(entry => entry.replace(/^\.\//, ""))];
for (const path of files) assert.ok(entries.includes(`package/${path}`), `Missing archive file: ${path}`);
assert.match(fromArchive("extensions/goal/LICENSE"), /Apache License[\s\S]*Version 2\.0/);
assert.match(fromArchive("extensions/goal/NOTICE"), /OpenAI Codex\nCopyright 2025 OpenAI/);
assert.match(fromArchive("extensions/goal/UPSTREAM.md"), /3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/);
assert.match(fromArchive("extensions/goal/dist/upstream.js"), /Copyright 2025 OpenAI/);
assert.ok(entries.every(entry => !/(?:^|\/)(?:__tests__|\.scratch|node_modules|prototypes|adventure)(?:\/|$)/.test(entry)), "Archive must exclude tests, dependencies, and local evidence");
const bytes = await readFile(archive);
const result = { passed: true, archive, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, fileCount: entries.length, entries, requiredFiles: files };
await writeFile(output, JSON.stringify(result, null, 2));
console.log(`Verified ${entries.length} archive entries and both license attributions`);
