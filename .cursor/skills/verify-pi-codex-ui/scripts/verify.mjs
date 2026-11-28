#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestEnvironment } from "../../../../test-support/environment.mjs";
import { inspectPiHost } from "../../../../scripts/pi-host.mjs";
import { archiveEvidence, createRunEvidence, finishOutput, reportedEvidencePaths, snapshotFixtures, stopRecordedPtyOwners } from "./runtime-support.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
process.chdir(repo);
const host = inspectPiHost();
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
let pythonRuntime;
function inspectPython() {
  return pythonRuntime ??= JSON.parse(execFileSync("conda", ["run", "-n", "codex-py312", "python", "-c",
    "import json, sys, pyte; print(json.dumps({'executable': sys.executable, 'version': sys.version}))"], { encoding: "utf8", timeout: 60000 }).trim());
}
// Keep Python as the direct child so SIGTERM reaches the PTY owner, not conda's shell.
const python = (...args) => [inspectPython().executable, ...args];
const cases = {
  "codex-ui": () => python("extensions/codex-ui/__tests__/codemode-pty.py"),
  "codex-ui-fullscreen": () => python("extensions/codex-ui/__tests__/codemode-pty.py", "--fullscreen"),
  thinking: () => python("extensions/codex-ui/__tests__/thinking-pty.py"),
  "tool-status": () => ["pnpm", "run", "tool-status:check"],
};

function doctor() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert.ok(major > 22 || major === 22 && minor >= 19, "Node 22.19+ required");
  const pnpm = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
  assert.equal(`pnpm@${pnpm}`, manifest.packageManager, "Use the repository pnpm version");
  for (const path of ["extensions/codex-ui/dist/index.js"]) assert.ok(existsSync(path), `Build missing: ${path}`);
  const pythonInfo = inspectPython();
  const gitRoot = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const dependencyRoot = realpathSync("node_modules");
  return { ...host, pnpm, python: pythonInfo.version, pythonExecutable: pythonInfo.executable, gitRoot, independentCheckout: gitRoot === realpathSync(repo),
    dependencyRoot, sharedDependencies: dependencyRoot !== join(realpathSync(repo), "node_modules"),
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTree: execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim() };
}

