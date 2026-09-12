import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const mode = process.argv.includes("--fullscreen") ? "fullscreen" : "regular";
const historyIndex = process.argv.indexOf("--history");
const history = historyIndex === -1 ? 0 : Number(process.argv[historyIndex + 1]);
if (!Number.isSafeInteger(history) || history < 0 || history > 5000) throw new Error("--history must be an integer between 0 and 5000.");
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this prototype in an interactive terminal.");

await mkdir(join(here, ".tmp"), { recursive: true });
const run = await mkdtemp(join(here, ".tmp/run-"));
const workspace = join(run, "pi-ext-preview");
const agentDir = join(run, "agent");
const sessions = join(run, "sessions");
let child;
const handlers = new Map();
try {
  for (const path of [workspace, agentDir, sessions, join(run, "home"), join(run, "tmp")]) await mkdir(path, { recursive: true });
  process.env.PI_OFFLINE = "1";
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const session = SessionManager.create(workspace, sessions);
  session.appendSessionInfo("Goal footer prototype");
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = (text) => session.appendMessage({ role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "openai", model: "gpt-4.1", usage, stopReason: "stop", timestamp: Date.now() });
  for (let i = 0; i < history; i++) {
    session.appendMessage({ role: "user", content: `Fixture history ${i + 1}: review the goal display.`, timestamp: Date.now() });
    assistant(`Fixture response ${i + 1}.\n\nKeep the original goal accounting and update only the presentation.\n\n\`\`\`ts\nconst elapsedMinutes = Math.floor(elapsedSeconds / 60);\n\`\`\``);
  }
  session.appendMessage({ role: "user", content: "完成 goal extension 的界面改版，计时不要造成持续高 CPU 占用。", timestamp: Date.now() });
  assistant("Offline prototype · goal and usage are fixtures, not a running agent.\n\nThe footer shows elapsed minutes. Open `/goal` for exact seconds.\n\n- `/goal boundary`: jump to 12m 58s, then watch 12m become 13m.\n- `/goal pause`, `/goal resume`, `/goal complete`: switch states immediately.\n- `/goal fresh`, `/goal hour`: inspect <1m and the hour boundary.\n- `/goal reset`: restart the fixture. `/quit`: exit.\n\nNo model requests or goal storage writes. The clock starts at 12m 55s.");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    theme: "codex-pi", defaultProvider: "openai", defaultModel: "gpt-4.1",
    quietStartup: true, compaction: { enabled: false },
  }));
  const env = Object.fromEntries(["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  Object.assign(env, {
    HOME: join(run, "home"), TMPDIR: join(run, "tmp"), XDG_CACHE_HOME: join(run, "cache"),
    PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: sessions,
    PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
    GOAL_FOOTER_PROTOTYPE: "1", NO_UPDATE_NOTIFIER: "1",
  });
  const cli = join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "cli.js");
  child = spawn(process.execPath, [
    "--import", join(here, "offline.mjs"), cli,
    "--no-extensions", "--extension", join(here, "src/index.ts"),
    "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes",
    "--theme", join(root, "themes/codex-pi.json"), "--use-theme", "codex-pi",
    "--approve", "--offline", "--no-builtin-tools", "--session", session.getSessionFile(),
    "--session-dir", sessions, "--provider", "openai", "--model", "gpt-4.1",
    "--api-key", "offline-fixture-not-a-credential", "--tui-mode", mode,
  ], { cwd: workspace, env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  const result = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  process.exitCode = result.signal ? 1 : result.code ?? 1;
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(run, { recursive: true, force: true });
}
