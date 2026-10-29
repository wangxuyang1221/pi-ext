import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const [scenario = "combination", evidenceArgument] = process.argv.slice(2);
assert(["combination", "combination-prebuilt", "permission", "resume", "mutation"].includes(scenario), "Unknown skill journey");
let evidence;
let scratch;
let python;
const cli = join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const commands = [];
const prefix = `skill-${scenario}-${Date.now()}`;
const sha = content => createHash("sha256").update(content).digest("hex");
const sourcePath = join(repo, "extensions/skill-mentions/src/loading.ts");
const originalSource = readFileSync(sourcePath, "utf8");
let passed = false;
let pendingProof;
let active;
let interrupted;
let failure;
let forcedStop = false;
const flushCommands = () => {
  if (evidence) writeFileSync(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
};
function forwardSignal(signal) {
  if (!active?.child.pid) return;
  active.record.forwardedSignal = signal;
  try { process.kill(-active.child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") active.record.signalError = error.message; }
  flushCommands();
  active.beginShutdown();
}
function onSignal(signal) {
  interrupted ??= signal;
  forwardSignal("SIGTERM");
}
const onTerm = () => onSignal("SIGTERM");
const onInt = () => onSignal("SIGINT");
process.on("SIGTERM", onTerm);
process.on("SIGINT", onInt);

async function run(command, args, expectedFailure = false) {
  if (interrupted) throw new Error(`Journey interrupted by ${interrupted}`);
  const record = { command: [command, ...args], status: null, signal: null, stdout: "", stderr: "", state: "starting" };
  commands.push(record);
  flushCommands();
  const result = await new Promise(resolveRun => {
    let done = false;
    let shutdownTimer;
    let abandonTimer;
    const child = spawn(command, args, { cwd: repo, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const finish = (status, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearTimeout(shutdownTimer);
      clearTimeout(abandonTimer);
      record.status = status;
      record.signal = signal;
      record.state = "closed";
      try {
        if (child.pid) process.kill(-child.pid, 0);
        record.groupStopped = !child.pid;
      } catch (error) {
        record.groupStopped = error.code === "ESRCH";
      }
      active = undefined;
      flushCommands();
      resolveRun(record);
    };
    const beginShutdown = () => {
      if (shutdownTimer) return;
      shutdownTimer = setTimeout(() => {
        forcedStop = true;
        record.forcedStop = true;
        try { if (child.pid) process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if (error.code !== "ESRCH") record.signalError = error.message; }
        flushCommands();
        abandonTimer = setTimeout(() => {
          record.error = "Child did not close after SIGKILL; preserve scratch for manual process verification";
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          finish(null, "SIGKILL");
        }, 2_000);
      }, 15_000);
    };
    active = { child, record, beginShutdown };
    const timeout = setTimeout(() => {
      record.error = "Command exceeded 180000ms timeout";
      forwardSignal("SIGTERM");
    }, 180_000);
    child.once("spawn", () => {
      record.pid = child.pid;
      record.state = "running";
      flushCommands();
      if (interrupted) forwardSignal("SIGTERM");
    });
    child.stdout.setEncoding("utf8").on("data", chunk => { record.stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { record.stderr += chunk; });
    child.once("error", error => { record.error = error.message; });
    child.once("close", finish);
  });
  if (result.error) throw new Error(result.error);
  if (!expectedFailure) assert.equal(result.status, 0, result.stderr || result.stdout || result.error);
  if (interrupted) throw new Error(`Journey interrupted by ${interrupted}`);
  return record;
}
async function pty(label, installed = repo, scope = scenario) {
  const root = join(scratch, label);
  mkdirSync(join(root, "consumer"), { recursive: true });
  copyFileSync(join(here, "pty-fixture.ts"), join(root, "consumer/pty-fixture.ts"));
  const evidencePrefix = `${prefix}-${label}`;
  const source = join(repo, ".tmp/test-results", `${evidencePrefix}-pty-combined-fullscreen`);
  pendingProof = join(source, "result.json");
  let result;
  try {
    result = await run(python, [join(here, "pty-driver.py"), root, cli, installed, "combined-fullscreen", evidencePrefix, scope], true);
  } finally {
    if (existsSync(source)) cpSync(source, join(evidence, label), { recursive: true });
  }
  assert(existsSync(pendingProof) && JSON.parse(readFileSync(pendingProof, "utf8")).processesStopped, "Preserve scratch until PTY process cleanup is verified");
  pendingProof = undefined;
  if (label !== "mutant") assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
try {
  mkdirSync(join(repo, ".tmp/test-results"), { recursive: true });
  const requestedEvidence = resolve(evidenceArgument ?? process.env.PI_VERIFY_EVIDENCE ?? mkdtempSync(join(repo, ".tmp/test-results/skill-journeys-")));
  assert(requestedEvidence.startsWith(join(repo, ".tmp/")), "Evidence must remain inside repository .tmp");
  evidence = requestedEvidence;
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, "runner.json"), JSON.stringify({ pid: process.pid, scenario, evidence, startedAt: new Date().toISOString() }, null, 2));
  flushCommands();
  scratch = mkdtempSync(join(repo, ".tmp/skill-journey-"));
  const interpreter = await run("conda", ["run", "-n", "codex-py312", "python", "-c", "import sys; print(sys.executable)"]);
  python = interpreter.stdout.trim();
  assert(python.startsWith("/") && existsSync(python), "Conda must return an existing absolute Python executable");
  if (scenario === "resume") {
    for (const mode of ["native", "native-fullscreen", "codex", "codex-fullscreen"]) {
      pendingProof = join(evidence, mode, "journey.json");
      await run(python, [join(here, "resume-summary-driver.py"), join(evidence, mode), mode]);
      assert(JSON.parse(readFileSync(pendingProof, "utf8")).stopped.every(Boolean), "All resume children must stop");
      pendingProof = undefined;
    }
  } else if (scenario === "mutation") {
    // Compile a private source copy. Repository source and dist remain untouched.
    const installed = join(scratch, "package");
    const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, "package.json"), JSON.stringify(manifest));
    for (const entry of manifest.pi.extensions) cpSync(dirname(join(repo, entry)), dirname(join(installed, entry)), { recursive: true });
    cpSync(join(repo, "themes"), join(installed, "themes"), { recursive: true });
    const extension = join(installed, "extensions/skill-mentions");
    cpSync(join(repo, "extensions/skill-mentions/src"), join(extension, "src"), { recursive: true });
    const config = join(extension, "tsconfig.json");
    writeFileSync(config, JSON.stringify({ extends: join(repo, "tsconfig.base.json"), compilerOptions: { rootDir: "./src", outDir: "./dist" }, include: ["src/**/*.ts"] }));
    const compile = () => run("pnpm", ["exec", "tsc", "-p", config]);
    const privateSource = join(extension, "src/loading.ts");
    await compile();
    await pty("baseline", installed, "combination");
    const marker = "stripFrontmatter(await read(location)).trim()";
    assert(originalSource.includes(marker), "Snapshot mutation target must match the current source");
    const mutant = originalSource.replace("/** Resolve complete", "const snapshotReadCache = new Map<string, string>();\n\n/** Resolve complete").replace(marker,
      "stripFrontmatter(snapshotReadCache.has(location) ? snapshotReadCache.get(location)! : await read(location).then(body => { snapshotReadCache.set(location, body); return body; })).trim()");
    writeFileSync(privateSource, mutant);
    writeFileSync(join(evidence, "mutant-loading.ts"), mutant);
    await compile();
    const failed = await pty("mutant", installed, "combination");
    assert.notEqual(failed.status, 0, "Cached-file mutation must fail the same combination journey");
    assert.match(failed.stderr, /New request must read VERSION_TWO after external source edit/, "Mutation must fail on the changed-file contract, not startup");
    writeFileSync(privateSource, originalSource);
    await compile();
    await pty("restored", installed, "combination");
  } else await pty(scenario);
  passed = true;
} catch (error) {
  failure = error.stack ?? String(error);
  process.exitCode = interrupted === "SIGINT" ? 130 : interrupted ? 143 : 1;
} finally {
  let proof;
  try { if (pendingProof && existsSync(pendingProof)) proof = JSON.parse(readFileSync(pendingProof, "utf8")); }
  catch (error) { failure ??= `Cannot read cleanup proof: ${error.message}`; }
  const sourceUnchanged = readFileSync(sourcePath, "utf8") === originalSource;
  const groupsStopped = commands.every(command => command.groupStopped !== false);
  const cleanupVerified = !forcedStop && groupsStopped && (!pendingProof || proof?.processesStopped === true || proof?.stopped?.every(Boolean) === true);
  if (cleanupVerified && scratch) rmSync(scratch, { recursive: true, force: true });
  if (!sourceUnchanged || !cleanupVerified) process.exitCode ||= 1;
  flushCommands();
  if (evidence) writeFileSync(join(evidence, "summary.json"), JSON.stringify({ scenario, passed, evidence, scratch, interrupted, failure, cleanupVerified, scratchRemoved: !scratch || !existsSync(scratch), sourceUnchanged, sourceSha256: sha(originalSource), commands: commands.map(({ stdout, stderr, ...item }) => item), boundary: "Real CLI/PTY with offline provider; local MCP stdio; no remote model service or terminal clipboard proof" }, null, 2));
  process.off("SIGTERM", onTerm);
  process.off("SIGINT", onInt);
}
console.log(JSON.stringify({ scenario, passed, evidence, interrupted, failure }));