const [operation, selected, ...options] = process.argv.slice(2);
const recipeOption = options.indexOf("--recipe");
const recipe = recipeOption >= 0 ? resolve(options[recipeOption + 1]) : undefined;
assert.ok(options.length === 0 || options.length === 2 && recipeOption === 0 && existsSync(recipe), "Use --recipe <path.json>");
const interactive = operation === "tui";
const commandJourney = interactive || operation === "journey";
if (commandJourney) {
  assert.ok(selected === "codex-ui", "Unknown extension");
  assert.ok(interactive || recipe, "journey requires --recipe <path.json>");
  cases[selected] = (root, evidence) => python(join(here, "commands.py"), `${interactive ? "explore" : "journey"}:${selected}`, root, evidence, ...(recipe ? [recipe] : []));
}
if (operation === "doctor") {
  console.log(JSON.stringify({ ...doctor(), lockPresent: existsSync(".tmp/verify-pi-codex-ui.lock"), cases: Object.keys(cases) }, null, 2));
} else {
  assert.ok(operation === "run" || commandJourney, "Use doctor, run <case>, tui <extension>, or journey <extension> --recipe <path.json>");
  assert.ok(Object.hasOwn(cases, selected), `Unknown case: ${selected}`);
  const checked = doctor();
  mkdirSync(".tmp/test-results", { recursive: true });
  // Existing PTY fixtures have fixed evidence names; one run owns them at a time.
  const lock = resolve(".tmp/verify-pi-codex-ui.lock");
  const evidence = createRunEvidence({ lock, prefix: resolve(`.tmp/test-results/verify-${selected}-`), caseName: selected });
  let scratch, child, log, closed;
  const summary = { case: selected, doctor: checked, evidence, status: "running", cleanup: "pending" };
  const fixtureCase = commandJourney ? "journey" : selected;
  let before = new Map();
  const abort = new AbortController();
  const interrupted = signal => abort.abort(new Error(`Verification interrupted: ${signal}`));
  const onInt = () => interrupted("SIGINT"), onTerm = () => interrupted("SIGTERM");
  process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
  try {
    before = snapshotFixtures(repo, fixtureCase);
    const isolated = createTestEnvironment(`verify-${selected}`);
    scratch = isolated.directory;
    const command = cases[selected](scratch, evidence);
    Object.assign(summary, { command, scratch });
    if (recipe) copyFileSync(recipe, join(evidence, "recipe.json"));
    writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ case: selected, command, evidence }));
    log = createWriteStream(join(evidence, "output.log"));
    child = spawn(command[0], command.slice(1), { cwd: repo, detached: true, stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"], env: {
      ...isolated.env, TERM: "xterm-256color", COLORTERM: "truecolor", SHELL: "/bin/sh",
      PI_VERIFY_EVIDENCE: evidence,
      PI_VERIFY_SCRATCH: scratch,
    } });
    closed = new Promise(resolve => child.once("close", resolve));
    summary.pid = child.pid;
    writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2));
    child.stdout?.on("data", data => log.write(data));
    child.stderr?.on("data", data => log.write(data));
    const [code] = await once(child, "exit", { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(900000)]) });
    summary.exitCode = code;
    assert.equal(code, 0, `Verification failed; read ${join(evidence, "output.log")}`);
    summary.status = commandJourney ? "manual-review-required" : "passed";
  } catch (error) {
    summary.status = "failed"; summary.error = String(error); process.exitCode = 1;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      // Give Python's finally blocks a chance to reap their separate PTY groups.
      try { if (interactive) child.kill("SIGTERM"); else process.kill(-child.pid, "SIGTERM"); } catch {}
      summary.interrupted = true;
    }
  } finally {
    const cleanupErrors = [];
    const stage = async (name, action) => {
      try { await action(); } catch (error) { cleanupErrors.push({ stage: name, error: String(error) }); }
    };
    await stage("process", async () => {
      if (commandJourney && child?.pid && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        try { await once(child, "exit", { signal: AbortSignal.timeout(10000) }); } catch {}
      }
      summary.process = child?.pid ? await stopRecordedPtyOwners([child.pid]) : { groupStopped: true, spawned: false };
      if (commandJourney) {
        const ownersPath = join(evidence, "owners.json");
        if (existsSync(ownersPath)) {
          const owners = JSON.parse(readFileSync(ownersPath, "utf8"));
          assert.equal(owners.driverPid, child.pid, "PTY owner manifest belongs to another driver");
          summary.process.ptyGroups = await stopRecordedPtyOwners(owners.pids);
        }
        const journey = JSON.parse(readFileSync(join(evidence, "journey.json"), "utf8"));
        assert.equal(journey.processStopped, true, "Interactive Pi cleanup not verified");
        summary.process.ptyOwners = journey.pids ?? [journey.pid];
        summary.process.processStopped = true;
      }
      if (summary.interrupted) {
        const path = join(evidence, "journey.json");
        assert.ok(existsSync(path) && JSON.parse(readFileSync(path, "utf8")).processStopped === true,
          "Interrupted fixture cleanup needs inspection; retain scratch and lock");
      }
    });
    await stage("log", () => finishOutput({ child, closed, log }));
    // Archive independently: a failed process check must not discard configuration proof.
    await stage("archive", async () => {
      summary.archive = archiveEvidence({ repo, scratch, evidence, before, selected: fixtureCase,
        reportedEvidence: reportedEvidencePaths(join(evidence, "output.log")) });
      assert.equal(summary.archive.errors.length, 0, "Evidence archive incomplete");
    });
    if (cleanupErrors.length === 0) await stage("scratch", async () => {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    });
    summary.cleanup = cleanupErrors.length === 0 ? "removed" : "unverified";
    if (cleanupErrors.length) {
      summary.cleanupErrors = cleanupErrors;
      summary.status = "failed";
      process.exitCode = 1;
    }
    process.off("SIGINT", onInt); process.off("SIGTERM", onTerm);
    writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    if (summary.cleanup === "removed") rmSync(lock);
    assert.ok(existsSync(join(evidence, "summary.json")), "Cleanup removed evidence");
    console.log(JSON.stringify(summary));
  }
}
