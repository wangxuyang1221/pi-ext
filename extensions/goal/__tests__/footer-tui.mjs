import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
await mkdir(join(repo, ".tmp"), { recursive: true });
const root = await mkdtemp(join(repo, ".tmp/goal-footer-"));
const workspace = join(root, "workspace");
const agent = join(root, "agent");
const sessions = join(root, "sessions");
const handlers = new Map();
try {
  for (const path of [workspace, agent, sessions, join(root, "home"), join(root, "tmp")]) await mkdir(path);
  process.env.PI_OFFLINE = "1";
  process.env.PI_CODING_AGENT_DIR = agent;
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const session = SessionManager.create(workspace, sessions);
  session.appendMessage({ role: "user", content: "完成 goal extension 的界面改版。", timestamp: Date.now() });
  session.appendMessage({ role: "assistant", content: [{ type: "text", text: "Production goal UI · isolated fixture.\n\nUse /goal for an exact-time snapshot. The goal, usage and initial time are fixture data; model continuation is intercepted." }], api: "openai-responses", provider: "openai", model: "gpt-4.1", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
  await writeFile(join(agent, "settings.json"), JSON.stringify({ quietStartup: true, compaction: { enabled: false } }));
  const env = Object.fromEntries(["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: sessions, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", GOAL_FOOTER_TEST_ROOT: root, GOAL_FOOTER_NATIVE: process.argv.includes("--native") ? "1" : "0" });
  const cli = join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "cli.js");
  const child = spawn(process.execPath, ["--import", join(here, "footer-network.mjs"), cli,
    "--no-extensions", "--extension", join(here, "footer-fixture.ts"), "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes",
    "--theme", join(repo, "themes/codex-pi.json"), "--use-theme", "codex-pi", "--approve", "--offline", "--no-builtin-tools",
    "--session", session.getSessionFile(), "--session-dir", sessions, "--provider", "openai", "--model", "gpt-4.1", "--api-key", "offline-fixture",
    "--tui-mode", process.argv.includes("--fullscreen") ? "fullscreen" : "regular",
  ], { cwd: workspace, env, stdio: "inherit" });
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"]) { const handler = () => child.kill(signal); handlers.set(signal, handler); process.on(signal, handler); }
  process.exitCode = await new Promise((resolveExit, reject) => { child.once("error", reject); child.once("exit", code => resolveExit(code ?? 1)); });
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(root, { recursive: true, force: true });
}
