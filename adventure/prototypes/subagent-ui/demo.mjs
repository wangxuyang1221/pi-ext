import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { prepare } from "./prepare.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
await mkdir(join(repo, ".tmp"), { recursive: true });
const root = await mkdtemp(join(repo, ".tmp/subagent-ui-"));
const handlers = new Map();
try {
  for (const dir of ["workspace", "tmp", "agent", "sessions", "runtime"]) await mkdir(join(root, dir));
  await prepare(repo, join(root, "runtime"));
  const env = Object.fromEntries(["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", SUBAGENT_UI_ROOT: root });
  const child = spawn(process.execPath, [join(here, "runtime.mjs"), ...process.argv.slice(2)], { cwd: join(root, "workspace"), env, stdio: "inherit" });
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"]) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler); process.on(signal, handler);
  }
  process.exitCode = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", code => done(code ?? 1)); });
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(root, { recursive: true, force: true });
}
