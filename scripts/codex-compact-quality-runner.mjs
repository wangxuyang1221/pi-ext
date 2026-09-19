// Frozen schedules and immutable attempt records for the quality experiment.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Non-JSON object in schedule data");
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  throw new Error("Non-JSON schedule data");
}
const digest = value => createHash("sha256").update(canonical(value)).digest("hex");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function requireHash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid SHA-256 fingerprint");
}

export function makeSchedule(specification) {
  const config = structuredClone(specification);
  for (const key of ["seed", "model", "effort", "track"]) {
    if (typeof config[key] !== "string" || !config[key].trim()) throw new Error(`Missing schedule ${key}`);
  }
  for (const key of ["compactionRepeats", "continuationRepeats"]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`Invalid ${key}`);
  }
  if (config.compactionCycles !== undefined) {
    if (!Number.isSafeInteger(config.compactionCycles) || config.compactionCycles < 2) throw new Error("Invalid compactionCycles");
    if (config.continuationRepeats !== 1) throw new Error("Chain runs require one continuation per cycle; independent chains use compactionRepeats");
  }
  if (!Array.isArray(config.tasks) || config.tasks.length === 0) throw new Error("Empty task set");
  for (const arm of ["old", "new", "cli"]) requireHash(config.versions?.[arm]);
  const tasks = new Set(), units = new Set();
  for (const task of config.tasks) {
    for (const key of ["id", "independenceId"]) if (typeof task[key] !== "string" || !task[key].trim()) throw new Error(`Missing task ${key}`);
    requireHash(task.inputSha256);
    if (tasks.has(task.id) || units.has(task.independenceId)) throw new Error("Duplicate task or independence unit");
    tasks.add(task.id); units.add(task.independenceId);
  }
  config.tasks.sort((a, b) => compare(a.id, b.id));
  const pending = [];
  for (const task of config.tasks) for (const arm of ["old", "new", "cli", "reference"]) {
    for (let compactionRepeat = 0; compactionRepeat < config.compactionRepeats; compactionRepeat++) {
      const common = { taskId: task.id, independenceId: task.independenceId, inputSha256: task.inputSha256, arm, compactionRepeat };
      let previous = null;
      for (let cycle = 0; cycle < (config.compactionCycles ?? 1); cycle++) {
        const stage = { ...common, ...(config.compactionCycles ? { compactionCycle: cycle } : {}) };
        const compact = { ...stage, phase: arm === "reference" ? "prepare_reference" : "compaction", continuationRepeat: null, dependsOn: previous };
        compact.id = digest(compact);
        pending.push(compact);
        for (let continuationRepeat = 0; continuationRepeat < config.continuationRepeats; continuationRepeat++) {
          const continuation = { ...stage, phase: "continuation", continuationRepeat, dependsOn: compact.id };
          continuation.id = digest(continuation);
          pending.push(continuation);
          previous = continuation.id;
        }
      }
    }
  }
  // The seeded priority is independent of model outcomes; dependencies remain first.
  pending.sort((a, b) => compare(digest([config.seed, a.id]), digest([config.seed, b.id])));
  const jobs = [];
  const seen = new Set();
  while (pending.length) {
    const index = pending.findIndex(job => job.dependsOn === null || seen.has(job.dependsOn));
    if (index < 0) throw new Error("Cyclic schedule");
    const [job] = pending.splice(index, 1);
    jobs.push(job); seen.add(job.id);
  }
  const schedule = { schemaVersion: 1, specification: config, jobs };
  return { ...schedule, sha256: digest(schedule) };
}

function writeRecord(file, payload) {
  const temporary = `${file}.${randomUUID()}.pending`;
  const bytes = JSON.stringify({ sha256: digest(payload), payload }) + "\n";
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    // Linking a fully written file provides an exclusive, atomic publication.
    fs.linkSync(temporary, file);
  } finally { fs.unlinkSync(temporary); }
}

function readRecord(file) {
  assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), "Invalid record path");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(digest(record.payload), record.sha256, "Changed record fingerprint");
  return record.payload;
}

export function assertRunDirectory(directory) {
  const resolved = fs.realpathSync(directory);
  const cwd = fs.realpathSync(process.cwd());
  const relative = path.relative(cwd, resolved);
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "Run directory must stay inside the repository");
  assert.ok(!fs.lstatSync(directory).isSymbolicLink(), "Run directory cannot be a symlink");
  return resolved;
}

