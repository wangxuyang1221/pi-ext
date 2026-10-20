import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { prepare } from "./prepare.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const variants = ["--3", "--4", "--both", "--chevron", "--command", "--wave"];
if (args.some(arg => !["--fullscreen", "--production", ...variants].includes(arg)) || variants.filter(arg => args.includes(arg)).length > 1) {
  throw new Error("Usage: pnpm exec node prototypes/mcp-icon-prototype/demo.mjs [--wave|--command|--chevron|--3|--4|--both] [--fullscreen] [--production]");
}
const production = args.includes("--production");
const variant = variants.find(arg => args.includes(arg))?.slice(2) || "wave";
if (production && variant !== "wave") throw new Error("Production mode does not support alternative icons.");
await mkdir(join(repo, ".tmp"), { recursive: true });
const root = await mkdtemp(join(repo, ".tmp/mcp-icon-"));
const handlers = new Map();
try {
  for (const dir of ["workspace", "home", "tmp", "agent", "sessions", "runtime"]) await mkdir(join(root, dir));
  await prepare(repo, join(root, "runtime"), production);
  const env = Object.fromEntries(["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, {
    HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0", MCP_ICON_ROOT: root,
    MCP_ICON_VARIANT: variant, MCP_ICON_PRODUCTION: production ? "1" : "0",
    MCP_ICON_FULLSCREEN: args.includes("--fullscreen") ? "1" : "0",
  });
  const child = spawn(process.execPath, [join(repo, "prototypes/mcp-icon-prototype/runtime.mjs")], {
    cwd: join(root, "workspace"), env, stdio: "inherit",
  });
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"]) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  process.exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", code => done(code ?? 1));
  });
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(root, { recursive: true, force: true });
}
