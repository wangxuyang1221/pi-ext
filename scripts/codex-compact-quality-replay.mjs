// Offline integration audit against all four retained development continuations.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runContinuation } from "./codex-compact-quality-continuation.mjs";
import { assertRunDirectory } from "./codex-compact-quality-runner.mjs";
import { fingerprintWorkspace } from "./codex-compact-quality-tools.mjs";

const source = path.resolve(process.argv[2] ?? ".tmp/codex-quality/development-four-arm-v1");
const workspace = path.resolve(process.argv[3] ?? ".tmp/codex-quality/development-zarr-prefix-v1/workspace");
const output = path.resolve(process.argv[4] ?? ".tmp/codex-quality/development-replay-v1");
assertRunDirectory(path.dirname(output));
fs.mkdirSync(output);
const config = JSON.parse(fs.readFileSync(path.join(source, "configuration.json"), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const clean = body => { const clone = structuredClone(body); delete clone.prompt_cache_key; return clone; };
const results = [];
for (const arm of ["old", "new", "cli", "reference"]) {
  const directory = path.join(output, arm); fs.mkdirSync(directory);
  const recorded = JSON.parse(fs.readFileSync(path.join(source, arm, "result.json"), "utf8"));
  const first = JSON.parse(fs.readFileSync(path.join(source, arm, "request-0.json"), "utf8"));
  let requests = 0;
  const fingerprints = [];
  const result = await runContinuation({ directory, sourceWorkspace: workspace,
    expectedWorkspaceFingerprint: config.workspaceFingerprint,
    initialHistory: first.input.slice(0, -1), instructions: config.instructions, request: config.request,
    allowedPaths: ["zarr/util.py"], toolDefinitions: config.tools,
    send: async ({ body }) => {
      const original = fs.readFileSync(path.join(source, arm, `request-${requests}.json`));
      assert.deepEqual(clean(body), clean(JSON.parse(original)), "Continuation request differs from frozen development run");
      const bytes = fs.readFileSync(path.join(source, arm, `response-${requests}.sse`));
      fingerprints.push({ request: requests++, requestSha256: sha256(original), responseSha256: sha256(bytes) });
      return { ok: true, status: 200, wire: bytes.toString("utf8") };
    }
  });
  assert.equal(requests, recorded.requests);
  assert.equal(result.answer, recorded.answer);
  assert.deepEqual(result.tools, recorded.tools);
  assert.deepEqual(result.changedPaths, recorded.changedPaths);
  assert.deepEqual(fingerprintWorkspace(result.workspacePath), fingerprintWorkspace(path.join(source, arm, "workspace")));
  results.push({ arm, requests, requestAndOutputEquality: true, workspaceEquality: true, fingerprints });
}
const moduleFingerprints = Object.fromEntries(["runner", "continuation", "response", "tools", "metrics", "replay"].map(name => {
  const file = `scripts/codex-compact-quality-${name}.mjs`;
  return [file, sha256(fs.readFileSync(file))];
}));
fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ schemaVersion: 1, modelCalls: 0, newQualitySamples: 0, moduleFingerprints, results }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ arms: results.length, requests: results.reduce((sum, row) => sum + row.requests, 0), modelCalls: 0, identicalOutputs: true }));