function observeOwner(owner) {
  if (owner.hostname !== os.hostname()) return "unresolved";
  try { process.kill(owner.pid, 0); return "running"; }
  catch (error) { if (error.code === "ESRCH") return "unresolved"; if (error.code === "EPERM") return "running"; throw error; }
}

function inspectRegisteredProcesses(directory, jobs) {
  const resources = [];
  for (const job of jobs) for (const adapter of ["plugin", "cli"]) {
    const file = path.join(directory, job.id, adapter, "process.json");
    if (!fs.existsSync(file)) continue;
    assert.equal(fs.realpathSync(file), file, "Invalid resource journal path");
    const resource = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(Number.isSafeInteger(resource.pid) && resource.pid > 1, "Invalid resource PID");
    assert.equal(resource.hostname, os.hostname(), "Registered resource host cannot be verified");
    for (const pid of [resource.pid, -resource.pid]) {
      let absent = false;
      try { process.kill(pid, 0); }
      catch (error) { if (error.code === "ESRCH") absent = true; else if (error.code !== "EPERM") throw error; }
      assert.ok(absent, "Registered resource is still live or inaccessible");
    }
    resources.push({ path: path.relative(directory, file), resource, state: "absent" });
  }
  return resources;
}

/** Quarantines an interrupted attempt; it never restarts a request or asserts remote completion. */
export function reconcileInterruptedSchedule({ directory, reason }) {
  directory = assertRunDirectory(directory);
  assert.ok(typeof reason === "string" && reason.trim(), "An explicit reconciliation reason is required");
  const leaseFile = path.join(directory, "active.json");
  if (!fs.existsSync(leaseFile)) return { status: "no-active-owner" };
  const owner = readRecord(leaseFile);
  if (owner.hostname !== os.hostname()) return { status: "unresolved", reason: "Owner host cannot be verified", owner };
  if (observeOwner(owner) === "running") return { status: "running", owner };
  const schedule = readRecord(path.join(directory, "schedule.json"));
  assert.equal(canonical(makeSchedule(schedule.specification)), canonical(schedule), "Changed recovery schedule");
  assert.equal(owner.scheduleSha256, schedule.sha256, "Recovery owner schedule mismatch");
  const resources = inspectRegisteredProcesses(directory, schedule.jobs);
  const interrupted = [];
  for (const job of schedule.jobs) {
    const folder = path.join(directory, job.id);
    if (!fs.existsSync(folder)) continue;
    assert.equal(fs.realpathSync(folder), folder, "Invalid recovery job path");
    const resultFile = path.join(folder, "result.json"), claimFile = path.join(folder, "claim.json");
    if (fs.existsSync(resultFile)) {
      const result = readRecord(resultFile);
      assert.equal(result.jobId, job.id, "Recovery result job mismatch");
      assert.equal(result.scheduleSha256, schedule.sha256, "Recovery result schedule mismatch");
      assert.ok(["completed", "failed", "dependency_failed"].includes(result.status), "Recovery result is not terminal");
      continue;
    }
    if (!fs.existsSync(claimFile)) continue;
    const claim = readRecord(claimFile);
    assert.equal(claim.owner.id, owner.id, "Recovery claim owner mismatch");
    assert.equal(claim.scheduleSha256, schedule.sha256, "Recovery claim schedule mismatch");
    assert.equal(claim.jobId, job.id, "Recovery claim job mismatch");
    const owned = resources.filter(row => row.path.startsWith(job.id + path.sep) && row.resource.ownerPid === owner.pid);
    const inOwnerOnly = schedule.specification.adapterMode === "maintained" && ["prepare_reference", "continuation"].includes(job.phase);
    if (owned.length === 0 && !inOwnerOnly) return { status: "unresolved", reason: "Missing registered resource boundary for interrupted job", jobId: job.id, owner };
    interrupted.push({ jobId: job.id, claimSha256: digest(claim) });
  }
  const audit = { id: randomUUID(), pid: process.pid, hostname: os.hostname(), scheduleSha256: schedule.sha256, reason: reason.trim(), owner, resources, interrupted, at: new Date().toISOString() };
  const auditLease = path.join(directory, "reconciliation-active.json");
  try { writeRecord(auditLease, { id: audit.id, pid: audit.pid, hostname: audit.hostname }); }
  catch (error) { if (error.code !== "EEXIST") throw error; const active = readRecord(auditLease); return { status: observeOwner(active), owner: active }; }
  try {
    assert.equal(readRecord(leaseFile).id, owner.id, "Recovery ownership changed");
    const archive = path.join(directory, "reconciliations"); fs.mkdirSync(archive, { recursive: true });
    assert.equal(fs.realpathSync(archive), archive, "Invalid recovery archive path");
    writeRecord(path.join(archive, `${audit.id}.planned.json`), audit);
    const removedCredentials = [];
    for (const row of resources) {
      const adapterDirectory = path.dirname(path.join(directory, row.path));
      const home = path.basename(adapterDirectory) === "plugin" ? "pi-home" : "codex-home";
      const auth = path.join(adapterDirectory, home, "auth.json");
      if (!fs.existsSync(auth)) continue;
      assert.equal(fs.realpathSync(auth), auth, "Invalid credential copy path");
      assert.ok(fs.lstatSync(auth).isFile(), "Invalid credential copy");
      fs.unlinkSync(auth); removedCredentials.push(path.relative(directory, auth));
    }
    for (const item of interrupted) writeRecord(path.join(directory, item.jobId, "result.json"), {
      jobId: item.jobId, scheduleSha256: schedule.sha256, ownerId: owner.id, elapsedMs: null, status: "failed",
      error: { name: "InterruptedAttempt", message: "Owner exited without a terminal result; upstream completion and usage are unknown" },
      recovery: { auditId: audit.id, claimSha256: item.claimSha256, upstreamStatus: "unknown", usageComplete: false },
    });
    writeRecord(path.join(archive, `${audit.id}.owner.json`), owner);
    assert.equal(readRecord(leaseFile).id, owner.id, "Recovery ownership changed before release");
    fs.unlinkSync(leaseFile);
    const result = { status: "reconciled", auditId: audit.id, interruptedJobIds: interrupted.map(item => item.jobId), removedCredentials };
    writeRecord(path.join(archive, `${audit.id}.completed.json`), result);
    return result;
  } finally {
    assert.equal(readRecord(auditLease).id, audit.id, "Reconciliation ownership changed");
    fs.unlinkSync(auditLease);
  }
}

