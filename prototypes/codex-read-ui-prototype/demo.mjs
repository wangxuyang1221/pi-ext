// PROTOTYPE: Compile into a disposable workspace and launch the repository-pinned Pi CLI.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../..");
const args = process.argv.slice(2).filter(arg => arg !== "--");
const option = name => {
  const inline = args.find(arg => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
};
const scene = option("scene") ?? "batch";
const variant = option("variant") ?? "1";
if (!["0", "1", "2", "3", "4", "5", "6"].includes(variant)) throw new Error(`Invalid variant: ${variant}`);
if (!["single", "batch", "long", "error"].includes(scene)) throw new Error(`Invalid scene: ${scene}`);
if (args.includes("--help")) {
  console.log("pnpm run prototype:read-ui [--variant 0|1|2|3|4|5|6] [--scene single|batch|long|error] [--fullscreen] [--smoke] [--pty-smoke]");
  process.exit(0);
}

const temporaryRoot = join(directory, ".tmp");
mkdirSync(temporaryRoot, { recursive: true });
const run = mkdtempSync(join(temporaryRoot, "run-"));
let activeChild;
const cleanup = () => rmSync(run, { recursive: true, force: true });
const handlers = new Map();
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const handler = () => {
    if (activeChild?.pid) activeChild.kill(signal);
    else process.exit(128);
  };
  handlers.set(signal, handler);
  process.on(signal, handler);
}

try {
  for (const name of ["workspace", "home", "agent", "cache", "tmp", "sessions", "build"]) mkdirSync(join(run, name));
  const build = join(run, "build");
  console.log("Building the isolated Read UI prototype...");
  await child("pnpm", ["exec", "tsc", "-p", join(directory, "tsconfig.json"), "--noEmit", "false", "--outDir", build], { cwd: repository, env: process.env });
  const compiled = join(build, "prototypes/codex-read-ui-prototype");
  const env = isolatedEnvironment();
  if (args.includes("--smoke")) {
    await child(process.execPath, ["--test", join(compiled, "__tests__/prototype.test.js")], { cwd: repository, env });
  } else {
    const { fixturesFor } = await import(pathToFileURL(join(compiled, "src/fixtures.js")).href);
    const session = join(run, "sessions/fixture.jsonl");
    writeFileSync(session, sessionFixture(fixturesFor(scene)));
    writeFileSync(join(run, "agent/settings.json"), JSON.stringify({
      theme: "codex-pi", quietStartup: true,
      defaultProvider: "read-ui-fixture", defaultModel: "fixture",
      terminal: { mode: args.includes("--fullscreen") ? "fullscreen" : "regular" },
    }));
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const cli = join(packageRoot, pkg.bin.pi);
    const cliArgs = [cli,
      "--offline", "--approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes",
      "--theme", join(repository, "themes/codex-pi.json"), "--use-theme", "codex-pi",
      "--session", session, "--extension", join(compiled, "src/composed.js"),
      "--tui-mode", args.includes("--fullscreen") ? "fullscreen" : "regular",
    ];
    console.log(`Pi ${pkg.version} · variant ${variant} · ${scene} · fixture-only, offline`);
    if (args.includes("--pty-smoke")) {
      const { smokePty } = await import("./pty-smoke.mjs");
      await smokePty({ run, repository, env, cliArgs });
    } else {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive prototype requires a terminal. Use --smoke for non-interactive checks.");
      await child(process.execPath, cliArgs, { cwd: join(run, "workspace"), env });
    }
  }
} finally {
  cleanup();
  process.off("exit", cleanup);
  for (const [signal, handler] of handlers) process.off(signal, handler);
}

function isolatedEnvironment() {
  const env = {};
  // Deliberately do not inherit credentials, proxies, user Pi config, or session identifiers.
  for (const key of ["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env, TERM: env.TERM || "xterm-256color",
    HOME: join(run, "home"), TMPDIR: join(run, "tmp"),
    XDG_CONFIG_HOME: join(run, "home/.config"), XDG_CACHE_HOME: join(run, "cache"),
    PI_CODING_AGENT_DIR: join(run, "agent"), PI_CODING_AGENT_SESSION_DIR: join(run, "sessions"),
    JITI_FS_CACHE: join(run, "cache"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
    PI_READ_LAB_SCENE: scene, PI_READ_LAB_VARIANT: variant, PI_READ_LAB_REPOSITORY: repository,
  };
}

function sessionFixture(rows) {
  const timestamp = new Date().toISOString();
  const entries = [{ type: "session", version: 3, id: randomUUID(), timestamp, cwd: join(run, "workspace") }];
  let parentId = null;
  const append = message => {
    const id = entries.length.toString(16).padStart(8, "0");
    entries.push({ type: "message", id, parentId, timestamp, message: { ...message, timestamp: Date.now() } });
    parentId = id;
  };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = content => ({ role: "assistant", content, provider: "read-ui-fixture", model: "fixture", api: "openai-responses", usage, stopReason: "toolUse" });
  append({ role: "user", content: "Review the repository language policy before changing the UI." });
  append(assistant([{ type: "text", text: "I will inspect the relevant files first." }]));
  append(assistant(rows.map(row => ({ type: "toolCall", id: row.id, name: "read", arguments: row.args }))));
  for (const row of rows) append({
    role: "toolResult", toolCallId: row.id, toolName: "read",
    content: [{ type: "text", text: row.text }], isError: row.isError ?? false,
    details: { truncation: { truncated: row.truncated ?? false } },
  });
  append(assistant([{ type: "toolCall", id: "alignment-edit", name: "edit", arguments: { path: "fixture.ts", edits: [] } }]));
  append({ role: "toolResult", toolCallId: "alignment-edit", toolName: "edit", isError: false,
    content: [{ type: "text", text: "Successfully applied edit." }] });
  append({ ...assistant([{ type: "text", text: "The read records above are fixtures. No project files were changed." }]), stopReason: "stop" });
  return entries.map(entry => JSON.stringify(entry)).join("\n") + "\n";
}

async function child(command, childArgs, options) {
  const code = await new Promise((resolvePromise, reject) => {
    activeChild = spawn(command, childArgs, { ...options, stdio: "inherit" });
    activeChild.once("error", reject);
    activeChild.once("exit", (exitCode, signal) => resolvePromise(signal ? 128 : exitCode));
  });
  activeChild = undefined;
  if (code !== 0) throw new Error(`${command} exited with code ${code}`);
}
