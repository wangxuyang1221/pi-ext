import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafePublishedPath } from "../../../scripts/package-paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
mkdirSync(join(repo, ".tmp"), { recursive: true });
const evidence = join(repo, ".tmp/test-results");
mkdirSync(evidence, { recursive: true });
const args = process.argv.slice(2);
const summaryOnly = args.includes("--summary");
const prefixArgument = args.find(arg => arg.startsWith("--evidence-prefix="));
const evidencePrefix = prefixArgument?.split("=")[1] ?? "skill-install";
assert(/^[a-z0-9-]+$/.test(evidencePrefix), "Evidence prefix must be a filename segment");
const root = mkdtempSync(join(repo, ".tmp/skill-install-"));
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: repo, stdio: "inherit", timeout: 300_000, ...options });
const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const env = Object.fromEntries(["PATH", "LANG", "LC_ALL"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), XDG_CACHE_HOME: join(root, "cache"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", TERM: "xterm-256color", CI: "1" });
for (const path of [env.HOME, env.TMPDIR, env.PI_CODING_AGENT_DIR, join(root, "consumer")]) mkdirSync(path, { recursive: true });
try {
  // Keep prepack enabled: this verifies the package's actual generation path.
  run("pnpm", ["pack", "--pack-destination", root]);
  const tarball = join(root, `${manifest.name}-${manifest.version}.tgz`);
  const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n").map(path => path.replace(/^package\//, ""));
  for (const path of files) assertSafePublishedPath(path);
  assert(files.includes("extensions/skill-mentions/dist/index.js"));
  const consumer = join(root, "consumer");
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "pi-ext": `file:${tarball}`, ...manifest.peerDependencies, typebox: manifest.devDependencies.typebox } }, null, 2));
  // A nested workspace prevents pnpm from treating this fixture as the repository root.
  writeFileSync(join(consumer, "pnpm-workspace.yaml"), "packages:\n  - '.'\n");
  if (summaryOnly) {
    copyFileSync(join(repo, "pnpm-workspace.yaml"), join(consumer, "pnpm-workspace.yaml"));
    cpSync(join(repo, "patches"), join(consumer, "patches"), { recursive: true });
  }
  // Resolve this generated consumer once, then prove installation consumes its exact lock.
  run("pnpm", ["install", "--lockfile-only", "--ignore-scripts", "--prefer-offline", "--no-frozen-lockfile"], { cwd: consumer, env });
  const consumerLock = readFileSync(join(consumer, "pnpm-lock.yaml"));
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--prefer-offline"], { cwd: consumer, env });
  assert.deepEqual(readFileSync(join(consumer, "pnpm-lock.yaml")), consumerLock, "Frozen installation must preserve the consumer lock");
  copyFileSync(join(consumer, "pnpm-lock.yaml"), join(evidence, `${evidencePrefix}-consumer-lock.yaml`));
  const installed = realpathSync(join(consumer, "node_modules/pi-ext"));
  const packaged = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.deepEqual(packaged.pi, manifest.pi);
  for (const path of files.filter(path => /^extensions\/[^/]+\/dist\//.test(path))) {
    assert.deepEqual(readFileSync(join(installed, path)), readFileSync(join(repo, path)));
  }
  // Imports run against the installed package, not source or a development symlink.
  run(process.execPath, ["--input-type=module", "-e", `for (const path of ${JSON.stringify(packaged.pi.extensions)}) { const m = await import(new URL(path, ${JSON.stringify(`file://${installed}/`)})); if (typeof m.default !== 'function') throw new Error(path); }`], { cwd: consumer, env });
  copyFileSync(join(here, "pty-fixture.ts"), join(consumer, "pty-fixture.ts"));
  const hostRoot = realpathSync(join(consumer, "node_modules/@earendil-works/pi-coding-agent"));
  const cli = summaryOnly ? join(consumer, "node_modules/.bin/pi") : join(hostRoot, "dist/cli.js");
  const requestedModes = args.filter(arg => arg !== prefixArgument && arg !== "--summary");
  const modes = requestedModes.length ? requestedModes : ["native", "native-fullscreen", "codex", "combined", "combined-fullscreen"];
  assert(modes.every(mode => ["native", "native-fullscreen", "codex", "codex-fullscreen", "combined", "combined-fullscreen", "combined-search", "combined-search-fullscreen"].includes(mode)));
  for (const mode of modes) {
    if (summaryOnly) {
      const summaryRoot = join(root, `summary-${mode}`);
      try {
        run("conda", ["run", "--no-capture-output", "-n", "codex-py312", "python", join(here, "resume-summary-driver.py"), summaryRoot, mode, cli, installed], { timeout: 180_000 });
      } finally {
        if (existsSync(summaryRoot)) cpSync(summaryRoot, join(evidence, `${evidencePrefix}-summary-${mode}`), { recursive: true });
      }
    } else run("conda", ["run", "--no-capture-output", "-n", "codex-py312", "python", join(here, "pty-driver.py"), root, cli, installed, mode, evidencePrefix], { timeout: 180_000 });
  }
  writeFileSync(join(evidence, `${evidencePrefix}-artifact.json`), JSON.stringify({
    passed: true,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    piVersion: JSON.parse(readFileSync(join(hostRoot, "package.json"), "utf8")).version,
    fixtureSha256: Object.fromEntries(["acceptance.mjs", "pty-driver.py", "pty-fixture.ts", "pty-mcp-fixture.mjs", ...(summaryOnly ? ["resume-summary-driver.py"] : [])].map(path => [path, createHash("sha256").update(readFileSync(join(here, path))).digest("hex")])),
    node: process.version, pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
    sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"), files,
    extensionEntries: packaged.pi.extensions, modes, patchedHost: summaryOnly,
    consumerLockSha256: createHash("sha256").update(consumerLock).digest("hex"), consumerLockUnchanged: true,
    checks: ["prepack build", "tarball contents", "no test/log payload", "consumer lock generation", "frozen pnpm installation with unchanged lock", "all extension compiled files byte equality", "all installed entry imports", summaryOnly ? "patched host resume selectors" : "isolated pi install", "real CLI PTY"],
  }, null, 2) + "\n");
} finally {
  rmSync(root, { recursive: true, force: true });
  assert(!existsSync(root), "Temporary installation must be removed");
}
