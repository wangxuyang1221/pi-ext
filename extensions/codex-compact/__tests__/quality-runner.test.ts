import { expect, test } from "vitest";
import * as runner from "../../../scripts/codex-compact-quality-runner.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import { createServer } from "node:http";
import { stopProcessGroup } from "../../../scripts/codex-compact-quality-process.mjs";

const specification = () => ({
  seed: "runner-development-v1", model: "gpt-5.6-sol", effort: "medium", track: "fixed-boundary",
  versions: { old: "a".repeat(64), new: "b".repeat(64), cli: "c".repeat(64) },
  compactionRepeats: 2, continuationRepeats: 2,
  tasks: [{ id: "task-a", independenceId: "repo-a", inputSha256: "d".repeat(64) }, { id: "task-b", independenceId: "repo-b", inputSha256: "e".repeat(64) }]
});

test("freezes reproducible interleaving with distinct compression and continuation repeats", () => {
  expect(typeof runner.makeSchedule).toBe("function");
  const first = runner.makeSchedule(specification());
  expect(runner.makeSchedule(specification())).toEqual(first);
  expect(first.jobs).toHaveLength(48);
  expect(new Set(first.jobs.map((job: any) => job.id)).size).toBe(48);
  expect(new Set(first.jobs.map((job: any) => job.independenceId)).size).toBe(2);
  expect(first.jobs.filter((job: any) => job.arm === "reference" && job.phase !== "continuation").every((job: any) => job.phase === "prepare_reference")).toBe(true);
  const seen = new Set();
  for (const job of first.jobs) {
    if (job.phase === "continuation") expect(seen.has(job.dependsOn)).toBe(true);
    else expect(job.dependsOn).toBeNull();
    seen.add(job.id);
  }
  expect(runner.makeSchedule({ ...specification(), seed: "different" }).jobs.map((job: any) => job.id))
    .not.toEqual(first.jobs.map((job: any) => job.id));
  expect(runner.makeSchedule({ ...specification(), tasks: [...specification().tasks].reverse() })).toEqual(first);
});

