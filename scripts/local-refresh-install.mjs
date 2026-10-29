#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(repo, ".tmp"), { recursive: true });
const root = mkdtempSync(join(repo, ".tmp/local-refresh-install-"));
const store = execFileSync("pnpm", ["store", "path"], { cwd: repo, encoding: "utf8", env: { ...process.env, pnpm_config_verify_deps_before_run: "false" } }).trim();
const env = Object.fromEntries(["PATH", "LANG", "LC_ALL"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), XDG_CACHE_HOME: join(root, "cache"), CI: "1", pnpm_config_verify_deps_before_run: "false" });
for (const path of [env.HOME, env.TMPDIR, env.XDG_CACHE_HOME]) mkdirSync(path);
const evidence = { root, node: process.version, projects: {} };
const tarball = process.argv.includes("--pack") ? join(root, "pi-ext.tgz") : undefined;
if (tarball) {
  writeFileSync(join(root, "pack.log"), execFileSync("pnpm", ["pack", "--out", tarball], { cwd: repo, env, encoding: "utf8", timeout: 300_000 }));
  evidence.tarball = { path: tarball, sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex") };
}
for (const kind of ["patched", "original"]) {
  const cwd = join(root, kind); mkdirSync(cwd);
  if (kind === "patched") {
    for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) copyFileSync(join(repo, name), join(cwd, name));
    cpSync(join(repo, "patches"), join(cwd, "patches"), { recursive: true });
  } else {
    copyFileSync(join(repo, "package.json"), join(cwd, "package.json"));
    const lock = readFileSync(join(repo, "pnpm-lock.yaml"), "utf8").replace(/patchedDependencies:\n(?:  .*\n)+\n/, "").replace(/\(patch_hash=[a-f0-9]+\)/g, "");
    writeFileSync(join(cwd, "pnpm-lock.yaml"), lock);
    writeFileSync(join(cwd, "pnpm-workspace.yaml"), "packages:\n  - '.'\n");
  }
  if (tarball) {
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    manifest.name = `local-refresh-${kind}-consumer`;
    writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  }
  const run = args => execFileSync("pnpm", [...args, "--store-dir", store, "--config.strict-dep-builds=false"], { cwd, env, encoding: "utf8", timeout: 300_000 });
  const lock = readFileSync(join(cwd, "pnpm-lock.yaml"));
  writeFileSync(join(root, `${kind}-install.log`), run(["install", "--frozen-lockfile", "--ignore-scripts", "--offline"]));
  assert.deepEqual(readFileSync(join(cwd, "pnpm-lock.yaml")), lock);
  if (tarball) {
    writeFileSync(join(root, `${kind}-package-install.log`), run(["add", tarball, "--ignore-scripts", "--offline"]));
    const publishedLock = readFileSync(join(cwd, "pnpm-lock.yaml"));
    writeFileSync(join(root, `${kind}-package-frozen.log`), run(["install", "--frozen-lockfile", "--ignore-scripts", "--offline"]));
    assert.deepEqual(readFileSync(join(cwd, "pnpm-lock.yaml")), publishedLock);
    for (const file of ["index.js", "working.js", "working-session.js", "token-rate.js", "json-units.js", "context-usage.js", "footer.js"]) {
      assert.deepEqual(readFileSync(join(cwd, "node_modules/pi-ext/extensions/codex-ui/dist", file)), readFileSync(join(repo, "extensions/codex-ui/dist", file)));
    }
  }
  const probe = execFileSync(process.execPath, ["--input-type=module", "-e", `import {TuiMainScreen} from '@earendil-works/pi-tui'; console.log(JSON.stringify({regionApi:typeof TuiMainScreen.prototype.registerTextRegion==='function'}));`], { cwd, env, encoding: "utf8" }).trim();
  assert.equal(JSON.parse(probe).regionApi, kind === "patched");
  evidence.projects[kind] = { cwd, ...(tarball ? { installedExtension: join(cwd, "node_modules/pi-ext/extensions/codex-ui/dist/index.js"), publishedFilesMatch: true, publishedFrozenLockUnchanged: true } : {}), cli: join(cwd, "node_modules/.bin/pi"), tui: join(cwd, "node_modules/@earendil-works/pi-tui"), agent: join(cwd, "node_modules/@earendil-works/pi-coding-agent"), lockUnchanged: true, lockSha256: createHash("sha256").update(lock).digest("hex"), probe: JSON.parse(probe) };
}
writeFileSync(join(root, "installation.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