function snapshotCompletedRun(directory) {
  directory = assertRunDirectory(directory);
  assert.ok(!fs.existsSync(path.join(directory, "active.json")) && !fs.existsSync(path.join(directory, "reconciliation-active.json")), "Source run has unresolved ownership");
  const schedule = readRecord(path.join(directory, "schedule.json"));
  assert.equal(canonical(makeSchedule(schedule.specification)), canonical(schedule), "Changed source schedule");
  const resources = inspectRegisteredProcesses(directory, schedule.jobs);
  const results = schedule.jobs.map(job => {
    const folder = path.join(directory, job.id);
    assert.equal(fs.realpathSync(folder), folder, "Invalid source job path");
    const result = readRecord(path.join(folder, "result.json"));
    assert.equal(result.scheduleSha256, schedule.sha256, "Source result schedule mismatch");
    assert.equal(result.jobId, job.id, "Source result job mismatch");
    assert.ok(["completed", "failed", "dependency_failed"].includes(result.status), "Source attempt is not terminal");
    return result;
  });
  return { directory, schedule, results, resources, sha256: digest({ schedule, results, resources }) };
}

/** Explicit diagnostic attempt. Primary failures remain immutable in the source run. */
export function makeRetrySchedule({ sourceDirectory, retryJobIds, reason, executorFingerprints = null }) {
  const source = snapshotCompletedRun(sourceDirectory);
  assert.ok(typeof reason === "string" && reason.trim(), "An explicit retry reason is required");
  assert.ok(Array.isArray(retryJobIds) && retryJobIds.length > 0 && new Set(retryJobIds).size === retryJobIds.length, "Invalid retry selection");
  if (executorFingerprints !== null) {
    assert.ok(executorFingerprints && typeof executorFingerprints === "object" && !Array.isArray(executorFingerprints), "Invalid retry executor fingerprints");
    Object.values(executorFingerprints).forEach(requireHash);
  }
  const selected = new Set(retryJobIds);
  for (const id of selected) assert.equal(source.results.find(row => row.jobId === id)?.status, "failed", "Only failed jobs may be explicitly retried");
  for (const job of source.schedule.jobs) if (selected.has(job.dependsOn)) selected.add(job.id);
  const retry = { sourceDirectory: source.directory, sourceSha256: source.sha256, reason: reason.trim(), requestedJobIds: [...retryJobIds].sort(), selectedJobIds: [...selected].sort(), executorFingerprints };
  return makeSchedule({ ...source.schedule.specification, retry });
}