test("resumes an interrupted batch without repeating completed requests and rejects changed plans", async () => {
  expect(typeof runner.runSchedule).toBe("function");
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-runner-"));
  try {
    const schedule = runner.makeSchedule(specification());
    let calls = 0;
    const execute = async ({ job, dependency }: any) => {
      calls++;
      if (job.phase === "continuation") expect(dependency.value.jobId).toBe(job.dependsOn);
      return { jobId: job.id };
    };
    const partial = await runner.runSchedule({ directory, schedule, execute, shouldStop: () => calls === 3 });
    expect(partial.status).toBe("stopped"); expect(calls).toBe(3);
    const finished = await runner.runSchedule({ directory, schedule, execute });
    expect(finished.status).toBe("completed"); expect(calls).toBe(48);
    expect(finished.results).toHaveLength(48);
    await runner.runSchedule({ directory, schedule, execute });
    expect(calls).toBe(48);
    await expect(runner.runSchedule({ directory, schedule: runner.makeSchedule({ ...specification(), seed: "changed" }), execute })).rejects.toThrow(/schedule/i);
    expect(calls).toBe(48);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("keeps failed requests and dependent failures immutable across resumes", async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-runner-failure-"));
  try {
    const schedule = runner.makeSchedule({ ...specification(), compactionRepeats: 1, continuationRepeats: 1, tasks: specification().tasks.slice(0, 1) });
    const calls: string[] = [];
    const execute = async ({ job }: any) => { calls.push(job.id); if (job.arm === "new" && job.phase === "compaction") throw new Error("Observed provider timeout"); return { ok: true }; };
    const first = await runner.runSchedule({ directory, schedule, execute });
    expect(first.results.filter((row: any) => row.status === "failed")).toHaveLength(1);
    expect(first.results.filter((row: any) => row.status === "dependency_failed")).toHaveLength(1);
    expect(calls).toHaveLength(7);
    const again = await runner.runSchedule({ directory, schedule, execute });
    expect(again.results).toEqual(first.results); expect(calls).toHaveLength(7);
    const file = path.join(directory, schedule.jobs[0].id, "result.json");
    const edited = JSON.parse(fs.readFileSync(file, "utf8")); edited.payload.elapsedMs++;
    fs.writeFileSync(file, JSON.stringify(edited));
    await expect(runner.runSchedule({ directory, schedule, execute })).rejects.toThrow(/fingerprint/);
    expect(calls).toHaveLength(7);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("does not restart a live owner or infer service completion from a dead owner", async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-runner-owner-"));
  const schedule = runner.makeSchedule({ ...specification(), compactionRepeats: 1, continuationRepeats: 1, tasks: specification().tasks.slice(0, 1) });
  const moduleUrl = new URL("../../../scripts/codex-compact-quality-runner.mjs", import.meta.url).href;
  const code = `import {runSchedule} from ${JSON.stringify(moduleUrl)}; await runSchedule({directory:${JSON.stringify(directory)},schedule:${JSON.stringify(schedule)},execute:async()=>{console.log("owned");setInterval(()=>{},1000);await new Promise(()=>{});}});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([once(child.stdout!, "data"), new Promise((_, reject) => timer = setTimeout(() => reject(new Error("Owner observation timed out")), 5000))]);
    if (timer) clearTimeout(timer);
    let calls = 0;
    const execute = async () => { calls++; return {}; };
    expect((await runner.runSchedule({ directory, schedule, execute })).status).toBe("running");
    expect((await runner.runSchedule({ directory, schedule, execute })).status).toBe("running");
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    expect((await runner.runSchedule({ directory, schedule, execute })).status).toBe("unresolved");
    expect(calls).toBe(0);
    expect(fs.existsSync(path.join(directory, "active.json"))).toBe(true);
    const bytes = fs.readFileSync(path.join(directory, "active.json"), "utf8");
    expect(runner.reconcileInterruptedSchedule({ directory, reason: "Missing resource evidence" })).toMatchObject({ status: "unresolved", reason: "Missing registered resource boundary for interrupted job" });
    expect(fs.readFileSync(path.join(directory, "active.json"), "utf8")).toBe(bytes);
    expect(fs.existsSync(path.join(directory, "reconciliation-active.json"))).toBe(false);
  } finally {
    if (timer) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("retries only explicitly selected failures in a new attempt without replacing primary outcomes", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-runner-retry-"));
  const source = path.join(root, "primary"), target = path.join(root, "retry");
  fs.mkdirSync(source); fs.mkdirSync(target);
  try {
    const schedule = runner.makeSchedule({ ...specification(), compactionRepeats: 1, continuationRepeats: 1, tasks: specification().tasks.slice(0, 1) });
    const failedJob = schedule.jobs.find((job: any) => job.arm === "new" && job.phase === "compaction")!;
    const primary = await runner.runSchedule({ directory: source, schedule, execute: async ({ job }: any) => {
      if (job.id === failedJob.id) throw new Error("Primary transport failure");
      return { checkpoint: job.id };
    } });
    const originals = new Map(schedule.jobs.map((job: any) => [job.id, fs.readFileSync(path.join(source, job.id, "result.json"), "utf8")]));
    expect(typeof runner.makeRetrySchedule).toBe("function");
    const retry = runner.makeRetrySchedule({ sourceDirectory: source, retryJobIds: [failedJob.id], reason: "Explicit development diagnostic retry" });
    expect(retry.sha256).not.toBe(schedule.sha256);
    expect(retry.specification.tasks).toEqual(schedule.specification.tasks);
    const calls: string[] = [];
    const execute = async ({ job, dependency }: any) => {
      calls.push(job.id);
      if (job.phase === "continuation") expect(dependency.value.checkpoint).toBe(failedJob.id);
      return { checkpoint: job.id };
    };
    const retried = await runner.runSchedule({ directory: target, schedule: retry, execute });
    expect(calls).toEqual(retry.jobs.filter((job: any) => job.arm === "new").map((job: any) => job.id));
    expect(retried.results.filter((row: any) => row.reusedFrom)).toHaveLength(6);
    expect(retried.results.every((row: any) => row.status === "completed")).toBe(true);
    expect(primary.results.find((row: any) => row.jobId === failedJob.id).status).toBe("failed");
    for (const [id, bytes] of originals) expect(fs.readFileSync(path.join(source, id, "result.json"), "utf8")).toBe(bytes);
    const resumed = await runner.runSchedule({ directory: target, schedule: retry, execute });
    expect(resumed.results).toEqual(retried.results);
    expect(calls).toHaveLength(2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("rejects retry plan changes and overlapping directories before executing or publishing a claim", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-runner-retry-validation-"));
  const source = path.join(root, "primary"); fs.mkdirSync(source);
  try {
    const schedule = runner.makeSchedule({ ...specification(), compactionRepeats: 1, continuationRepeats: 1, tasks: specification().tasks.slice(0, 1) });
    const failed = schedule.jobs.find((job: any) => job.arm === "old" && job.phase === "compaction")!;
    await runner.runSchedule({ directory: source, schedule, execute: async ({ job }: any) => { if (job.id === failed.id) throw new Error("Failed"); return {}; } });
    const retry = runner.makeRetrySchedule({ sourceDirectory: source, retryJobIds: [failed.id], reason: "Diagnostic retry" });
    for (const [index, mutate] of [
      (config: any) => { config.model = "different-model"; },
      (config: any) => { config.retry.selectedJobIds = config.retry.selectedJobIds.slice(0, 1); },
      (config: any) => { config.tasks[0].inputSha256 = "f".repeat(64); },
    ].entries()) {
      const directory = path.join(root, `invalid-${index}`); fs.mkdirSync(directory);
      const config = structuredClone(retry.specification); mutate(config);
      let calls = 0;
      await expect(runner.runSchedule({ directory, schedule: runner.makeSchedule(config), execute: async () => { calls++; return {}; } })).rejects.toThrow(/Retry plan/);
      expect(calls).toBe(0);
      expect(fs.readdirSync(directory)).toEqual([]);
    }
    const nested = path.join(source, "retry"); fs.mkdirSync(nested);
    await expect(runner.runSchedule({ directory: nested, schedule: retry, execute: async () => ({}) })).rejects.toThrow(/overlap/);
    expect(fs.readdirSync(nested)).toEqual([]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("refuses a diagnostic retry while a registered process group is alive even after its owner finished", async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-runner-retry-resource-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const schedule = runner.makeSchedule({ ...specification(), compactionRepeats: 1, continuationRepeats: 1, tasks: specification().tasks.slice(0, 1) });
    const failed = schedule.jobs.find((job: any) => job.arm === "new" && job.phase === "compaction")!;
    await runner.runSchedule({ directory, schedule, execute: async ({ job, directory: jobDirectory }: any) => {
      if (job.id !== failed.id) return {};
      child = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
      await once(child.stdout!, "data", { signal: AbortSignal.timeout(5000) });
      fs.mkdirSync(path.join(jobDirectory, "plugin"));
      fs.writeFileSync(path.join(jobDirectory, "plugin/process.json"), JSON.stringify({ kind: "process-group", pid: child.pid, ownerPid: process.pid, hostname: os.hostname() }));
      throw new Error("Worker cleanup failed");
    } });
    expect(fs.existsSync(path.join(directory, "active.json"))).toBe(false);
    expect(() => runner.makeRetrySchedule({ sourceDirectory: directory, retryJobIds: [failed.id], reason: "Diagnostic retry" })).toThrow(/resource.*live/i);
    const exit = once(child!, "exit"); process.kill(-child!.pid!, "SIGKILL"); await exit;
    expect(runner.makeRetrySchedule({ sourceDirectory: directory, retryJobIds: [failed.id], reason: "Retry after verified cleanup" }).specification.retry.requestedJobIds).toEqual([failed.id]);
    const resource = path.join(directory, failed.id, "plugin/process.json");
    const record = JSON.parse(fs.readFileSync(resource, "utf8")); record.hostname = "another-host";
    fs.writeFileSync(resource, JSON.stringify(record));
    expect(() => runner.makeRetrySchedule({ sourceDirectory: directory, retryJobIds: [failed.id], reason: "Unverifiable remote resource" })).toThrow(/resource.*host/i);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); process.kill(-child.pid!, "SIGKILL"); await exit; }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reconciles a dead owner only after its registered worker stopped and records unknown upstream outcome", async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-runner-reconcile-"));
  const schedule = runner.makeSchedule({ ...specification(), compactionRepeats: 1, continuationRepeats: 1, tasks: specification().tasks.slice(0, 1) });
  const failed = schedule.jobs.find((job: any) => job.arm === "new" && job.phase === "compaction")!;
  const moduleUrl = new URL("../../../scripts/codex-compact-quality-runner.mjs", import.meta.url).href;
  const code = `import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {runSchedule} from ${JSON.stringify(moduleUrl)};
    await runSchedule({directory:${JSON.stringify(directory)},schedule:${JSON.stringify(schedule)},execute:async({job,directory:folder})=>{
      if(job.id!==${JSON.stringify(failed.id)})return {ok:true};
      const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
      fs.mkdirSync(path.join(folder,'plugin/pi-home'),{recursive:true});
      fs.writeFileSync(path.join(folder,'plugin/pi-home/auth.json'),'test credential');
      fs.writeFileSync(path.join(folder,'plugin/process.json'),JSON.stringify({kind:'process-group',pid:worker.pid,ownerPid:process.pid,hostname:os.hostname()}));
      process.stdout.write('ready');await new Promise(()=>{});
    }});`;
  const owner = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  let workerPid: number | undefined;
  try {
    await once(owner.stdout!, "data", { signal: AbortSignal.timeout(5000) });
    const resource = JSON.parse(fs.readFileSync(path.join(directory, failed.id, "plugin/process.json"), "utf8"));
    expect(resource.ownerPid).toBe(owner.pid);
    expect(Number.isSafeInteger(resource.pid) && resource.pid > 1).toBe(true);
    workerPid = resource.pid;
    expect(typeof runner.reconcileInterruptedSchedule).toBe("function");
    expect(runner.reconcileInterruptedSchedule({ directory, reason: "Observe owner" }).status).toBe("running");
    const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited;
    expect(() => runner.reconcileInterruptedSchedule({ directory, reason: "Owner is gone but worker is live" })).toThrow(/resource.*live/i);
    expect(fs.existsSync(path.join(directory, "active.json"))).toBe(true);
    await stopProcessGroup({ pid: workerPid, exitCode: null, signalCode: null }, { graceMs: 0 });
    const reconciled = runner.reconcileInterruptedSchedule({ directory, reason: "Owned worker group confirmed stopped" });
    expect(reconciled.status).toBe("reconciled");
    if (!("interruptedJobIds" in reconciled)) throw new Error("Expected reconciled result");
    expect(reconciled.interruptedJobIds).toEqual([failed.id]);
    expect(fs.existsSync(path.join(directory, "active.json"))).toBe(false);
    expect(fs.existsSync(path.join(directory, failed.id, "plugin/pi-home/auth.json"))).toBe(false);
    const failedRecord = fs.readFileSync(path.join(directory, failed.id, "result.json"), "utf8");
    const outcome = JSON.parse(failedRecord).payload;
    expect(outcome.status).toBe("failed");
    expect(outcome.recovery).toMatchObject({ upstreamStatus: "unknown", usageComplete: false });
    expect(outcome.elapsedMs).toBeNull();
    const calls: string[] = [];
    const resumed = await runner.runSchedule({ directory, schedule, execute: async ({ job }: any) => { calls.push(job.id); return {}; } });
    expect(calls).not.toContain(failed.id);
    expect(calls).not.toContain(schedule.jobs.find((job: any) => job.dependsOn === failed.id)!.id);
    expect(resumed.results.filter((row: any) => row.status === "failed")).toHaveLength(1);
    expect(resumed.results.filter((row: any) => row.status === "dependency_failed")).toHaveLength(1);
    expect(fs.readFileSync(path.join(directory, failed.id, "result.json"), "utf8")).toBe(failedRecord);
  } finally {
    if (owner.exitCode === null && owner.signalCode === null) { const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited; }
    const resourcePath = path.join(directory, failed.id, "plugin/process.json");
    if (fs.existsSync(resourcePath)) {
      const resource = JSON.parse(fs.readFileSync(resourcePath, "utf8"));
      expect(resource.ownerPid).toBe(owner.pid);
      await stopProcessGroup({ pid: resource.pid, exitCode: null, signalCode: null }, { graceMs: 0 });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps a lost continuation unknown and issues no replacement HTTP request without an explicit retry", async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-runner-http-recovery-"));
  const source = path.join(directory, "primary"), target = path.join(directory, "retry"); fs.mkdirSync(source); fs.mkdirSync(target);
  let requests = 0;
  const server = createServer((_request, response) => { requests++; if (requests > 1) response.end("diagnostic response"); });
  let owner: ReturnType<typeof spawn> | undefined;
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = (server.address() as any).port;
    const schedule = runner.makeSchedule({ ...specification(), adapterMode: "maintained", compactionRepeats: 1, continuationRepeats: 1, tasks: specification().tasks.slice(0, 1) });
    const failed = schedule.jobs.find((job: any) => job.arm === "new" && job.phase === "continuation")!;
    const moduleUrl = new URL("../../../scripts/codex-compact-quality-runner.mjs", import.meta.url).href;
    const code = `import {runSchedule} from ${JSON.stringify(moduleUrl)};await runSchedule({directory:${JSON.stringify(source)},schedule:${JSON.stringify(schedule)},execute:async({job})=>{if(job.id===${JSON.stringify(failed.id)})await fetch('http://127.0.0.1:${port}');return {};}});`;
    const accepted = once(server, "request", { signal: AbortSignal.timeout(5000) });
    owner = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: "ignore" }); await accepted;
    expect(runner.reconcileInterruptedSchedule({ directory: source, reason: "Observe live request" }).status).toBe("running");
    expect(requests).toBe(1);
    const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited;
    expect(runner.reconcileInterruptedSchedule({ directory: source, reason: "Continuation owner exited; no detached worker" }).status).toBe("reconciled");
    const resumed = await runner.runSchedule({ directory: source, schedule, execute: async () => ({}) });
    expect(resumed.results.find((row: any) => row.jobId === failed.id).recovery.upstreamStatus).toBe("unknown");
    expect(requests).toBe(1);
    const retry = runner.makeRetrySchedule({ sourceDirectory: source, retryJobIds: [failed.id], reason: "Explicit diagnostic restart after loss of the original response" });
    const retried = await runner.runSchedule({ directory: target, schedule: retry, execute: async ({ job }: any) => {
      expect(job.id).toBe(failed.id);
      return { text: await (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(5000) })).text() };
    } });
    expect(requests).toBe(2);
    expect(retried.results.filter((row: any) => !row.reusedFrom)).toHaveLength(1);
    expect(retried.results.find((row: any) => row.jobId === failed.id).value.text).toBe("diagnostic response");
  } finally {
    if (owner && owner.exitCode === null && owner.signalCode === null) { const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited; }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects invalid repetitions, duplicate independence units and incomplete fingerprints before scheduling", () => {
  for (const mutate of [
    (value: any) => value.compactionRepeats = 0,
    (value: any) => value.continuationRepeats = 1.5,
    (value: any) => value.tasks[1].independenceId = "repo-a",
    (value: any) => value.tasks[1].id = "task-a",
    (value: any) => value.tasks[1].inputSha256 = "",
    (value: any) => delete value.versions.cli,
    (value: any) => value.seed = "",
    (value: any) => value.metadata = { date: new Date("2020-01-01") },
  ]) {
    const config = specification(); mutate(config);
    expect(() => runner.makeSchedule(config)).toThrow();
  }
});
