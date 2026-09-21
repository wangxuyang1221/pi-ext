import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// An operator owns the terminal and IME. This launcher never changes either.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Run this launcher in a dedicated interactive terminal.");
  process.exit(2);
}
const [host = "native", tuiMode = "regular"] = process.argv.slice(2);
assert(["native", "codex"].includes(host), "Host must be native or codex");
assert(["regular", "fullscreen"].includes(tuiMode), "Mode must be regular or fullscreen");
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
mkdirSync(join(repo, ".tmp"), { recursive: true });
const root = mkdtempSync(join(repo, ".tmp/skill-manual-"));
try {
  for (const name of ["home", "agent", "workspace", "tmp", "sessions"]) mkdirSync(join(root, name));
  writeFileSync(join(root, "alpha.md"), "---\nname: alpha\ndescription: Alpha manual fixture\n---\nALPHA_MANUAL_BODY\n");
  writeFileSync(join(root, "agent/settings.json"), JSON.stringify({ quietStartup: true, compaction: { enabled: false }, cacheWarming: "off", retry: { enabled: false } }));
  writeFileSync(join(root, "agent/keybindings.json"), JSON.stringify({ "tui.editor.undo": "f8" }));
  const env = Object.fromEntries(["PATH", "LANG", "LC_ALL", "TERM", "TERM_PROGRAM", "COLORTERM"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), XDG_CACHE_HOME: join(root, "cache"), PI_CODING_AGENT_DIR: join(root, "agent"), SKILL_PTY_ROOT: root, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1", PI_HARDWARE_CURSOR: "1" });
  const extensions = host === "codex" ? ["codex-ui", "skill-mentions"] : ["skill-mentions"];
  const args = [join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    "--offline", "--no-extensions", "--no-context-files", "--no-prompt-templates", "--no-skills", "--no-builtin-tools", "--no-approve",
    "--skill", join(root, "alpha.md"), "-e", join(here, "pty-fixture.ts"),
    ...extensions.flatMap(name => ["-e", join(repo, `extensions/${name}/dist/index.js`)]),
    "--provider", "faux", "--model", "faux-1", "--session-dir", join(root, "sessions"), "--tui-mode", tuiMode];
  for (let start = 0; start < 2; start++) {
    console.log(`Manual terminal run ${start + 1}/2. Use /quit to continue. Config: ${root}`);
    const child = spawnSync(process.execPath, [...args, ...(start ? ["--continue"] : [])], { cwd: join(root, "workspace"), env, stdio: "inherit" });
    assert.equal(child.status, 0, `Manual CLI failed: ${child.error ?? child.signal ?? child.status}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
  console.log(`Removed isolated manual workspace: ${root}`);
}
