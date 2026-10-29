#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: "utf8", timeout: 30_000,
  env: { PATH: process.env.PATH, LANG: "C.UTF-8", PYTHONDONTWRITEBYTECODE: "1", pnpm_config_verify_deps_before_run: "false", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", PI_OFFLINE: "1" } }).trim();

async function inspectHost(project, original) {
  const cli = join(project, "node_modules/.bin/pi");
  accessSync(cli, constants.X_OK);
  const packages = join(project, "node_modules/@earendil-works");
  const agent = realpathSync(join(packages, "pi-coding-agent"));
  const tui = realpathSync(join(packages, "pi-tui"));
  const versions = Object.fromEntries(["pi-coding-agent", "pi-tui", "pi-ai"].map(name => [name, json(join(packages, name, "package.json")).version]));
  assert.ok(Object.values(versions).every(version => version === "1.4.0"), "Expected fixed Pi 1.4.0 packages");
  const cliVersion = run(cli, ["--version"], project);
  assert.equal(cliVersion, versions["pi-coding-agent"], "CLI version differs from installed package");
  const host = await import(pathToFileURL(join(tui, "dist/index.js")).href);
  const regionApi = Object.fromEntries([["regular", host.TuiMainScreen], ["fullscreen", host.TuiAltScreen]].map(([name, renderer]) => [name, typeof renderer.prototype.registerTextRegion === "function"]));
  assert.deepEqual(regionApi, { regular: !original, fullscreen: !original }, "Region API does not match requested host");
  return { cli, cliSha256: hash(cli), cliVersion, agent, tui, versions, regionApi };
}

export function checkNodeVersion(version) {
  const [major, minor] = version.split(".").map(Number);
  assert.ok(major > 22 || (major === 22 && minor >= 19), "Node must satisfy engines.node >=22.19.0");
}

export async function doctor(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { project: { type: "string", default: repo }, original: { type: "boolean", default: false }, extension: { type: "string", default: join(repo, "extensions/codex-ui/dist/index.js") } } });
  const project = realpathSync(resolve(values.project));
  const extension = realpathSync(resolve(values.extension));
  const manifest = json(join(repo, "package.json"));
  const pnpm = run("pnpm", ["--version"], repo);
  assert.equal(`pnpm@${pnpm}`, manifest.packageManager, "pnpm version differs from packageManager");
  checkNodeVersion(process.versions.node);
  const python = JSON.parse(run("conda", ["run", "-n", "codex-py312", "python", "-c", 'import sys,json,importlib.metadata; print(json.dumps({"version":sys.version.split()[0],"executable":sys.executable,"pyte":importlib.metadata.version("pyte")}))'], repo));
  assert.match(python.version, /^3\.12\./, "Expected Python 3.12");
  assert.equal(python.pyte, "0.8.2", "Expected pyte 0.8.2");
  const sources = Object.fromEntries(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "patches/@earendil-works__pi-tui@1.4.0.patch", "patches/@earendil-works__pi-coding-agent@1.4.0.patch"].map(path => [path, hash(join(repo, path))]));
  for (const path of ["extensions/permissions/dist/index.js", "examples/text-region.ts", "test-support/fixtures/local-refresh/provider.ts", "test-support/fixtures/local-refresh/working-provider.ts", "test-support/fixtures/local-refresh/working_journey.py", "scripts/local-refresh-pty.py"]) accessSync(join(repo, path), constants.R_OK);
  return { ok: true, repo, project, revision: run("git", ["rev-parse", "HEAD"], repo), node: process.version, pnpm, python, extension, extensionSha256: hash(extension), sources, ...await inspectHost(project, values.original), auth: "Offline faux provider; no remote credentials needed", instance: "Short-lived PTY; ready and PID recorded by the drive", servicesStarted: [] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await doctor(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
