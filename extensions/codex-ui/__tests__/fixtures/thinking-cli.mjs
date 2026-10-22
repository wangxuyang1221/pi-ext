import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
if (!process.argv.includes("--smoke") && (!process.stdin.isTTY || !process.stdout.isTTY)) {
  throw new Error("Use an interactive terminal, or pass --smoke.");
}
await mkdir(join(repo, ".tmp"), { recursive:true });
const root = await mkdtemp(join(repo, ".tmp/thinking-production-"));
let child;
const handlers = new Map();
try {
  for (const name of ["workspace", "home", "agent", "tmp"]) await mkdir(join(root, name));
  const env = Object.fromEntries(["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"]
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  Object.assign(env, {
    HOME:join(root,"home"), TMPDIR:join(root,"tmp"), PI_CODING_AGENT_DIR:join(root,"agent"),
    XDG_CACHE_HOME:join(root,"cache"), XDG_CONFIG_HOME:join(root,"config"), XDG_DATA_HOME:join(root,"data"),
    XDG_STATE_HOME:join(root,"state"), PI_OFFLINE:"1", PI_TELEMETRY:"0", PI_SKIP_VERSION_CHECK:"1",
    THINKING_TEST_ROOT:root, THINKING_TEST_REPO:repo,
  });
  child = spawn(process.execPath, [join(here,"thinking-runtime.mjs"), ...process.argv.slice(2)],
    {cwd:join(root,"workspace"), env, stdio:"inherit"});
  for (const signal of ["SIGINT","SIGTERM","SIGHUP"]) {
    const handler = () => child.kill(signal);
    handlers.set(signal,handler); process.on(signal,handler);
  }
  process.exitCode = await new Promise((done,reject) => {
    child.once("error",reject); child.once("exit",code => done(code ?? 1));
  });
} finally {
  for (const [signal,handler] of handlers) process.off(signal,handler);
  await rm(root,{recursive:true,force:true});
}
