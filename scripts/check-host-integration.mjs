import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { inspectPiHost } from "./pi-host.mjs";
import { stopProcessGroup } from "./codex-compact-quality-process.mjs";

const group = process.argv[2];
assert.ok(["tmux", "accounting", "pty", "benchmark"].includes(group), "Choose tmux, accounting, pty or benchmark");
assert.notEqual(process.platform, "win32", "Run Unix host acceptance on macOS or Linux; Windows uses pnpm run check");
assert.ok(process.env.npm_execpath, "Run host acceptance through pnpm");
const host = inspectPiHost();
const pnpm = (...args) => [process.execPath, process.env.npm_execpath, ...args];
const node = file => [process.execPath, file, host.root];
const python = (file, ...args) => ["conda", "run", "--no-capture-output", "-n", "codex-py312", "python", file, ...args];
mkdirSync(resolve(".tmp"), { recursive: true });
const root = mkdtempSync(resolve(`.tmp/host-${group}-`));
for (const name of ["home", "agent", "tmp", "cache", "config", "data", "state"]) mkdirSync(join(root, name));
const env = { PATH: process.env.PATH, LANG: process.env.LANG ?? "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor", SHELL: "/bin/sh",
  HOME: join(root, "home"), PI_CODING_AGENT_DIR: join(root, "agent"), TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
  XDG_CACHE_HOME: join(root, "cache"), XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
  PI_OFFLINE: "1", PI_TELEMETRY: "0", PYTHONDONTWRITEBYTECODE: "1", PI_SUBAGENT_TEST_CLI: host.cli,
  PI_MCP_TEST_PI_ROOT: host.root, PI_MCP_TEST_PI_VERSION: host.versions["pi-coding-agent"] };
const files = ["isolated-integration", "production-integration", "fast-production"].map(name => `extensions/subagent/__tests__/${name}.test.ts`);
const commands = {
  tmux: [
    { command: pnpm("test", "--no-file-parallelism", ...files), env: { PI_SUBAGENT_ISOLATED_INTEGRATION: "1" } },
    { command: pnpm("test", "--no-file-parallelism", ...files), env: { PI_SUBAGENT_ISOLATED_INTEGRATION: "1", PI_SUBAGENT_FIXTURE_DIST: "1" } },
  ],
  accounting: ["accounting-runtime", "accounting-child-runtime", "provider-runtime", "terminal-runtime"].map(name =>
    ({ command: node(`extensions/goal/__tests__/${name}.mjs`) })),
  pty: [
    { command: pnpm("run", "goal:footer:check") },
    ...[[], ["--fullscreen"]].map(args => ({ command: python("extensions/goal/__tests__/tool-ui-driver.py", ...args) })),
    { command: python("extensions/mcp/__tests__/resume-ui-host.py", "--live", "--repeat", "1") },
    { command: pnpm("run", "tool-status:check") },
    { command: pnpm("run", "web-search:check") },
    ...["root", "child"].map(source => ({ command: python("extensions/goal/__tests__/accounting-tui-driver.py", join(root, `accounting-${source}`), host.root),
      env: { GOAL_USAGE_SOURCE: source } })),
  ],
  benchmark: [
    { command: [process.execPath, "extensions/goal/__tests__/footer-benchmark.mjs"] },
    { command: [process.execPath, "--expose-gc", "extensions/mcp/__tests__/fixtures/history-benchmark.mjs"] },
    { command: python("extensions/mcp/__tests__/render-input-host.py", "--pi-root", host.root, "--check") },
  ],
};
let child;
const interrupt = () => { if (child?.pid) try { process.kill(-child.pid, "SIGINT"); } catch {} };
const terminate = () => { if (child?.pid) try { process.kill(-child.pid, "SIGTERM"); } catch {} };
process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
try {
  for (const entry of commands[group]) {
    console.log(JSON.stringify({ check: group, host, command: entry.command, overrides: entry.env ?? {} }));
    child = spawn(entry.command[0], entry.command.slice(1), { env: { ...env, ...entry.env }, stdio: "inherit", detached: true });
    try {
      const [code] = await once(child, "exit", { signal: AbortSignal.timeout(600_000) });
      assert.equal(code, 0, `Host acceptance failed: ${entry.command.join(" ")}`);
    } finally {
      if (child.pid) console.log(JSON.stringify({ check: group, cleanup: await stopProcessGroup(child) }));
      child = undefined;
    }
  }
} finally {
  process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
  rmSync(root, { recursive: true, force: true });
}
