import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, "../../..");
const prefix = process.argv[2] ?? "skill-label-spacing";
assert(/^[a-z0-9-]+$/.test(prefix));
mkdirSync(join(repo, ".tmp"), { recursive: true });
const root = mkdtempSync(join(repo, ".tmp/skill-spacing-pty-"));
const modes = ["native-fullscreen", "codex-fullscreen"];
const env = { ...process.env, TMPDIR: join(root, "tmp") };
for (const key of ["PI_SUBAGENT_PARENT", "PI_SUBAGENT_LAUNCH", "PI_SUBAGENT", "PI_SUBAGENT_ID"]) delete env[key];
try {
  mkdirSync(join(root, "consumer")); mkdirSync(env.TMPDIR);
  copyFileSync(join(here, "pty-fixture.ts"), join(root, "consumer/pty-fixture.ts"));
  const cli = join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const compiled = ["skill-mentions", "codex-ui"].map(name => `extensions/${name}/dist/index.js`);
  for (const path of compiled) assert(existsSync(join(repo, path)), "Build before running spacing acceptance");
  for (const mode of modes) {
    execFileSync("conda", ["run", "--no-capture-output", "-n", "codex-py312", "python", join(here, "pty-driver.py"), root, cli, repo, mode, prefix, "spacing"], { cwd: repo, env, stdio: "inherit", timeout: 180_000 });
  }
  const files = [...compiled, "extensions/skill-mentions/dist/labels.js", "extensions/skill-mentions/dist/editor-surface.js", "extensions/skill-mentions/dist/label-editor.js", "extensions/skill-mentions/__tests__/pty-driver.py"];
  writeFileSync(join(repo, `adventure/evidence/${prefix}-artifact.json`), JSON.stringify({
    passed: true, scope: "spacing", modes, node: process.version,
    sourceBase: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    piVersion: JSON.parse(readFileSync(join(repo, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")).version,
    files: Object.fromEntries(files.map(path => [path, createHash("sha256").update(readFileSync(join(repo, path))).digest("hex")])),
    installationChanged: false,
    checks: ["explicit worktree compiled entries", "isolated offline faux real CLI PTY", "both hosts and both icons", "no package installation or global configuration"],
  }, null, 2) + "\n");
} finally {
  rmSync(root, { recursive: true, force: true });
  assert(!existsSync(root), "Temporary PTY workspace must be removed");
  console.log(`Removed isolated spacing workspace: ${root}`);
}
