import assert from "node:assert/strict";
import { createTestEnvironment } from "../test-support/environment.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { inspectPiHost } from "./pi-host.mjs";
import { stopProcessGroup } from "./codex-compact-quality-process.mjs";
import { pnpmCommand } from "./pnpm-command.mjs";

const group = process.argv[2];
assert.ok(["pty", "benchmark"].includes(group), "Choose pty or benchmark");
assert.notEqual(process.platform, "win32", "Run Unix host acceptance on macOS or Linux; Windows uses pnpm run check");
assert.ok(process.env.npm_execpath, "Run host acceptance through pnpm");
const host = inspectPiHost();
const pnpm = (...args) => pnpmCommand(args);
const python = (file, ...args) => ["conda", "run", "--no-capture-output", "-n", "codex-py312", "python", file, ...args];
const { directory: root, env: isolatedEnv } = createTestEnvironment(`host-${group}`);
const env = { ...isolatedEnv, TERM: "xterm-256color", COLORTERM: "truecolor", SHELL: "/bin/sh",
   PI_MCP_TEST_PI_ROOT: host.root, PI_MCP_TEST_PI_VERSION: host.versions["pi-coding-agent"] };
mkdirSync(resolve(".tmp/test-results"), { recursive: true });
const reports = mkdtempSync(resolve(`.tmp/test-results/host-${group}-`));
const summary = { group, host, partial: process.argv.includes("--from"), status: "running", prerequisites: {}, commands: [], cleanup: "pending" };
const save = () => writeFileSync(join(reports, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ check: group, reports }));
const commands = {
  pty: [
    { command: [process.execPath, ".cursor/skills/verify-pi-openai-fast-mode/scripts/verify.mjs", "full"] },
    { command: python("extensions/mcp/__tests__/resume-ui-host.py", "--live", "--repeat", "1") },
    { command: pnpm("run", "tool-status:check") },
    { command: pnpm("run", "web-search:check") },
  ],
  benchmark: [
    { command: [process.execPath, "--expose-gc", "extensions/mcp/__tests__/fixtures/history-benchmark.mjs"] },
    { command: python("extensions/mcp/__tests__/render-input-host.py", "--pi-root", host.root, "--check") },
  ],
};
let child;
let cancelled;
const cancellation = new AbortController();
const signal = name => {
  cancelled = name;
  cancellation.abort(new Error(`Host acceptance cancelled: ${name}`));
  if (child?.pid) try { process.kill(-child.pid, name); } catch {}
};
const interrupt = () => signal("SIGINT"), terminate = () => signal("SIGTERM");
process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
try {
  const prerequisites = group === "pty" || group === "benchmark" ? [["conda", "run", "-n", "codex-py312", "python", "-c", "import pyte; import sys; print(sys.version)"]] : [];
  for (const [command, ...args] of prerequisites) {
    summary.prerequisites[command] = execFileSync(command, args, { env, encoding: "utf8", timeout: 60_000 }).trim();
  }
  const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : undefined;
  const start = from ? commands[group].findIndex(entry => entry.command.some(argument => argument.includes(from))) : 0;
  assert.ok(start >= 0, "Unknown host acceptance continuation command");
  for (const [index, entry] of commands[group].entries()) {
    if (index < start) continue;
    if (cancelled) throw new Error(`Host acceptance cancelled: ${cancelled}`);
    const started = performance.now();
    const record = { startedAt: new Date().toISOString(), command: entry.command, overrides: entry.env ?? {}, status: "running", cleanup: "pending" };
    summary.commands.push(record); save();
    console.log(JSON.stringify({ check: group, ...record }));
    const log = createWriteStream(join(reports, `${index}.log`));
    child = spawn(entry.command[0], entry.command.slice(1), { env: { ...env, ...entry.env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const closed = new Promise(resolve => child.once("close", resolve));
    child.stdout.on("data", data => { process.stdout.write(data); log.write(data); });
    child.stderr.on("data", data => { process.stderr.write(data); log.write(data); });
    try {
      const [code] = await once(child, "exit", { signal: AbortSignal.any([AbortSignal.timeout(600_000), cancellation.signal]) });
      record.exitCode = code;
      assert.equal(code, 0, `Host acceptance failed: ${entry.command.join(" ")}`);
      record.status = "passed";
    } catch (error) {
      record.status = "failed"; record.error = String(error); throw error;
    } finally {
      try {
        if (child.pid) record.cleanup = await stopProcessGroup(child);
        else record.cleanup = { groupStopped: true, spawned: false };
        await closed;
      } finally {
        record.elapsedMs = Math.round(performance.now() - started);
        log.end(); await once(log, "finish"); child = undefined; save();
      }
    }
  }
  if (cancelled) throw new Error(`Host acceptance cancelled: ${cancelled}`);
  summary.status = summary.partial ? "partial" : "passed";
} catch (error) {
  summary.status = "failed"; summary.error = String(error); throw error;
} finally {
  process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
  const stopped = summary.commands.every(command => command.cleanup?.groupStopped === true);
  if (stopped) { rmSync(root, { recursive: true, force: true }); summary.cleanup = "removed"; }
  else { summary.cleanup = "unverified"; summary.directory = root; }
  save();
}
