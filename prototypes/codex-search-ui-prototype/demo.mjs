// PROTOTYPE: Run real Pi in a repository-local, credential-free workspace.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../..");
const args = process.argv.slice(2).filter(arg => arg !== "--");
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return args.find(arg => arg.startsWith(`--${name}=`))?.split("=")[1] ?? (index < 0 ? fallback : args[index + 1]);
};
const production = args.includes("--production");
const check = value("check", "green");
const style = value("style", "minimal");
if (!["minimal", "accent"].includes(style)) throw new Error("Invalid color style");
const scene = value("scene", "success");
if (value("variant", "2") !== "2") throw new Error("This prototype now focuses on variant 2 only.");
if (!["green", "gray"].includes(check)) throw new Error("Invalid check color");
if (!["success", "error"].includes(scene)) throw new Error("Invalid scene");
if (args.includes("--help")) {
  console.log("pnpm run prototype:search-ui [--style minimal|accent] [--check green|gray] [--settled] [--scene success|error] [--smoke] [--pty-smoke] [--production]");
  process.exit(0);
}
const temp = join(directory, ".tmp");
mkdirSync(temp, { recursive: true });
const run = mkdtempSync(join(temp, "run-"));
for (const name of ["home", "agent", "workspace", "cache", "tmp", "sessions", "build"]) mkdirSync(join(run, name));
let active;
const cleanup = () => rmSync(run, { recursive: true, force: true });
process.on("exit", cleanup);
const handlers = new Map();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const handler = () => active ? active.kill(signal) : process.exit(128);
  handlers.set(signal, handler);
  process.on(signal, handler);
}
const env = {};
for (const key of ["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"]) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  TERM: env.TERM || "xterm-256color", COLORTERM: "truecolor",
  HOME: join(run, "home"), TMPDIR: join(run, "tmp"), XDG_CONFIG_HOME: join(run, "home/.config"),
  XDG_CACHE_HOME: join(run, "cache"), PI_CODING_AGENT_DIR: join(run, "agent"),
  PI_CODING_AGENT_SESSION_DIR: join(run, "sessions"), JITI_FS_CACHE: join(run, "cache"),
  PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
  PI_SEARCH_LAB_REPOSITORY: repository, PI_SEARCH_LAB_CHECK: check, PI_SEARCH_LAB_SCENE: scene,
  PI_SEARCH_LAB_STYLE: style,
  PI_SEARCH_LAB_SETTLED: args.includes("--settled") ? "1" : "0",
});
try {
  const build = join(run, "build");
  await child("pnpm", ["exec", "tsc", "-p", join(directory, "tsconfig.json"), "--outDir", build], repository);
  const compiled = join(build, "prototypes/codex-search-ui-prototype");
  if (args.includes("--smoke")) {
    await child(process.execPath, ["--test", join(compiled, "__tests__/prototype.test.js")], join(run, "workspace"));
  } else {
    const { fixture, args: searchArgs, TOOL_NAME } = await import(pathToFileURL(join(compiled, "src/lab.js")));
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
    if (!production) {
    append({ role: "user", content: "Compare the minimal Web Search animation and completion check." });
    append({ role: "assistant", content: [
      { type: "text", text: "Minimal search preview. This is a six-second offline fixture." },
      { type: "toolCall", id: "search-preview", name: TOOL_NAME, arguments: searchArgs },
    ], provider: "search-ui-fixture", model: "fixture", api: "openai-responses", usage, stopReason: "toolUse" });
    append({ role: "toolResult", toolCallId: "search-preview", toolName: TOOL_NAME, ...fixture(scene === "error") });
    }
    if (production) {
      mkdirSync(join(run, "home/.pi"), { recursive: true });
      writeFileSync(join(run, "home/.pi/pi-codex-search.json"), JSON.stringify({ enabled: true, model: "fixture", baseUrl: "https://search-fixture.invalid" }));
    }
    const session = join(run, "sessions/fixture.jsonl");
    writeFileSync(session, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
    writeFileSync(join(run, "agent/settings.json"), JSON.stringify({
      quietStartup: true, defaultProvider: "search-ui-fixture", defaultModel: "fixture", theme: "codex-pi",
    }));
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const cliArgs = [join(packageRoot, pkg.bin.pi), "--offline", "--approve", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-context-files", "--no-themes", "--theme", join(repository, "themes/codex-pi.json"),
      "--use-theme", "codex-pi", "--session", session, "--extension", join(compiled, production ? "src/production.js" : "src/composed.js")];
    if (production) cliArgs.push("success");
    console.log(production
      ? `Pi ${pkg.version} · production accent · real execution · offline HTTP fixture`
      : `Pi ${pkg.version} · ${style} · ${check} check · ${scene} · offline fixture`);
    if (args.includes("--pty-smoke")) {
      const { smokePty } = await import(production ? "./production-smoke.mjs" : "./pty-smoke.mjs");
      await smokePty({ run, repository, env, cliArgs });
    } else {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Use a terminal or --smoke.");
      await child(process.execPath, cliArgs, join(run, "workspace"));
    }
  }
} finally {
  cleanup();
  process.off("exit", cleanup);
  for (const [signal, handler] of handlers) process.off(signal, handler);
}
async function child(command, argv, cwd) {
  const code = await new Promise((resolvePromise, reject) => {
    active = spawn(command, argv, { cwd, env, stdio: "inherit" });
    active.once("error", reject);
    active.once("exit", code => resolvePromise(code));
  });
  active = undefined;
  if (code !== 0) throw new Error(`${command} exited with code ${code}`);
}
