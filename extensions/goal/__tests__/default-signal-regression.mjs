import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stopRecordedPtyOwners } from "../../../.cursor/skills/verify-pi-ext/scripts/runtime-support.mjs";
const evidence = mkdtempSync(resolve(".tmp/test-results/goal-default-signal-"));
const results = [];
async function until(probe, label, duration = 25000) {
  const deadline = performance.now() + duration;
  while (performance.now() < deadline) { const value = probe(); if (value) return value; await delay(20); }
  throw new Error(`Timed out: ${label}`);
}
for (const journey of ["lifecycle", "footer"]) {
  const output = join(evidence, journey); mkdirSync(output);
  let logs = "", run, summary;
  const child = spawn(process.execPath, ["extensions/goal/__tests__/verification.mjs", journey], { env: { ...process.env, PI_VERIFY_EVIDENCE: output }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", value => logs += value); child.stderr.on("data", value => logs += value);
  const closed = once(child, "close");
  try {
    run = await until(() => {
      const folder = readdirSync(output).find(name => name.startsWith(`goal-${journey}-`));
      if (!folder) return;
      try {
        const value = JSON.parse(readFileSync(join(output, folder, "summary.json")));
        if (!value.scratch) return;
        const root = join(value.scratch, "case");
        if (journey === "footer" && existsSync(join(root, "footer-ready.json"))) return value;
        if (journey === "lifecycle" && existsSync(join(root, "events-create.jsonl")) && readFileSync(join(root, "events-create.jsonl"), "utf8").includes('"label":"created"')) return value;
      } catch { return; }
    }, `${journey} ordinary TUI readiness`);
    const ownersBefore = JSON.parse(readFileSync(join(run.scratch, "case/owned-pty-pids.json")));
    assert.ok(ownersBefore.length > 0);
    process.kill(child.pid, "SIGTERM");
    let timer;
    let outcome;
    try { outcome = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Default SIGTERM cleanup exceeded deadline")), 12000); })]); }
    finally { clearTimeout(timer); }
    summary = JSON.parse(readFileSync(join(run.evidence, "summary.json")));
    assert.equal(outcome[0], 1); assert.equal(summary.interruptedBy, "SIGTERM"); assert.equal(summary.status, "failed");
    assert.equal(summary.cleanup, "removed"); assert.deepEqual(summary.alivePids, []); assert.equal(summary.listeningPorts, "");
    const proof = join(run.evidence, "proof");
    assert.ok(existsSync(join(proof, "actions.json"))); assert.ok(existsSync(join(proof, "screens.json")));
    assert.ok(JSON.parse(readFileSync(join(proof, "actions.json"))).length > 0);
    assert.ok(readFileSync(join(proof, journey === "footer" ? "terminal.ansi" : "terminal-create.ansi")).length > 0);
    assert.ok(readFileSync(join(proof, "signals.jsonl"), "utf8").includes('"signal": 15'));
    const sessions = journey === "footer" ? join(proof, "fixture/sessions") : join(proof, "sessions");
    const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(directory, item.name)) : [join(directory, item.name)]);
    assert.ok(walk(sessions).some(path => path.endsWith(".jsonl") && readFileSync(path).length));
    assert.ok(ownersBefore.every(pid => summary.fixturePids.includes(pid)));
    results.push({ journey, passed: true, ownersRecordedBeforeSignal: ownersBefore, summary });
  } finally {
    writeFileSync(join(output, "outer-output.log"), logs);
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
    const ownerFile = run?.scratch && join(run.scratch, "case/owned-pty-pids.json");
    if (ownerFile && existsSync(ownerFile)) await stopRecordedPtyOwners(JSON.parse(readFileSync(ownerFile)));
  }
}
const windowEvidence = join(evidence, "fork-window"); mkdirSync(windowEvidence);
let windowExit;
try { execFileSync("conda", ["run", "--no-capture-output", "-n", "codex-py312", "python", "extensions/goal/__tests__/signal-window-fixture.py", windowEvidence], { timeout: 12000, stdio: "pipe" }); }
catch (error) { windowExit = error.status; writeFileSync(join(windowEvidence, "output.log"), String(error.stderr ?? error)); }
assert.equal(windowExit, 143);
const windowOwners = JSON.parse(readFileSync(join(windowEvidence, "owned-pty-pids.json")));
assert.equal(windowOwners.length, 1);
assert.equal(JSON.parse(readFileSync(join(windowEvidence, "signal-cleanup.json"))).groupStopped, true);
for (const pid of windowOwners) assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH");
writeFileSync(join(evidence, "summary.json"), JSON.stringify({ passed: true, evidence, results, forkWindow: { passed: true, exitCode: windowExit, owners: windowOwners } }, null, 2));
console.log(JSON.stringify({ passed: true, evidence, journeys: results.map(value => value.journey), forkWindow: true }));
