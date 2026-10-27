import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { prepare } from "./prepare.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../..");
await mkdir(join(repo, ".tmp"), { recursive: true });
const root = await mkdtemp(join(repo, ".tmp/web-search-"));
const handlers = new Map();
try {
  for (const dir of ["workspace", "home", "tmp", "agent", "sessions", "runtime"]) await mkdir(join(root, dir));
  await prepare(repo, join(root, "runtime"));
  const env = Object.fromEntries(["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", WEB_SEARCH_ROOT: root, WEB_SEARCH_FULLSCREEN: process.argv.includes("--fullscreen") ? "1" : "0" });
  let child;
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"]) {
    const handler = () => { stopping = true; child?.kill(signal); }; handlers.set(signal, handler); process.on(signal, handler);
  }
  const launches = process.argv.includes("--restart") ? 2 : 1;
  for (let attempt = 0; attempt < launches && !stopping; attempt++) {
    child = spawn(process.execPath, [join(here, "runtime.mjs")], { cwd: join(root, "workspace"), env: { ...env, WEB_SEARCH_RESUME: attempt ? "1" : "0" }, stdio: "inherit" });
    process.exitCode = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", code => done(code ?? 1)); });
    if (process.exitCode !== 0) break;
  }
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(root, { recursive: true, force: true });
}
