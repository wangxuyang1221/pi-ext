import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestEnvironment } from "../test-support/environment.mjs";
import { assertPi152Identity, inspectPi152Runtime, resolvePi152Runtime } from "./pi152-runtime.mjs";

export function verifyPi152({ patched = false } = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const runtime = resolvePi152Runtime(repo, process.env.PI152_RUNTIME ?? (patched ? ".tmp/pi152-patches/runtime" : ".tmp/pi152-adaptation/runtime"));
  const fixture = join(repo, patched ? "test-support/pi152-patched" : "test-support/pi152");
  const extensions = ["codex-ui", "codex-compact", "openai-fast-mode", "mcp", "skill-mentions"];
  const [operation = "prepare", ...args] = process.argv.slice(2);
  const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");

  const inspect = (verifyProof = true) => inspectPi152Runtime(repo, runtime, patched, verifyProof);
  if (operation === "prepare") assertPi152Identity(runtime, patched, true);
  const isolated = createTestEnvironment("pi152-command", repo);
  const env = { ...isolated.env, NODE_DISABLE_COMPILE_CACHE: "1" };
  try {
    if (operation === "prepare") {
      const freshInstall = !existsSync(join(runtime, "node_modules"));
      if (patched) assert.notEqual(runtime, join(repo, ".tmp/pi152-adaptation/runtime"), "Stock adaptation tree is reserved");
      mkdirSync(runtime, { recursive: true });
      for (const entry of readdirSync(runtime)) {
        if (entry !== "node_modules" && entry !== ".tmp") rmSync(join(runtime, entry), { recursive: true, force: true });
      }
      const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repo }).toString().split("\0").filter(Boolean);
      for (const file of files) {
        if (file.includes("/") && !["extensions", "scripts", "test-support", ".cursor", "docs", "examples", "themes"].includes(file.split("/")[0])) continue;
        if (["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(file) || file.startsWith("patches/")) continue;
        if (file.startsWith("extensions/") && !extensions.includes(file.split("/")[1]) && file.split("/")[2] !== "__tests__") continue;
        const target = join(runtime, file);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(repo, file), target);
      }
      const pkg = JSON.parse(readFileSync(join(fixture, "package.json")));
      pkg.files = JSON.parse(readFileSync(join(repo, "package.json"))).files.filter(file => !file.startsWith("extensions/") || extensions.includes(file.split("/")[1]));
      pkg.pi = { extensions: extensions.map(name => `./extensions/${name}/dist/index.js`), themes: ["./themes/codex-pi.json"] };
      pkg.scripts = {
        "build:codex-ui": "tsc -p extensions/codex-ui/tsconfig.json",
        build: extensions.map(name => `tsc -p ./extensions/${name}/tsconfig.json${name === "codex-compact" ? " && node ./scripts/codex-compact-media.mjs copy" : ""}`).join(" && "),
        test: "pnpm run build:codex-ui && node scripts/test.mjs",
      };
      writeFileSync(join(runtime, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
      cpSync(join(fixture, "pnpm-lock.yaml"), join(runtime, "pnpm-lock.yaml"));
      if (patched) {
        cpSync(join(fixture, "pnpm-workspace.yaml"), join(runtime, "pnpm-workspace.yaml"));
        mkdirSync(join(runtime, "patches"), { recursive: true });
        for (const name of ["pi-coding-agent", "pi-tui"]) cpSync(join(repo, `patches/@earendil-works__${name}@1.5.2.patch`), join(runtime, `patches/@earendil-works__${name}@1.5.2.patch`));
      }
      const result = spawnSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", ...(patched ? [] : ["--ignore-workspace"]), "--registry=https://registry.npmjs.org", "--store-dir", join(repo, ".tmp/pi152-package-store"), ...(!freshInstall ? ["--force"] : [])], { cwd: runtime, stdio: "inherit", env });
      assert.equal(result.status, 0, "Frozen fixture installation failed");
      assert.equal(hash(join(runtime, "pnpm-lock.yaml")), hash(join(fixture, "pnpm-lock.yaml")), "Frozen install changed fixture lock");
      const sourceHashes = Object.fromEntries(files.filter(file => (file.startsWith("extensions/") && extensions.includes(file.split("/")[1]) && file.includes("/src/")) || file === "themes/codex-pi.json").map(file => {
        assert.equal(hash(join(repo, file)), hash(join(runtime, file)), "Source copy mismatch");
        return [file, hash(join(runtime, file))];
      }));
      const patches = patched ? Object.fromEntries(["pi-coding-agent", "pi-tui"].map(name => {
        const path = `patches/@earendil-works__${name}@1.5.2.patch`;
        assert.equal(hash(join(runtime, path)), hash(join(repo, path)), "Patch copy mismatch");
        const files = [...readFileSync(join(runtime, path), "utf8").matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1]);
        return [path, { sha256: hash(join(runtime, path)), installedFiles: Object.fromEntries(files.map(file => [file, hash(join(runtime, "node_modules/@earendil-works", name, file))])) }];
      })) : {};
      const proof = { independentCheckout: false, sharedDependencies: false, freshInstall, frozenLockUnchanged: true, patches, runtime, lockSha256: hash(join(runtime, "pnpm-lock.yaml")), packages: inspect(false), sourceHashes };
      writeFileSync(join(runtime, "host-proof.json"), JSON.stringify(proof, null, 2) + "\n");
      console.log(JSON.stringify(proof, null, 2));
    } else if (operation === "inspect") console.log(JSON.stringify(inspect(), null, 2));
    else if (operation === "types" || operation === "build") {
      inspect();
      let failed = false;
      for (const name of extensions) {
        const result = spawnSync("pnpm", ["exec", "tsc", "-p", `extensions/${name}/tsconfig.json`, ...(operation === "types" ? ["--noEmit"] : [])], { cwd: runtime, stdio: "inherit", env });
        console.log(`${name}: exit ${result.status}`);
        failed ||= result.status !== 0;
        if (operation === "build" && name === "codex-compact" && result.status === 0) {
          const media = spawnSync(process.execPath, ["scripts/codex-compact-media.mjs", "copy"], { cwd: runtime, stdio: "inherit", env });
          failed ||= media.status !== 0;
        }
      }
      process.exitCode = failed ? 1 : 0;
    } else if (operation === "run") {
      inspect();
      assert.ok(args.length, "run requires a command");
      const result = spawnSync(args[0], args.slice(1), { cwd: runtime, stdio: "inherit", env });
      process.exitCode = result.status ?? 1;
    } else if (operation === "doctor") {
      inspect();
      const result = spawnSync(process.execPath, [join(repo, ".cursor/skills/verify-pi-text-regions/scripts/doctor.mjs"), "--profile", "pi152", "--project", runtime, "--extension", join(runtime, "extensions/codex-ui/dist/index.js"), ...(!patched ? ["--original"] : [])], { cwd: runtime, stdio: "inherit", env });
      process.exitCode = result.status ?? 1;
    } else throw new Error(`Unknown operation: ${operation}`);
  } finally { rmSync(isolated.directory, { recursive: true, force: true }); }
}
