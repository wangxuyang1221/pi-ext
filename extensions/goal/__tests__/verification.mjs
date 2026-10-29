import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, rmSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createTestEnvironment } from "../../../test-support/environment.mjs";
import { stopProcessGroup } from "../../../scripts/codex-compact-quality-process.mjs";
import { stopRecordedPtyOwners } from "../../../.cursor/skills/verify-pi-ext/scripts/runtime-support.mjs";

const drivers = { lifecycle: "journey-tui-driver.py", recovery: "recovery-tui-driver.py", content: "content-tui-driver.py", budget: "budget-tui-driver.py", continuation: "acceptance-tui-driver.py", matrix: "matrix-tui-driver.py", footer: "footer-tui-driver.py", accounting: "accounting-tui-driver.py", "child-freeze": "child-freeze-tui-driver.py" };
async function bounded(promise, milliseconds, signal) {
  let timer, listener;
  try {
    return await Promise.race([promise, new Promise(resolveOutcome => {
      timer = setTimeout(() => resolveOutcome({ timedOut: true }), milliseconds);
      listener = () => resolveOutcome({ interrupted: true });
      if (signal?.aborted) listener();
      else signal?.addEventListener("abort", listener, { once: true });
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", listener); }
}
function terminate(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}
function scanOwners(directory, ids, errors) {
  try {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) scanOwners(path, ids, errors);
      else try {
        if (item.name === "pid.txt") ids.add(Number(readFileSync(path, "utf8")));
        else if (item.name === "pids.json" || item.name === "owned-pty-pids.json") for (const pid of JSON.parse(readFileSync(path, "utf8"))) ids.add(pid);
        else if (item.name.startsWith("events") && item.name.endsWith(".jsonl")) {
          for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
            try { const event = JSON.parse(line); if (event.event === "child-started") ids.add(event.pid); }
            catch (error) { errors.push(`Incomplete event in ${path}: ${error}`); }
          }
        }
      } catch (error) { errors.push(`Read ${path}: ${error}`); }
    }
  } catch (error) { errors.push(`Scan ${directory}: ${error}`); }
}

export async function runVerification({ journey = "lifecycle", scenario = "", ui = "0", timeoutMs = 180000, copyProof = cpSync } = {}) {
  if (!Object.hasOwn(drivers, journey)) throw new Error(`Unknown goal journey: ${journey}`);
  const evidenceParent = process.env.PI_VERIFY_EVIDENCE ? resolve(process.env.PI_VERIFY_EVIDENCE) : resolve(".tmp/test-results");
  mkdirSync(evidenceParent, { recursive: true });
  const evidence = mkdtempSync(join(evidenceParent, `goal-${journey}-`));
  const summary = { journey, scenario, ui, node: process.version, evidence, startedAt: new Date().toISOString(), status: "running", cleanupErrors: [], artifactErrors: [] };
  let isolated, root, child, closed, output = "";
  const isolationPrefix = `goal-${journey}-${randomUUID()}`;
  const controller = new AbortController();
  const handlers = new Map(["SIGTERM", "SIGINT"].map(signal => [signal, () => { summary.interruptedBy = signal; controller.abort(); }]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const persist = (name, value) => {
    try { writeFileSync(join(evidence, name), value); return true; }
    catch (error) {
      summary.artifactErrors.push(`Write ${name}: ${error}`);
      const fallback = `${evidence}.${name}`;
      try { writeFileSync(fallback, value); (summary.fallbackArtifacts ??= []).push(fallback); }
      catch (fallbackError) { summary.artifactErrors.push(`Write fallback ${fallback}: ${fallbackError}`); }
      return false;
    }
  };
  try {
    isolated = createTestEnvironment(isolationPrefix);
    root = join(isolated.directory, "case"); mkdirSync(root);
    summary.scratch = isolated.directory;
    const piRoot = resolve("node_modules/@earendil-works/pi-coding-agent");
    summary.pi = JSON.parse(readFileSync(join(piRoot, "package.json"), "utf8")).version;
    const args = journey === "footer" ? scenario.split(",").filter(Boolean) : [root, piRoot];
    summary.command = ["conda", "run", "--no-capture-output", "-n", "codex-py312", "python", `extensions/goal/__tests__/${drivers[journey]}`, ...args];
    const env = { ...isolated.env, TERM: "xterm-256color", COLORTERM: "truecolor", SHELL: "/bin/sh", GOAL_TUI_SCENARIO: scenario, GOAL_MATRIX_SCENARIO: scenario, GOAL_UI_CODEX: ui, GOAL_USAGE_SOURCE: scenario || "root", GOAL_BUDGET_SCENARIO: scenario || "soft", GOAL_AUDIT_ROOT: root, GOAL_FOOTER_EVIDENCE: root };
    if (controller.signal.aborted) throw new Error("Goal verification interrupted before launch");
    child = spawn(summary.command[0], summary.command.slice(1), { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    summary.pid = child.pid;
    let spawnError;
    child.on("error", error => { spawnError = error; });
    closed = new Promise(resolveClose => child.once("close", (code, signal) => resolveClose({ code, signal, spawnError })));
    child.stdout.on("data", data => output += data); child.stderr.on("data", data => output += data);
    persist("summary.json", JSON.stringify(summary, null, 2));
    let outcome = await bounded(closed, timeoutMs, controller.signal);
    if (outcome.interrupted || outcome.timedOut) {
      Object.assign(summary, outcome); terminate(child);
      outcome = await bounded(closed, 1500);
      summary.forcedDriverStop = outcome.timedOut === true;
    }
    if (outcome.spawnError) throw outcome.spawnError;
    Object.assign(summary, { exitCode: outcome.code, signal: outcome.signal });
    if (summary.interrupted) throw new Error("Goal verification interrupted");
    if (summary.timedOut) throw new Error(`Goal verification exceeded ${timeoutMs}ms`);
    if (outcome.code !== 0) throw new Error(`Goal driver exited with ${outcome.code ?? outcome.signal}`);
    summary.status = "passed";
  } catch (error) { summary.status = "failed"; summary.error = error.stack ?? String(error); }
  finally {
    if (!isolated) {
      try {
        const partial = readdirSync(resolve(".tmp")).filter(name => name.startsWith(`${isolationPrefix}-`));
        if (partial.length === 1) { isolated = { directory: resolve(".tmp", partial[0]) }; summary.scratch = isolated.directory; }
        else if (partial.length > 1) summary.cleanupErrors.push("Multiple partial isolation directories");
      } catch (error) { summary.cleanupErrors.push(`Find partial isolation: ${error}`); }
    }
    if (child?.pid) {
      try { summary.process = await stopProcessGroup(child, { graceMs: 0 }); }
      catch (error) { summary.cleanupErrors.push(`Driver group: ${error}`); }
    } else summary.process = { notStarted: true, groupStopped: true };
    const ids = new Set();
    if (root) scanOwners(root, ids, summary.cleanupErrors);
    summary.fixturePids = [...ids];
    const validPids = summary.fixturePids.filter(pid => Number.isSafeInteger(pid) && pid > 1);
    if (validPids.length !== summary.fixturePids.length) summary.cleanupErrors.push("Invalid owned PID record");
    if (validPids.length) {
      try {
        const deadline = performance.now() + 1000;
        while (true) {
          try { summary.owners = await stopRecordedPtyOwners(validPids); break; }
          catch (error) {
            // macOS can briefly reject a group probe while its PTY owner exits.
            // Retry that observation; persistent EPERM still fails cleanup.
            if (error.code !== "EPERM" || performance.now() >= deadline) throw error;
            summary.ownerProbeRetries = (summary.ownerProbeRetries ?? 0) + 1;
            await delay(20);
          }
        }
      }
      catch (error) { summary.cleanupErrors.push(`PTY groups: ${error}`); }
    }
    if (closed) {
      const finalClose = await bounded(closed, 1000);
      if (finalClose.timedOut) {
        summary.cleanupErrors.push("Driver output did not close after cleanup");
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
      } else Object.assign(summary, { exitCode: finalClose.code, signal: finalClose.signal });
    }
    summary.alivePids = validPids.filter(pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; summary.cleanupErrors.push(`PID probe ${pid}: ${error}`); return true; } });
    summary.listeningPorts = "";
    if (child?.pid || validPids.length) {
      try { summary.listeningPorts = execFileSync("lsof", ["-nP", "-a", "-p", [child?.pid, ...validPids].filter(Boolean).join(","), "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8", timeout: 3000 }).trim(); }
      catch (error) { if (error.status !== 1) summary.cleanupErrors.push(`Listening ports: ${error}`); }
    }
    // Archive independently; a copy failure must not suppress the process evidence or summary.
    persist("output.log", output);
    if (root) try { copyProof(root, join(evidence, "proof"), { recursive: true, dereference: false }); }
    catch (error) { summary.artifactErrors.push(`Copy proof: ${error}`); }
    let safe = summary.process?.groupStopped && !summary.alivePids.length && !summary.listeningPorts && !summary.cleanupErrors.length && !summary.artifactErrors.length;
    summary.cleanup = "unverified";
    // Confirm the final state can be recorded before deleting its raw scratch.
    if (!persist("summary.json", JSON.stringify(summary, null, 2))) safe = false;
    if (safe) {
      try { if (isolated) rmSync(isolated.directory, { recursive: true, force: true }); summary.cleanup = isolated ? "removed" : "not-created"; }
      catch (error) { summary.cleanupErrors.push(`Remove scratch: ${error}`); }
    }
    if (summary.cleanup === "unverified") summary.status = "failed";
    summary.evidenceSurvives = existsSync(join(evidence, "output.log"));
    summary.finishedAt = new Date().toISOString();
    if (!persist("summary.json", JSON.stringify(summary, null, 2))) {
      summary.status = "failed";
      try { writeFileSync(`${evidence}.summary.json`, JSON.stringify(summary, null, 2)); }
      catch (error) { summary.artifactErrors.push(`Final summary fallback: ${error}`); }
    }
    for (const [signal, handler] of handlers) process.off(signal, handler);
    console.log(JSON.stringify(summary));
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [journey, scenario, ui] = process.argv.slice(2);
  const summary = await runVerification({ journey, scenario, ui });
  process.exitCode = summary.status === "passed" && summary.cleanup === "removed" ? 0 : 1;
}
