import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertPi152Identity, inspectPi152Runtime, resolvePi152Runtime } from "../../scripts/pi152-runtime.mjs";

const directories: string[] = [];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const write = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function directory() {
  mkdirSync(resolve(".tmp"), { recursive: true });
  const path = mkdtempSync(resolve(".tmp/pi152-guard-"));
  directories.push(path);
  return path;
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function installedFixture() {
  const repo = directory(), runtime = join(repo, ".tmp/runtime"), fixture = join(repo, "test-support/pi152-patched");
  const names = ["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"];
  const dependencies = Object.fromEntries(names.map(name => [`@earendil-works/${name}`, "1.5.2"]));
  write(join(runtime, "package.json"), JSON.stringify({ name: "pi-ext-patched-pi152-verification", devDependencies: dependencies }));
  const patches: Record<string, { sha256: string; installedFiles: Record<string, string> }> = {};
  const packages: Record<string, { sha256: string }> = {};
  let lock = "patchedDependencies:\n";
  for (const name of names) {
    const patched = name === "pi-tui" || name === "pi-coding-agent";
    const root = join(runtime, `node_modules/.pnpm/${name}@1.5.2${patched ? "_patch_hash=fixture" : ""}/node_modules/@earendil-works/${name}`);
    write(join(root, "package.json"), JSON.stringify({ version: "1.5.2", main: "dist/index.js", ...(name === "pi-coding-agent" ? { bin: { pi: "dist/bundle/cli.js" } } : {}) }));
    write(join(root, "dist/index.js"), name);
    write(join(root, "dist/cli.js"), "cli");
    write(join(root, "dist/bundle/cli.js"), "bundle");
    mkdirSync(join(runtime, "node_modules/@earendil-works"), { recursive: true });
    symlinkSync(root, join(runtime, "node_modules/@earendil-works", name));
    packages[name] = { sha256: digest(name) };
    if (patched) {
      const path = `patches/@earendil-works__${name}@1.5.2.patch`, text = "+++ b/dist/bundle/cli.js\n";
      write(join(repo, path), text); write(join(runtime, path), text);
      patches[path] = { sha256: digest(text), installedFiles: { "dist/bundle/cli.js": digest("bundle") } };
      lock += `  '@earendil-works/${name}@1.5.2': ${digest(text)}\n`;
    }
  }
  for (const root of [fixture, runtime]) {
    write(join(root, "pnpm-lock.yaml"), lock);
    write(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  }
  write(join(runtime, "node_modules/.pnpm/lock.yaml"), lock);
  write(join(runtime, "host-proof.json"), JSON.stringify({ runtime, lockSha256: digest(lock), packages, patches }));
  return { repo, runtime };
}

describe("Pi 1.5.2 runtime boundaries", () => {
  it("refuses prepare before deleting an unidentified evidence directory", () => {
    const runtime = directory(), sentinel = join(runtime, "stock/evidence.json");
    write(sentinel, "keep");
    const result = spawnSync(process.execPath, [resolve("scripts/pi152-patched-verify.mjs"), "prepare"], { env: { ...process.env, PI152_RUNTIME: runtime }, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("without a Pi runtime identity");
    expect(readFileSync(sentinel, "utf8")).toBe("keep");
  });
  it("allows new and empty targets but rejects another host profile", () => {
    const runtime = directory();
    expect(() => assertPi152Identity(runtime, true, true)).not.toThrow();
    expect(() => assertPi152Identity(join(runtime, "new"), true, true)).not.toThrow();
    write(join(runtime, "package.json"), JSON.stringify({ name: "pi-ext-stock-pi152-verification" }));
    expect(() => assertPi152Identity(runtime, true, true)).toThrow("another host profile");
  });
  it("rejects symlink targets and traversal before cleanup", () => {
    const root = directory();
    symlinkSync(root, join(root, "alias"));
    expect(() => resolvePi152Runtime(resolve("."), join(root, "alias/new"))).toThrow("symlinks");
    expect(() => resolvePi152Runtime(resolve("."), ".tmp/../scripts")).toThrow("repository .tmp");
  });
  it("accepts a consistent installation and resolves the manifest bin", () => {
    const { repo, runtime } = installedFixture();
    const packages = inspectPi152Runtime(repo, runtime, true);
    expect(packages["pi-coding-agent"].binPath).toContain("/dist/bundle/cli.js");
  });
  it("rejects a stock identity even when patch files are present", () => {
    const { repo, runtime } = installedFixture();
    const path = join(runtime, "package.json");
    write(path, readFileSync(path, "utf8").replace("patched", "stock"));
    expect(() => inspectPi152Runtime(repo, runtime, true)).toThrow("another host profile");
  });
  it("rejects stale installed lock metadata", () => {
    const { repo, runtime } = installedFixture();
    write(join(runtime, "node_modules/.pnpm/lock.yaml"), "stale");
    expect(() => inspectPi152Runtime(repo, runtime, true)).toThrow("Installed lock differs");
  });
  it("rejects modified installed patch files before launch", () => {
    const { repo, runtime } = installedFixture();
    write(join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"), "stock bundle");
    expect(() => inspectPi152Runtime(repo, runtime, true)).toThrow("Installed patched file changed");
  });
  it("rejects mixed internal Pi dependencies", () => {
    const { repo, runtime } = installedFixture();
    const path = join(runtime, "node_modules/@earendil-works/pi-coding-agent/package.json");
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    write(path, JSON.stringify({ ...pkg, dependencies: { "@earendil-works/pi-ai": "1.5.2" } }));
    const parent = join(runtime, "node_modules/.pnpm/pi-coding-agent@1.5.2_patch_hash=fixture/node_modules/@earendil-works");
    mkdirSync(join(parent, "wrong-ai"));
    symlinkSync(join(parent, "wrong-ai"), join(parent, "pi-ai"));
    expect(() => inspectPi152Runtime(repo, runtime, true)).toThrow("Mixed Pi dependency origin");
  });
});
