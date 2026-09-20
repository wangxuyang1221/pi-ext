import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafePublishedPath } from "../../../scripts/package-paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
mkdirSync(join(repo, ".tmp"), { recursive: true });
const root = mkdtempSync(join(repo, ".tmp/skill-install-"));
const evidence = join(repo, "adventure/evidence");
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
  assert(files.includes("docs/skill-mentions.md"));
  const consumer = join(root, "consumer");
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "pi-ext": `file:${tarball}`, ...manifest.peerDependencies, typebox: manifest.devDependencies.typebox } }, null, 2));
  // A nested workspace prevents pnpm from treating this fixture as the repository root.
  writeFileSync(join(consumer, "pnpm-workspace.yaml"), `packages:\n  - '.'\n${readFileSync(join(repo, "pnpm-workspace.yaml"), "utf8")}`);
  run("pnpm", ["install", "--ignore-scripts", "--prefer-offline", "--no-frozen-lockfile"], { cwd: consumer, env });
  const installed = realpathSync(join(consumer, "node_modules/pi-ext"));
  const packaged = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.deepEqual(packaged.pi, manifest.pi);
  for (const path of files.filter(path => path.startsWith("extensions/skill-mentions/dist/"))) {
    assert.deepEqual(readFileSync(join(installed, path)), readFileSync(join(repo, path)));
  }
  // Imports run against the installed package, not source or a development symlink.
  run(process.execPath, ["--input-type=module", "-e", `for (const path of ${JSON.stringify(packaged.pi.extensions)}) { const m = await import(new URL(path, ${JSON.stringify(`file://${installed}/`)})); if (typeof m.default !== 'function') throw new Error(path); }`], { cwd: consumer, env });
  copyFileSync(join(here, "pty-fixture.ts"), join(consumer, "pty-fixture.ts"));
  const cli = join(realpathSync(join(consumer, "node_modules/@earendil-works/pi-coding-agent")), "dist/cli.js");
  const modes = process.argv.slice(2).length ? process.argv.slice(2) : ["native", "native-fullscreen", "codex", "combined", "combined-fullscreen"];
  for (const mode of modes) {
    run("conda", ["run", "--no-capture-output", "-n", "codex-py312", "python", join(here, "pty-driver.py"), root, cli, installed, mode], { timeout: 180_000 });
  }
  writeFileSync(join(evidence, "skill-install-artifact.json"), JSON.stringify({
    passed: true, node: process.version, pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
    sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"), files,
    extensionEntries: packaged.pi.extensions, modes,
    checks: ["prepack build", "tarball contents", "no test/log payload", "pnpm installation", "compiled file byte equality", "all installed entry imports", "isolated pi install", "real CLI PTY"],
  }, null, 2) + "\n");
} finally {
  rmSync(root, { recursive: true, force: true });
  assert(!existsSync(root), "Temporary installation must be removed");
}
