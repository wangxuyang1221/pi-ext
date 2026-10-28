#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestEnvironment } from "../../../../test-support/environment.mjs";
import { inspectPiHost } from "../../../../scripts/pi-host.mjs";
import { stopProcessGroup } from "../../../../scripts/codex-compact-quality-process.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
process.chdir(repo);
const host = inspectPiHost();
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const python = (...args) => ["conda", "run", "--no-capture-output", "-n", "codex-py312", "python", ...args];
const cases = {
  metadata: (root, evidence) => python(join(here, "commands.py"), "metadata", root, evidence),
  "metadata-project": (root, evidence) => python(join(here, "commands.py"), "metadata-project", root, evidence),
  fast: (root, evidence) => python(join(here, "commands.py"), "fast", root, evidence),
  permissions: (root, evidence) => python(join(here, "commands.py"), "permissions", root, evidence),
  "permissions-modes": (root, evidence) => [process.execPath, join(here, "permissions-modes.mjs"), root, evidence],
  goal: () => python("extensions/goal/__tests__/tool-ui-driver.py"),
  "goal-accounting": () => ["pnpm", "run", "host:accounting:check"],
  "goal-footer": () => ["pnpm", "run", "goal:footer:check"],
  mcp: () => python("extensions/mcp/__tests__/resume-ui-host.py", "--live", "--repeat", "1"),
  "mcp-transports": () => ["pnpm", "test", "extensions/mcp/__tests__/transport-fixtures.test.ts", "extensions/mcp/__tests__/progress-transport.test.ts", "extensions/mcp/__tests__/integration.test.ts"],
  subagent: () => ["pnpm", "run", "host:tmux:check"],
  "codex-ui": () => python("extensions/codex-ui/__tests__/codemode-pty.py"),
  "codex-ui-fullscreen": () => python("extensions/codex-ui/__tests__/codemode-pty.py", "--fullscreen"),
  thinking: () => python("extensions/codex-ui/__tests__/thinking-pty.py"),
  "tool-status": () => ["pnpm", "run", "tool-status:check"],
  search: () => python("extensions/codex-search/__tests__/fixtures/search-ui/smoke.py", "--restart"),
  "search-resume": () => ["pnpm", "run", "web-search:resume:check"],
  "search-references": () => ["pnpm", "test", "extensions/codex-search/__tests__/session-scope.test.ts", "extensions/codex-search/__tests__/ref-store.test.ts"],
  "skills-resume": (_root, evidence) => python("extensions/skill-mentions/__tests__/resume-summary-driver.py", join(evidence, "resume-summary"), "native"),
  compact: () => ["pnpm", "test", "extensions/codex-compact/__tests__/resume-runtime.test.ts", "extensions/codex-compact/__tests__/repair-runtime.test.ts"],
  skills: root => {
    mkdirSync(join(root, "consumer"));
    copyFileSync("extensions/skill-mentions/__tests__/pty-fixture.ts", join(root, "consumer/pty-fixture.ts"));
    return python("extensions/skill-mentions/__tests__/pty-driver.py", root, host.cli, repo, "native", `verify-${Date.now()}`);
  },
};

function doctor() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert.ok(major > 22 || major === 22 && minor >= 19, "Node 22.19+ required");
  const pnpm = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
  assert.equal(`pnpm@${pnpm}`, manifest.packageManager, "Use the repository pnpm version");
  for (const path of manifest.pi.extensions) assert.ok(existsSync(path), `Build missing: ${path}`);
  const pythonVersion = execFileSync("conda", ["run", "-n", "codex-py312", "python", "-c", "import sys, pyte; print(sys.version)"], { encoding: "utf8", timeout: 60000 }).trim();
  const gitRoot = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const dependencyRoot = realpathSync("node_modules");
  // The longest fixed prefix in the current subagent host fixture group.
  const socketPath = resolve(".subagent-integration-test-XXXXXX/tmux.sock");
  const socketLimit = process.platform === "darwin" ? 104 : process.platform === "linux" ? 108 : null;
  return { ...host, pnpm, python: pythonVersion, gitRoot, independentCheckout: gitRoot === realpathSync(repo),
    dependencyRoot, sharedDependencies: dependencyRoot !== join(realpathSync(repo), "node_modules"),
    subagentSocket: { path: socketPath, bytes: Buffer.byteLength(socketPath), limit: socketLimit,
      fits: socketLimit === null ? null : Buffer.byteLength(socketPath) < socketLimit },
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTree: execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim() };
}

