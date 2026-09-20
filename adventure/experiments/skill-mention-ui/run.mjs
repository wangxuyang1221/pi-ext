import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const cli = join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "cli.js");
const variant = ["accent", "tint", "gray", "blue", "cube"].find(value => process.argv.includes(value)) ?? "command";
const native = process.argv.includes("--native");
const capture = process.argv.includes("--capture");
mkdirSync(join(repo, ".tmp"), { recursive: true });
const root = mkdtempSync(join(repo, ".tmp/skill-ui-prototype-"));
for (const dir of ["home", "agent", "workspace", "tmp", "sessions"]) mkdirSync(join(root, dir));
const env = Object.fromEntries(["PATH", "LANG", "LC_ALL", "TERM"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, { HOME: join(root, "home"), PI_CODING_AGENT_DIR: join(root, "agent"), TMPDIR: join(root, "tmp"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", PI_HARDWARE_CURSOR: "1", COLORTERM: "truecolor", TERM: "xterm-256color", MENTION_UI_ROOT: root, MENTION_UI_VARIANT: variant });
writeFileSync(join(root, "agent/settings.json"), JSON.stringify({ quietStartup: true, compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", doubleEscapeAction: "none" }));
for (const [name, description] of [["presentations", "Read, create or edit PowerPoint or Google Slides decks."], ["lark-doc", "飞书云文档：创建和编辑飞书文档。"]]) {
  const dir = join(root, "agent/skills", name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nPrototype fixture. No external actions.\n`);
}
const args = [cli, "--no-extensions", "--no-context-files", "--no-prompt-templates", "--approve", "--offline", "--no-builtin-tools", "--session-dir", join(root, "sessions"), "--provider", "faux", "--model", "faux-1", "--theme", join(repo, "themes/codex-pi.json"), "--use-theme", "codex-pi"];
if (!native) args.push("-e", join(repo, "extensions/codex-ui/dist/index.js"));
args.push("-e", join(here, "index.ts"));
let child;
try {
  if (capture) {
    const config = join(root, "capture.json");
    writeFileSync(config, JSON.stringify({ command: [process.execPath, ...args], env, cwd: join(root, "workspace"), root, variant, native, output: join(repo, "adventure/evidence") }));
    child = spawn("conda", ["run", "--no-capture-output", "-n", "codex-py312", "python", join(here, "capture.py"), config], { cwd: repo, stdio: "inherit" });
  } else child = spawn(process.execPath, args, { cwd: join(root, "workspace"), env, stdio: "inherit" });
  const stop = signal => child.kill(signal);
  const sigint = () => stop("SIGINT"), sigterm = () => stop("SIGTERM");
  process.on("SIGINT", sigint); process.on("SIGTERM", sigterm);
  process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
  process.off("SIGINT", sigint); process.off("SIGTERM", sigterm);
} finally {
  rmSync(root, { recursive: true, force: true });
}
