import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { prepare } from "./prepare.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
await mkdir(join(repo, ".tmp"), { recursive: true });
const root = await mkdtemp(join(repo, ".tmp/tool-status-"));
const handlers = new Map();
try {
  for (const path of ["workspace", "home", "tmp", "agent", "sessions", "runtime"]) await mkdir(join(root, path));
  await prepare(repo, join(root, "runtime"), process.argv.includes("--before"), process.argv.includes("--production"));
  const env = Object.fromEntries(["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", TOOL_STATUS_ROOT: root, TOOL_STATUS_REPO: repo, TOOL_STATUS_BEFORE: process.argv.includes("--before") ? "1" : "0", TOOL_STATUS_PRODUCTION: process.argv.includes("--production") ? "1" : "0", TOOL_STATUS_LOW_POWER: process.argv.includes("--lowpower") ? "1" : "0", TOOL_STATUS_MCP_ONLY: process.argv.includes("--mcp-only") ? "1" : "0", TOOL_STATUS_FULLSCREEN: process.argv.includes("--fullscreen") ? "1" : "0" });
  let child;
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"]) {
    const handler = () => { stopping = true; child?.kill(signal); }; handlers.set(signal, handler); process.on(signal, handler);
  }
  const launches = process.argv.includes("--production") && process.argv.includes("--restart") ? 2 : 1;
  for (let attempt = 0; attempt < launches && !stopping; attempt++) {
    child = spawn(process.execPath, [join(here, "runtime.mjs")], { cwd: join(root, "workspace"), env: { ...env, TOOL_STATUS_RESUME: attempt ? "1" : "0" }, stdio: "inherit" });
    process.exitCode = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", code => done(code ?? 1)); });
    if (process.exitCode !== 0) break;
  }
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(root, { recursive: true, force: true });
}