const [operation, selected] = process.argv.slice(2);
const interactive = operation === "tui";
if (interactive) {
  assert.ok(readdirSync("extensions").includes(selected), "Unknown extension");
  cases[selected] = (root, evidence) => python(join(here, "commands.py"), `explore:${selected}`, root, evidence);
}
if (operation === "doctor") {
  console.log(JSON.stringify({ ...doctor(), lockPresent: existsSync(".tmp/verify-pi-ext.lock"), cases: Object.keys(cases) }, null, 2));
} else {
  assert.ok(operation === "run" || interactive, "Use doctor, run <case>, or tui <extension>");
  assert.ok(Object.hasOwn(cases, selected), `Unknown case: ${selected}`);
  const checked = doctor();
  if (selected === "subagent") assert.notEqual(checked.subagentSocket.fits, false,
    "Subagent fixture socket path is too long; use a shorter workspace path before running");
  mkdirSync(".tmp/test-results", { recursive: true });
  // Existing PTY fixtures have fixed evidence names; one run owns them at a time.
  const lock = resolve(".tmp/verify-pi-ext.lock");
  writeFileSync(lock, JSON.stringify({ pid: process.pid, case: selected }), { flag: "wx" });
  let scratch, child, log, closed;
  const evidence = mkdtempSync(resolve(`.tmp/test-results/verify-${selected}-`));
  const summary = { case: selected, doctor: checked, evidence, status: "running", cleanup: "pending" };
  const before = new Map();
  const evidenceFiles = () => [
    ...readdirSync(resolve(".tmp"), { withFileTypes: true }).filter(item => item.isFile() && /^(?:(?:.*production|.*thinking).*\.json|tool-status-smoke-.*\.json|tool-status-last\.ansi)$/.test(item.name)).map(item => resolve(".tmp", item.name)),
    ...readdirSync(resolve(".tmp/test-results"), { withFileTypes: true }).filter(item => !item.name.startsWith(`verify-${selected}-`)).map(item => resolve(".tmp/test-results", item.name)),
  ];
  for (const file of evidenceFiles()) before.set(file, statSync(file).mtimeMs);
  const abort = new AbortController();
  const interrupted = signal => abort.abort(new Error(`Verification interrupted: ${signal}`));
  const onInt = () => interrupted("SIGINT"), onTerm = () => interrupted("SIGTERM");
  process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
  try {
    const isolated = createTestEnvironment(`verify-${selected}`);
    scratch = isolated.directory;
    const command = cases[selected](scratch, evidence);
    Object.assign(summary, { command, scratch });
    writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ case: selected, command, evidence }));
    log = createWriteStream(join(evidence, "output.log"));
    child = spawn(command[0], command.slice(1), { cwd: repo, detached: !interactive, stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"], env: {
      ...isolated.env, TERM: "xterm-256color", COLORTERM: "truecolor", SHELL: "/bin/sh",
      GOAL_UI_EVIDENCE: join(evidence, "goal-ui"),
      PI_VERIFY_EVIDENCE: evidence,
    } });
    closed = new Promise(resolve => child.once("close", resolve));
    summary.pid = child.pid;
    writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2));
    child.stdout?.on("data", data => log.write(data));
    child.stderr?.on("data", data => log.write(data));
    const [code] = await once(child, "exit", { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(900000)]) });
    summary.exitCode = code;
    assert.equal(code, 0, `Verification failed; read ${join(evidence, "output.log")}`);
    summary.status = interactive ? "manual-review-required" : "passed";
  } catch (error) {
    summary.status = "failed"; summary.error = String(error); process.exitCode = 1;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      // Give Python's finally blocks a chance to reap their separate PTY groups.
      try { if (interactive) child.kill("SIGTERM"); else process.kill(-child.pid, "SIGTERM"); } catch {}
      summary.interrupted = true;
    }
  } finally {
    try {
      if (interactive && child?.pid) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        if (child.exitCode === null && child.signalCode === null) await once(child, "exit", { signal: AbortSignal.timeout(10000) });
        const journey = JSON.parse(readFileSync(join(evidence, "journey.json"), "utf8"));
        assert.equal(journey.processStopped, true, "Interactive Pi cleanup not verified");
        summary.process = { pid: child.pid, processStopped: true, groupStopped: true };
      } else summary.process = child?.pid ? await stopProcessGroup(child) : { groupStopped: true, spawned: false };
      if (closed) await closed;
      if (log) { log.end(); await once(log, "finish"); }
      // Copy fixture proof before deleting scratch. Fixed-name proof is copied on every run.
      mkdirSync(join(evidence, "artifacts"), { recursive: true });
      for (const file of evidenceFiles()) {
        if (!before.has(file) || statSync(file).mtimeMs !== before.get(file)) {
          cpSync(file, join(evidence, "artifacts", file.split("/").at(-1)), { recursive: true });
        }
      }
      if (summary.interrupted) {
        const path = join(evidence, "journey.json");
        assert.ok(existsSync(path) && JSON.parse(readFileSync(path, "utf8")).processStopped === true,
          "Interrupted fixture cleanup needs inspection; retain scratch and lock");
      }
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      summary.cleanup = "removed";
    } catch (error) {
      summary.cleanup = "unverified"; summary.cleanupError = String(error); summary.status = "failed"; process.exitCode = 1;
    } finally {
      process.off("SIGINT", onInt); process.off("SIGTERM", onTerm);
      writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
      if (summary.cleanup === "removed") rmSync(lock);
      assert.ok(existsSync(join(evidence, "summary.json")), "Cleanup removed evidence");
      console.log(JSON.stringify(summary));
    }
  }
}
