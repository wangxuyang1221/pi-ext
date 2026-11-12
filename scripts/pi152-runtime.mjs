import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const names = ["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"];
const patchedNames = ["pi-coding-agent", "pi-tui"];
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const json = file => JSON.parse(readFileSync(file, "utf8"));
const profileName = patched => `pi-ext-${patched ? "patched" : "stock"}-pi152-verification`;

export function resolvePi152Runtime(repo, selected) {
  const runtime = resolve(repo, selected);
  assert.ok(runtime.startsWith(join(repo, ".tmp") + "/"), "Runtime must stay in repository .tmp");
  for (let path = runtime; path !== repo; path = dirname(path)) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    assert.ok(!stat?.isSymbolicLink(), "Runtime path must not contain symlinks");
    if (stat) assert.ok(realpathSync(path).startsWith(realpathSync(repo) + "/"), "Runtime escaped repository");
  }
  return runtime;
}

export function assertPi152Identity(runtime, patched, allowEmpty = false) {
  if (allowEmpty && (!existsSync(runtime) || readdirSync(runtime).length === 0)) return;
  assert.ok(existsSync(join(runtime, "package.json")), "Refusing nonempty directory without a Pi runtime identity");
  assert.ok(!lstatSync(join(runtime, "package.json")).isSymbolicLink(), "Runtime manifest must not be a symlink");
  const pkg = json(join(runtime, "package.json"));
  assert.equal(pkg.name, profileName(patched), "Refusing to overwrite another host profile");
  for (const name of names) assert.equal(pkg.dependencies?.[`@earendil-works/${name}`] ?? pkg.devDependencies?.[`@earendil-works/${name}`], "1.5.2", "Unexpected runtime dependency identity");
}

export function inspectPi152Runtime(repo, runtime, patched, verifyProof = true) {
  resolvePi152Runtime(repo, runtime);
  assertPi152Identity(runtime, patched);
  const fixture = join(repo, patched ? "test-support/pi152-patched" : "test-support/pi152");
  const lockHash = hash(join(fixture, "pnpm-lock.yaml"));
  assert.equal(hash(join(runtime, "pnpm-lock.yaml")), lockHash, "Runtime lock differs from fixed profile");
  assert.equal(hash(join(runtime, "node_modules/.pnpm/lock.yaml")), lockHash, "Installed lock differs from fixed profile");
  const lock = readFileSync(join(runtime, "node_modules/.pnpm/lock.yaml"), "utf8");
  if (patched) {
    assert.equal(hash(join(runtime, "pnpm-workspace.yaml")), hash(join(fixture, "pnpm-workspace.yaml")), "Unexpected patch configuration");
    for (const name of patchedNames) {
      const path = `patches/@earendil-works__${name}@1.5.2.patch`;
      const digest = hash(join(repo, path));
      assert.equal(hash(join(runtime, path)), digest, "Re-prepare stale patched runtime");
      assert.ok(lock.includes(`  '@earendil-works/${name}@1.5.2': ${digest}\n`), "Installed patch hash differs from current patch");
    }
  }
  const packages = Object.fromEntries(names.map(name => {
    const root = realpathSync(join(runtime, "node_modules/@earendil-works", name));
    const pkg = json(join(root, "package.json"));
    const entry = join(root, pkg.exports?.["."]?.import ?? pkg.main);
    assert.equal(pkg.version, "1.5.2");
    assert.ok(root.startsWith(runtime + "/"), `Host escaped isolated tree: ${root}`);
    assert.equal(root.includes("patch_hash"), patched && patchedNames.includes(name), "Unexpected patched package origin");
    const dependencyRoots = {};
    for (const dependency of Object.keys(pkg.dependencies ?? {}).filter(value => /^@earendil-works\/pi-(ai|agent-core|coding-agent|tui)$/.test(value))) {
      const actual = realpathSync(join(dirname(root), dependency.split("/")[1]));
      assert.equal(actual, realpathSync(join(runtime, "node_modules", dependency)), "Mixed Pi dependency origin");
      dependencyRoots[dependency] = actual;
    }
    if (name === "pi-coding-agent") assert.equal(pkg.bin.pi, "dist/bundle/cli.js", "Unexpected Pi bin target");
    return [name, { root, entry, version: pkg.version, sha256: hash(entry), manifestSha256: hash(join(root, "package.json")), dependencyRoots,
      ...(name === "pi-coding-agent" ? { cli: join(root, "dist/cli.js"), cliSha256: hash(join(root, "dist/cli.js")), bin: pkg.bin, binPath: join(root, pkg.bin.pi) } : {}) }];
  }));
  if (verifyProof) {
    const proof = json(join(runtime, "host-proof.json"));
    assert.equal(proof.runtime, runtime, "Host proof belongs to another runtime");
    assert.equal(proof.lockSha256, lockHash, "Host proof has stale lock");
    for (const name of names) assert.equal(proof.packages[name].sha256, packages[name].sha256, "Installed entry differs from verified host");
    if (patched) for (const name of patchedNames) {
      const path = `patches/@earendil-works__${name}@1.5.2.patch`;
      assert.equal(proof.patches[path].sha256, hash(join(repo, path)), "Host proof has stale patch");
      const files = [...readFileSync(join(repo, path), "utf8").matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1]);
      for (const file of files) assert.equal(hash(join(packages[name].root, file)), proof.patches[path].installedFiles[file], `Installed patched file changed: ${file}`);
    }
  }
  return packages;
}