export async function runSchedule({ directory, schedule, execute, shouldStop = () => false }) {
  directory = assertRunDirectory(directory);
  schedule = structuredClone(schedule);
  assert.equal(canonical(makeSchedule(schedule.specification)), canonical(schedule), "Changed schedule");
  const retry = schedule.specification.retry;
  const source = retry ? snapshotCompletedRun(retry.sourceDirectory) : null;
  if (source) {
    assert.ok(directory !== source.directory && !directory.startsWith(source.directory + path.sep) && !source.directory.startsWith(directory + path.sep), "Retry directories must not overlap");
    assert.equal(source.sha256, retry.sourceSha256, "Retry source changed");
    const expected = makeRetrySchedule({ sourceDirectory: source.directory, retryJobIds: retry.requestedJobIds, reason: retry.reason, executorFingerprints: retry.executorFingerprints });
    assert.equal(canonical(schedule), canonical(expected), "Retry plan differs from the frozen source and explicit selection");
  }
  const manifest = path.join(directory, "schedule.json");
  try { writeRecord(manifest, schedule); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  assert.equal(canonical(readRecord(manifest)), canonical(schedule), "Run schedule mismatch");
  const auditLease = path.join(directory, "reconciliation-active.json");
  if (fs.existsSync(auditLease)) { const active = readRecord(auditLease); return { status: observeOwner(active), owner: active, results: [] }; }
  const leaseFile = path.join(directory, "active.json");
  const owner = { id: randomUUID(), pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), scheduleSha256: schedule.sha256 };
  try { writeRecord(leaseFile, owner); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const active = readRecord(leaseFile);
    // Missing parent ownership does not prove its service children have stopped.
    return { status: observeOwner(active), owner: active, results: [] };
  }
  const results = [];
  const previous = new Map();
  try {
    for (const job of schedule.jobs) {
      if (shouldStop()) return { status: "stopped", results };
      const folder = path.join(directory, job.id);
      fs.mkdirSync(folder, { recursive: true });
      assert.equal(fs.realpathSync(folder), folder, "Job directory cannot be a symlink");
      const resultFile = path.join(folder, "result.json");
      if (fs.existsSync(resultFile)) {
        const result = readRecord(resultFile);
        assert.equal(result.scheduleSha256, schedule.sha256, "Result schedule mismatch");
        assert.equal(result.jobId, job.id, "Result job mismatch");
        results.push(result); previous.set(job.id, result); continue;
      }
      const claim = path.join(folder, "claim.json");
      if (fs.existsSync(claim)) return { status: "unresolved", owner: readRecord(claim).owner, jobId: job.id, results };
      writeRecord(claim, { jobId: job.id, scheduleSha256: schedule.sha256, owner });
      const dependency = job.dependsOn && previous.get(job.dependsOn);
      const started = performance.now();
      let result;
      if (source && !retry.selectedJobIds.includes(job.id)) {
        const original = source.results.find(row => row.jobId === job.id);
        const { jobId: _jobId, scheduleSha256: _scheduleSha256, ownerId: _ownerId, elapsedMs: sourceElapsedMs, ...outcome } = original;
        result = { ...outcome, sourceElapsedMs, reusedFrom: { directory: source.directory, scheduleSha256: source.schedule.sha256, jobId: job.id, resultSha256: digest(original) } };
      } else if (dependency && dependency.status !== "completed") {
        result = { status: "dependency_failed", dependency: job.dependsOn };
      } else {
        try {
          const value = await execute({ job: structuredClone(job), directory: folder, dependency: structuredClone(dependency || null) });
          canonical(value);
          result = { status: "completed", value };
        } catch (error) {
          result = { status: "failed", error: { name: String(error.name ?? "Error"), message: String(error.message ?? error).slice(0, 2000) } };
        }
      }
      result = { jobId: job.id, scheduleSha256: schedule.sha256, ownerId: owner.id, elapsedMs: performance.now() - started, ...result };
      writeRecord(resultFile, result);
      results.push(result); previous.set(job.id, result);
    }
    return { status: "completed", results };
  } finally {
    assert.equal(readRecord(leaseFile).id, owner.id, "Run ownership changed");
    fs.unlinkSync(leaseFile);
  }
}
