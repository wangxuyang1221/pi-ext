import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runVerification } from "./verification.mjs";
import { stopRecordedPtyOwners } from "../../../.cursor/skills/verify-pi-ext/scripts/runtime-support.mjs";
const evidence = mkdtempSync(resolve(".tmp/test-results/goal-runner-regression-"));
const signalEvidence = join(evidence, "signal"); mkdirSync(signalEvidence);
let child, signalSummary;
async function until(probe, label, milliseconds = 20000) {
  const end = performance.now() + milliseconds;
  while (performance.now() < end) { const value = probe(); if (value) return value; await delay(20); }
  throw new Error(`Timed out: ${label}`);
}
try {
  let output = "";
  child = spawn(process.execPath, ["extensions/goal/__tests__/verification.mjs", "matrix", "signal"], { env: { ...process.env, PI_VERIFY_EVIDENCE: signalEvidence }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", value => output += value); child.stderr.on("data", value => output += value);
  const closed = once(child, "close");
  const run = await until(() => {
    const name = readdirSync(signalEvidence).find(name => name.startsWith("goal-matrix-"));
    if (!name) return;
    try { const summary = JSON.parse(readFileSync(join(signalEvidence, name, "summary.json"))); if (summary.scratch && existsSync(join(summary.scratch, "case/signal-ready.json"))) return summary; }
    catch { return; }
  }, "real TUI readiness");
  const started = performance.now();
  process.kill(child.pid, "SIGTERM");
  let timer;
  let result;
  try { result = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("SIGTERM cleanup exceeded deadline")), 12000); })]); }
  finally { clearTimeout(timer); }
  writeFileSync(join(signalEvidence, "outer-output.log"), output);
  signalSummary = JSON.parse(readFileSync(join(run.evidence, "summary.json")));
  assert.equal(result[0], 1); assert.equal(signalSummary.status, "failed"); assert.equal(signalSummary.interruptedBy, "SIGTERM");
  assert.equal(signalSummary.cleanup, "removed"); assert.deepEqual(signalSummary.alivePids, []); assert.equal(signalSummary.listeningPorts, "");
  assert.equal(signalSummary.forcedDriverStop, true); assert.equal(signalSummary.process.groupStopped, true); assert.equal(signalSummary.owners.groupStopped, true);
  assert.ok(existsSync(join(run.evidence, "proof/terminal-create.ansi"))); assert.ok(existsSync(join(run.evidence, "proof/events-create.jsonl")));
  signalSummary.cleanupDurationMs = performance.now() - started;
  process.env.PI_VERIFY_EVIDENCE = join(evidence, "failure");
  const failure = await runVerification({ journey: "matrix", scenario: "invalid-regression-scenario", copyProof: () => { throw new Error("Injected proof copy failure"); } });
  assert.equal(failure.status, "failed"); assert.equal(failure.cleanup, "unverified"); assert.ok(failure.artifactErrors.some(message => message.includes("Injected proof copy failure")));
  assert.ok(existsSync(failure.scratch)); assert.ok(existsSync(join(failure.evidence, "output.log"))); assert.ok(existsSync(join(failure.evidence, "summary.json")));
  assert.deepEqual(failure.alivePids, []); assert.equal(failure.listeningPorts, "");
  cpSync(join(failure.scratch, "case"), join(failure.evidence, "recovered-proof"), { recursive: true });
  assert.ok(existsSync(join(failure.evidence, "recovered-proof/terminal-create.ansi")));
  rmSync(failure.scratch, { recursive: true, force: true });
  writeFileSync(join(failure.evidence, "postcheck.json"), JSON.stringify({ expectedRetentionVerified: true, recoveredProof: "recovered-proof", scratchRemovedAfterRecovery: true, alivePids: [] }, null, 2));
  const report = { passed: true, evidence, signal: signalSummary, failure, cleanup: "removed-after-evidence-recovery" };
  writeFileSync(join(evidence, "summary.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
  if (signalSummary?.fixturePids?.length) await stopRecordedPtyOwners(signalSummary.fixturePids);
  for (const name of readdirSync(signalEvidence)) {
    const path = join(signalEvidence, name, "summary.json");
    if (!existsSync(path)) continue;
    const run = JSON.parse(readFileSync(path));
    const owners = run.scratch && join(run.scratch, "case/pids.json");
    if (owners && existsSync(owners)) await stopRecordedPtyOwners(JSON.parse(readFileSync(owners)));
  }
}
