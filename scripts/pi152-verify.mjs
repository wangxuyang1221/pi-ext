import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestEnvironment } from "../test-support/environment.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(repo, ".tmp/pi152-adaptation/runtime");
const fixture = join(repo, "test-support/pi152");
const extensions = ["codex-ui", "codex-compact", "openai-fast-mode", "mcp", "skill-mentions"];
const [operation = "prepare", ...args] = process.argv.slice(2);
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");

function inspect() {
  return Object.fromEntries(["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"].map(name => {
    const root = realpathSync(join(runtime, "node_modules/@earendil-works", name));
    const pkg = JSON.parse(readFileSync(join(root, "package.json")));
    const entry = join(root, pkg.exports?.["."]?.import ?? pkg.main);
    assert.equal(pkg.version, "1.5.2");
    assert.ok(root.startsWith(runtime + "/"), `Host escaped isolated tree: ${root}`);
    assert.ok(!root.includes("patch_hash"), "Patched host in stock fixture");
    const dependencyRoots = {};
    for (const dependency of Object.keys(pkg.dependencies ?? {}).filter(value => /^@earendil-works\/pi-(ai|agent-core|coding-agent|tui)$/.test(value))) {
      const actual = realpathSync(join(dirname(root), dependency.split("/")[1]));
      assert.equal(actual, realpathSync(join(runtime, "node_modules", dependency)), "Mixed Pi dependency origin");
      dependencyRoots[dependency] = actual;
    }
    return [name, { root, entry, version: pkg.version, sha256: hash(entry), manifestSha256: hash(join(root, "package.json")), dependencyRoots,
      ...(name === "pi-coding-agent" ? { cli: join(root, "dist/cli.js"), cliSha256: hash(join(root, "dist/cli.js")), bin: pkg.bin } : {}) }];
  }));
}

if (operation === "prepare") {
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
  const result = spawnSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-workspace", "--registry=https://registry.npmjs.org"], { cwd: runtime, stdio: "inherit" });
  assert.equal(result.status, 0, "Frozen fixture installation failed");
  assert.equal(hash(join(runtime, "pnpm-lock.yaml")), hash(join(fixture, "pnpm-lock.yaml")), "Frozen install changed fixture lock");
  const sourceHashes = Object.fromEntries(files.filter(file => (file.startsWith("extensions/") && extensions.includes(file.split("/")[1]) && file.includes("/src/")) || file === "themes/codex-pi.json").map(file => {
    assert.equal(hash(join(repo, file)), hash(join(runtime, file)), "Source copy mismatch");
    return [file, hash(join(runtime, file))];
  }));
  const proof = { independentCheckout: false, sharedDependencies: false, runtime, lockSha256: hash(join(runtime, "pnpm-lock.yaml")), packages: inspect(), sourceHashes };
  writeFileSync(join(runtime, "host-proof.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof, null, 2));
} else if (operation === "inspect") console.log(JSON.stringify(inspect(), null, 2));
else if (operation === "types" || operation === "build") {
  inspect();
  let failed = false;
  for (const name of extensions) {
    const result = spawnSync("pnpm", ["exec", "tsc", "-p", `extensions/${name}/tsconfig.json`, ...(operation === "types" ? ["--noEmit"] : [])], { cwd: runtime, stdio: "inherit" });
    console.log(`${name}: exit ${result.status}`);
    failed ||= result.status !== 0;
    if (operation === "build" && name === "codex-compact" && result.status === 0) {
      const media = spawnSync(process.execPath, ["scripts/codex-compact-media.mjs", "copy"], { cwd: runtime, stdio: "inherit" });
      failed ||= media.status !== 0;
    }
  }
  process.exitCode = failed ? 1 : 0;
} else if (operation === "run") {
  inspect();
  assert.ok(args.length, "run requires a command");
  const isolated = createTestEnvironment("pi152-command");
  try {
    const result = spawnSync(args[0], args.slice(1), { cwd: runtime, stdio: "inherit", env: isolated.env });
    process.exitCode = result.status ?? 1;
  } finally { rmSync(isolated.directory, { recursive: true, force: true }); }
} else throw new Error(`Unknown operation: ${operation}`);
