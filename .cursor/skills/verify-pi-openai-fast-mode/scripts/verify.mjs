import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestEnvironment } from "../../../../test-support/environment.mjs";
import { inspectPiHost } from "../../../../scripts/pi-host.mjs";
import { stopProcessGroup } from "../../../../scripts/codex-compact-quality-process.mjs";
import { archiveEvidence, stopRecordedPtyOwners } from "../../verify-pi-ext/scripts/runtime-support.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const options = process.argv.slice(2);
const mode = options[0] && !options[0].startsWith("--") ? options.shift() : "full";
assert.ok(["full", "smoke"].includes(mode), "Usage: verify.mjs [full|smoke] [--timeout-ms <number>] [--python <absolute-path>]");
let timeoutMs = 180_000, pythonPath;
while (options.length) {
  const name = options.shift(), value = options.shift();
  if (name === "--timeout-ms") {
    timeoutMs = Number(value);
    assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 900_000, "Invalid timeout deadline");
  } else if (name === "--python") {
    assert.ok(typeof value === "string" && isAbsolute(value), "Python path must be absolute");
    pythonPath = value;
  } else throw new Error(`Unknown option: ${name}`);
}
const results = resolve(".tmp/test-results");
mkdirSync(results, { recursive: true });
const evidence = mkdtempSync(join(results, "verify-fast-requests-"));
const summary = { mode, evidence, timeoutMs, pid: process.pid, status: "failed", cleanup: "pending" };
const summaryPath = join(evidence, "summary.json");
const ownersPath = join(evidence, "owners.json");
const save = () => writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
const abort = new AbortController();
const stop = signal => {
  summary.interrupted = signal;
  abort.abort(new Error(`Verification interrupted: ${signal}`));
};
const terminate = () => stop("SIGTERM");
const interrupt = () => stop("SIGINT");
process.on("SIGTERM", terminate);
process.on("SIGINT", interrupt);
let child, directory;
try {
  summary.host = inspectPiHost();
  const isolated = createTestEnvironment("fast-requests");
  directory = isolated.directory;
  const env = isolated.env;
  summary.scratch = directory;
  save();
  console.log(JSON.stringify({ evidence, scratch: directory }));
  // Resolve Conda's Python once, then signal the actual PTY owner directly.
  pythonPath ??= execFileSync("conda", ["run", "-n", "codex-py312", "python", "-c", "import sys, pyte; print(sys.executable)"], { encoding: "utf8", timeout: 30_000 }).trim();
  const args = [join(scripts, "drive.py"), directory, evidence, mode];
  summary.command = [pythonPath, ...args];
  writeFileSync(ownersPath, JSON.stringify({ driverPid: null, pids: [] }));
  child = spawn(pythonPath, args, { env: { ...env, PI_FAST_VERIFY_ROOT: directory }, stdio: "inherit", detached: true });
  summary.driverPid = child.pid;
  save();
  const deadline = AbortSignal.timeout(timeoutMs);
  let exitCode, signal;
  try {
    [exitCode, signal] = await once(child, "exit", { signal: AbortSignal.any([abort.signal, deadline]) });
  } catch (error) {
    if (deadline.aborted) summary.timedOut = true;
    throw error;
  }
  Object.assign(summary, { exitCode, signal });
  assert.equal(exitCode, 0, "Fast verification driver failed");
  const journey = JSON.parse(readFileSync(join(evidence, "journey.json"), "utf8"));
  assert.equal(journey.passed, true, "Fast verification assertions failed");
  assert.equal(journey.processStopped, true, "Fast verification PTY cleanup was not recorded");
  summary.status = "passed";
} catch (error) {
  summary.status = "failed";
  summary.error = String(error);
} finally {
  const cleanupErrors = [];
  const stage = async (name, action) => {
    try { await action(); } catch (error) { cleanupErrors.push({ stage: name, error: String(error) }); }
  };
  await stage("driver-group", async () => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    summary.process = child?.pid ? await stopProcessGroup(child, { graceMs: 2000, killWaitMs: 3000 }) : { groupStopped: true, spawned: false };
  });
  await stage("pty-groups", async () => {
    if (!child?.pid) return;
    const owners = JSON.parse(readFileSync(ownersPath, "utf8"));
    assert.ok(owners.driverPid === child.pid || (owners.driverPid === null && owners.pids.length === 0), "PTY owner manifest belongs to another driver");
    summary.ptyGroups = await stopRecordedPtyOwners(owners.pids);
    for (const pid of owners.pids) {
      try { process.kill(pid, 0); throw new Error(`Recorded PTY process is still alive: ${pid}`); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  });
  await stage("archive", async () => {
    summary.archive = archiveEvidence({ repo: resolve(scripts, "../../../.."), scratch: directory, evidence, before: new Map(), selected: "journey" });
    assert.equal(summary.archive.errors.length, 0, "Fast verification evidence archive incomplete");
  });
  if (cleanupErrors.length === 0) await stage("scratch", async () => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  summary.cleanup = cleanupErrors.length === 0 ? "removed" : "unverified";
  if (cleanupErrors.length) {
    summary.cleanupErrors = cleanupErrors;
    summary.status = "failed";
  }
  Object.assign(summary, { exitCode: child?.exitCode ?? summary.exitCode, signal: child?.signalCode ?? summary.signal });
  process.off("SIGTERM", terminate);
  process.off("SIGINT", interrupt);
  save();
  process.exitCode = summary.status === "passed" ? 0 : 1;
}
console.log(JSON.stringify(summary));
