// PROTOTYPE: Launch the repository-pinned Pi CLI with isolated, disposable state.
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
if (args.includes("--help")) {
  console.log("pnpm run prototype:edit-spacing [--variant 1|2|3] [--reply-style current|list|quote|indented] [--output-pad 0|1] [--production-replies] [--regular] [--smoke] [--pty-smoke]");
  process.exit(0);
}
const variant = option("variant") ?? "1";
if (!["1", "2", "3"].includes(variant)) throw new Error(`Invalid variant: ${variant}`);
const productionReplies = args.includes("--production-replies");
const replyStyle = productionReplies ? "list" : option("reply-style") ?? "list";
if (!["current", "list", "quote", "indented"].includes(replyStyle)) throw new Error(`Invalid reply style: ${replyStyle}`);
const outputPad = option("output-pad") ?? "0";
if (!["0", "1"].includes(outputPad)) throw new Error(`Invalid output padding: ${outputPad}`);
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
  console.log("Building the isolated edit spacing prototype...");
  await child("pnpm", ["exec", "tsc", "-p", join(directory, "tsconfig.json"), "--noEmit", "false", "--outDir", build], { cwd: repository, env: process.env });
  const compiled = join(build, "prototypes/codex-edit-spacing-prototype");
  const env = isolatedEnvironment();
  if (args.includes("--smoke")) {
    await child(process.execPath, ["--test", join(compiled, "__tests__/prototype.test.js")], { cwd: repository, env });
  } else {
    const { fixtures, assistantReply } = await import(pathToFileURL(join(compiled, "src/fixtures.js")).href);
    const session = join(run, "sessions/fixture.jsonl");
    writeFileSync(session, sessionFixture(fixtures, assistantReply));
    const mode = args.includes("--regular") ? "regular" : "fullscreen";
    writeFileSync(join(run, "agent/settings.json"), JSON.stringify({
      theme: "codex-pi", quietStartup: true, outputPad: Number(outputPad),
      defaultProvider: "spacing-ui-fixture", defaultModel: "fixture", terminal: { mode },
    }));
    const root = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    // Public alternatives use the real packaged CLI. Only the older gutter experiment
    // needs an unbundled host and a preload sharing its native component classes.
    const hostArgs = replyStyle === "indented"
      ? ["--import", pathToFileURL(join(compiled, "src/native-host.js")).href, join(root, "dist/cli.js")]
      : [join(root, pkg.bin.pi)];
    const cliArgs = [...hostArgs,
      "--offline", "--approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes",
      "--theme", join(repository, "themes/codex-pi.json"), "--use-theme", "codex-pi",
      "--session", session, "--extension", join(compiled, "src/index.js"), "--tui-mode", mode,
    ];
    console.log(`Pi ${pkg.version} · edit ${variant} · reply ${replyStyle} · outputPad ${outputPad} · ${replyStyle === "indented" ? "legacy lab host" : "packaged CLI, public API"} · fixture-only, offline`);
    if (args.includes("--pty-smoke")) {
      const { smokePty } = await import("./pty-smoke.mjs");
      await smokePty({ run, env, cliArgs });
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
  // Do not inherit credentials, proxies, user configuration, or session identifiers.
  for (const key of ["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env, TERM: env.TERM || "xterm-256color", FORCE_COLOR: "3",
    HOME: join(run, "home"), TMPDIR: join(run, "tmp"),
    XDG_CONFIG_HOME: join(run, "home/.config"), XDG_CACHE_HOME: join(run, "cache"),
    PI_CODING_AGENT_DIR: join(run, "agent"), PI_CODING_AGENT_SESSION_DIR: join(run, "sessions"),
    JITI_FS_CACHE: join(run, "cache"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
    PI_SPACING_LAB_VARIANT: variant, PI_SPACING_LAB_REPOSITORY: repository, PI_SPACING_LAB_REPLY_STYLE: replyStyle,
    PI_SPACING_LAB_PRODUCTION_REPLIES: productionReplies ? "1" : "0",
  };
}

function sessionFixture(rows, reply) {
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
  append({ role: "user", content: "Compare edit header separation without adding blank rows." });
  append({ role: "assistant", content: rows.map(row => ({ type: "toolCall", id: row.id, name: row.name, arguments: row.args })),
    provider: "spacing-ui-fixture", model: "fixture", api: "openai-responses", usage, stopReason: "toolUse" });
  for (const row of rows) append({ role: "toolResult", toolCallId: row.id, toolName: row.name, ...row.result });
  append(reply);
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
