// PROTOTYPE: Launch an actual Pi CLI with isolated credentials, workspace and scripted provider.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, realpathSync, symlinkSync, cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import ts from "typescript";

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
  console.log("pnpm run prototype:reasoning-ui [--variant production|proposed|current] [--scene standard|long] [--runtime installed|repository] [--smoke] [--pty-smoke] [--upgrade-smoke] [--bench] [--probe]");
  process.exit(0);
}
const variant = option("variant") ?? "production";
const scene = option("scene") ?? "standard";
const runtime = option("runtime") ?? "installed";
if (!["production", "proposed", "current"].includes(variant)) throw new Error(`Invalid variant: ${variant}`);
if (!["standard", "long"].includes(scene)) throw new Error(`Invalid scene: ${scene}`);
if (!["installed", "repository"].includes(runtime)) throw new Error(`Invalid runtime: ${runtime}`);
const repoPackage = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
function installedCli() {
  try {
    const candidates = execFileSync("which", ["-a", "pi"], { encoding: "utf8" }).trim().split("\n");
    for (const candidate of candidates) {
      // pnpm prepends repository .bin directories; prefer the actual installed CLI.
      if (resolve(candidate).startsWith(`${repository}/`)) continue;
      const executable = realpathSync(candidate);
      const shim = readFileSync(executable, "utf8");
      const target = shim.match(/^# cmd-shim-target=(.+)$/m)?.[1];
      if (target && existsSync(target)) return target;
      if (executable.endsWith(".js")) return executable;
    }
  } catch { /* Fall back to the pinned repository runtime. */ }
  return undefined;
}
const pkg = JSON.parse(readFileSync(join(repoPackage, "package.json"), "utf8"));
const cli = (runtime === "installed" ? installedCli() : undefined) ?? join(repoPackage, pkg.bin.pi);
const version = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim();
let runtimeRoot = dirname(cli);
while (!existsSync(join(runtimeRoot, "package.json"))) {
  const parent = dirname(runtimeRoot);
  if (parent === runtimeRoot) throw new Error("Cannot locate the selected Pi package root.");
  runtimeRoot = parent;
}
runtimeRoot = realpathSync(runtimeRoot);
const runtimeRequire = createRequire(join(runtimeRoot, "package.json"));
const root = join(directory, ".tmp");
mkdirSync(root, { recursive: true });
const run = mkdtempSync(join(root, "run-"));
let activeChild;
let killTimer;
const cleanup = () => rmSync(run, { recursive: true, force: true });
const onSignal = signal => {
  if (!activeChild?.pid) { process.exitCode = 128; return; }
  activeChild.kill(signal);
  killTimer ??= setTimeout(() => activeChild?.kill("SIGKILL"), 3000);
};
const handlers = new Map(["SIGINT", "SIGTERM", "SIGHUP"].map(signal => [signal, () => onSignal(signal)]));
process.on("exit", cleanup);
for (const [signal, handler] of handlers) process.on(signal, handler);
try {
  for (const name of ["workspace", "home", "agent", "cache", "tmp", "sessions", "build"]) mkdirSync(join(run, name));
  const env = {};
  for (const key of ["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    TERM: env.TERM || "xterm-256color", HOME: join(run, "home"), TMPDIR: join(run, "tmp"),
    XDG_CONFIG_HOME: join(run, "home/.config"), XDG_CACHE_HOME: join(run, "cache"),
    PI_CODING_AGENT_DIR: join(run, "agent"), PI_CODING_AGENT_SESSION_DIR: join(run, "sessions"),
    JITI_FS_CACHE: join(run, "cache"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
    PI_REASONING_LAB_VARIANT: variant,
    PI_REASONING_BENCH_ROOT: repository, PI_REASONING_BENCH_RUN: run,
  });
  console.log(`Building reasoning prototype · Pi ${version} · ${variant} · ${scene} · offline fixture`);
  await child("pnpm", ["exec", "tsc", "-p", join(directory, "tsconfig.json"), "--noEmit", "false", "--outDir", join(run, "build")],
    { cwd: repository, env: { ...process.env, TMPDIR: env.TMPDIR } });
  // Match extension runtime imports to the selected CLI, not repository peer dependencies.
  const moduleScope = join(run, "build/node_modules/@earendil-works");
  mkdirSync(moduleScope, { recursive: true });
  for (const name of ["pi-coding-agent", "pi-ai", "pi-tui"]) {
    const packageRoot = name === "pi-coding-agent" ? runtimeRoot
      : runtimeRequire.resolve.paths(`@earendil-works/${name}`)
        ?.map(path => join(path, "@earendil-works", name))
        .find(path => existsSync(join(path, "package.json")));
    if (!packageRoot) throw new Error(`Cannot resolve ${name} beside the selected Pi runtime.`);
    symlinkSync(realpathSync(packageRoot), join(moduleScope, name), "dir");
  }
  // Freeze both historical variants; production loads the unmodified compiled entry.
  const baselinePath = join(repository, "prototypes/codex-ui-performance/baselines/reasoning-before.json.gz");
  const baseline = JSON.parse(gunzipSync(readFileSync(baselinePath)));
  if (variant !== "production") {
    const destination = join(run, "build/extensions/codex-ui/src");
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    for (const [name, source] of Object.entries(baseline.sources)) {
      const output = ts.transpileModule(source, { fileName: name, compilerOptions: {
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
      } }).outputText;
      writeFileSync(join(destination, name.replace(/\.ts$/u, ".js")), output);
    }
  }
  const manifest = { variant, node: process.version, version, runtimeRoot, baseline: {
    commit: baseline.commit, sha256: createHash("sha256").update(readFileSync(baselinePath)).digest("hex"),
  }, modules: Object.fromEntries(["pi-coding-agent", "pi-ai", "pi-tui"].map(name => {
    const path = realpathSync(join(moduleScope, name));
    return [name, { path, version: JSON.parse(readFileSync(join(path, "package.json"))).version }];
  })) };
  const sourceRoot = join(run, "build/extensions/codex-ui/src");
  manifest.fixtureSha256 = Object.fromEntries(["src/bench.ts", "src/fixture.ts", "../../extensions/codex-ui/__tests__/fixtures/reasoning-pipeline.ts"].map(name =>
    [name, createHash("sha256").update(readFileSync(join(directory, name))).digest("hex")]));
  manifest.compiledSha256 = Object.fromEntries(readdirSync(sourceRoot).filter(name => name.endsWith(".js")).map(name =>
    [name, createHash("sha256").update(readFileSync(join(sourceRoot, name))).digest("hex")]));
  writeFileSync(join(run, "manifest.json"), JSON.stringify(manifest, null, 2));
  const compiled = join(run, "build/prototypes/codex-reasoning-ui-prototype");
  if (args.includes("--probe")) {
    await child(process.execPath, [join(compiled, "src/probe.js")], { cwd: repository, env });
    const destination = join(root, `latest-probe-${version}-${variant}.json`);
    writeFileSync(destination, readFileSync(join(run, "probe.json")));
    console.log(`Saved ${destination}`);
  } else if (args.includes("--bench")) {
    if (variant === "proposed") throw new Error("Benchmark the production or immutable current variant, not the composition prototype.");
    await child(process.execPath, ["--expose-gc", join(compiled, "src/bench.js")], { cwd: repository, env });
    const results = join(directory, "results");
    mkdirSync(results, { recursive: true });
    const destination = join(results, `${new Date().toISOString().replace(/[:.]/gu, "-")}-${version}-${variant}.json`);
    writeFileSync(destination, readFileSync(join(run, "metrics.json")), { flag: "wx" });
    console.log(`Saved ${destination}`);
  } else if (args.includes("--smoke")) {
    await child(process.execPath, ["--test", join(compiled, "__tests__/prototype.test.js")], { cwd: repository, env });
  } else {
    const fixture = await import(pathToFileURL(join(compiled, "src/fixture.js")).href);
    writeFileSync(join(run, "workspace", fixture.INPUT_FILE), fixture.INPUT_DATA);
    const { prototypeSettings } = await import(pathToFileURL(join(compiled, "src/settings.js")).href);
    writeFileSync(join(run, "agent/settings.json"), JSON.stringify(prototypeSettings(variant)));
    const cliArgs = [cli,
      "--offline", "--approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes",
      "--theme", join(repository, "themes/codex-pi.json"), "--use-theme", "codex-pi",
      "--provider", fixture.PROVIDER, "--model", fixture.MODEL, "--session-dir", join(run, "sessions"),
      "--extension", join(compiled, "src/index.js"), "--tui-mode", "regular",
    ];
    if (args.includes("--pty-smoke") || args.includes("--upgrade-smoke")) {
      const upgrade = args.includes("--upgrade-smoke");
      if (upgrade) {
        if (variant !== "production") throw new Error("Upgrade smoke requires the production variant.");
        cpSync(sourceRoot, join(run, "upgrade-after"), { recursive: true });
        rmSync(sourceRoot, { recursive: true }); mkdirSync(sourceRoot);
        for (const [name, source] of Object.entries(baseline.sources)) writeFileSync(join(sourceRoot, name.replace(/\.ts$/u, ".js")),
          ts.transpileModule(source, { fileName: name, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
      }
      const { smokePty } = await import("./pty-smoke.mjs");
      await smokePty({ run, env, cliArgs, variant, prompt: fixture.PROMPTS[scene], manifest, upgrade, sourceRoot });
    } else {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive prototype requires a terminal. Use --smoke or --pty-smoke.");
      await child(process.execPath, [...cliArgs, fixture.PROMPTS[scene]], { cwd: join(run, "workspace"), env });
    }
  }
} finally {
  if (killTimer) clearTimeout(killTimer);
  cleanup();
  process.off("exit", cleanup);
  for (const [signal, handler] of handlers) process.off(signal, handler);
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
