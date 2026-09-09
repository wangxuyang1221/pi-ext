// PROTOTYPE: Keep the real Pi host and Codex UI; replace only MCP state and presentation.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prototypeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(prototypeDir, "../..");
const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const tempRoot = join(prototypeDir, ".tmp");
await mkdir(tempRoot, { recursive: true });
const runDir = await mkdtemp(join(tempRoot, "run-"));
const handlers = new Map();
try {
  for (const folder of ["agent", "home", "cache", "tmp"]) await mkdir(join(runDir, folder));
  const child = spawn(process.execPath, [
    join(piDist, "bundle/cli.js"),
    "--no-extensions",
    "--extension", join(repoRoot, "extensions/codex-ui/src/index.ts"),
    "--extension", join(prototypeDir, "src/index.ts"),
    "--theme", join(repoRoot, "themes/codex-pi.json"), "--use-theme", "codex-pi",
    "--no-session", "--no-context-files", "--no-skills", "--no-prompt-templates",
    "--offline", "--approve",
  ], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      TERM: process.env.TERM ?? "xterm-256color",
      COLORTERM: process.env.COLORTERM ?? "truecolor",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      HOME: join(runDir, "home"),
      TMPDIR: join(runDir, "tmp"),
      XDG_CACHE_HOME: join(runDir, "cache"),
      JITI_FS_CACHE: join(runDir, "cache"),
      PI_CODING_AGENT_DIR: join(runDir, "agent"),
      PI_CODING_AGENT_SESSION_DIR: join(runDir, "agent"),
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
    },
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  process.exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(signal ? 1 : code ?? 1));
  });
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(runDir, { recursive: true, force: true });
}
