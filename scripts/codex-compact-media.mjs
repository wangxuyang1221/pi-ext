import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "extensions/codex-compact/src/media");
const compiler = "rustc 1.97.0 (2d8144b78 2026-07-07)";
const target = "wasm32-unknown-unknown";
const upstream = "6b9826e3aa83b1a5947db50f4332cb9c65f1b340";
const sourceInputs = (directory) => ["Cargo.toml", "Cargo.lock", "src/lib.rs", "src/audio.rs", "src/context.rs", "README.md", ...files(join(directory, "license-overrides")).map((path) => `license-overrides/${path}`)];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = (path) => sha256(readFileSync(path));
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const saveJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected media symlink: ${path}`);
    return entry.isDirectory() ? files(join(directory, entry.name), path) : [path];
  }).sort();
}

/** Verify both inputs and every redistributable byte without invoking Rust or the network. */
export function verifyMedia(directory = source) {
  const manifest = json(join(directory, "manifest.json"));
  if (manifest.schemaVersion !== 1 || manifest.compiler !== compiler || manifest.upstreamCommit !== upstream || manifest.target !== target) {
    throw new Error("Unexpected media build provenance");
  }
  const required = [...sourceInputs(directory), "decoder.wasm", "third-party/dependencies.json", ...files(join(directory, "third-party")).map((path) => `third-party/${path}`)];
  if (JSON.stringify([...new Set(required)].sort()) !== JSON.stringify(Object.keys(manifest.files).sort())) {
    throw new Error("Incomplete media file manifest");
  }
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (path.split("/").includes("..") || path.startsWith("/") || fileHash(join(directory, path)) !== hash) {
      throw new Error(`Media integrity mismatch: ${path}`);
    }
  }
  const bytes = readFileSync(join(directory, "decoder.wasm"));
  const module = new WebAssembly.Module(bytes);
  if (WebAssembly.Module.imports(module).length) throw new Error("Media decoder must have no host imports");
  const exports = new Set(WebAssembly.Module.exports(module).map((entry) => entry.name));
  for (const name of ["memory", "allocate", "release", "image_bytes", "audio_duration", "context_hook", "context_inter_agent"]) {
    if (!exports.has(name)) throw new Error(`Missing media ABI export: ${name}`);
  }
  const deps = json(join(directory, "third-party/dependencies.json"));
  for (const dep of deps.packages) {
    if (!dep.licenses.length || dep.licenses.some((path) => !manifest.files[path])) throw new Error(`Missing license: ${dep.name}`);
    if (dep.license.includes("MPL-2.0") && (!dep.bundledSource || !manifest.files[dep.bundledSource] || fileHash(join(directory, dep.bundledSource)) !== dep.checksum)) {
      throw new Error(`Missing corresponding MPL source: ${dep.name}`);
    }
  }
  return manifest;
}

export function copyMedia(destination = join(root, "extensions/codex-compact/dist/media")) {
  const manifest = verifyMedia();
  rmSync(destination, { recursive: true, force: true });
  for (const path of [...Object.keys(manifest.files), "manifest.json"]) {
    mkdirSync(dirname(join(destination, path)), { recursive: true });
    cpSync(join(source, path), join(destination, path));
  }
  verifyMedia(destination);
}

function generateMedia() {
  const toolchain = process.env.CODEX_MEDIA_RUST_TOOLCHAIN ?? "stable";
  const env = { ...process.env, CARGO_TARGET_DIR: join(root, ".tmp/codex-alignment/media-target") };
  const run = (command, args) => execFileSync(command, args, { cwd: root, env, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
  if (run("rustc", [`+${toolchain}`, "--version"]) !== compiler) throw new Error(`Regeneration requires ${compiler}`);
  run("cargo", [`+${toolchain}`, "build", "--manifest-path", join(source, "Cargo.toml"), "--locked", "--release", "--target", target]);
  cpSync(join(env.CARGO_TARGET_DIR, target, "release/codex_media_estimator.wasm"), join(source, "decoder.wasm"));
  const metadata = JSON.parse(run("cargo", [`+${toolchain}`, "metadata", "--manifest-path", join(source, "Cargo.toml"), "--locked", "--filter-platform", target, "--format-version", "1"]));
  const thirdParty = join(source, "third-party");
  rmSync(thirdParty, { recursive: true, force: true });
  mkdirSync(join(thirdParty, "licenses"), { recursive: true });
  const packages = [];
  const locked = new Map(readFileSync(join(source, "Cargo.lock"), "utf8").split("[[package]]").slice(1).map((block) => {
    const name = /^name = "([^"]+)"$/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"$/m.exec(block)?.[1];
    return [`${name}@${version}`, /^checksum = "([a-f0-9]{64})"$/m.exec(block)?.[1]];
  }));
  for (const pkg of metadata.packages.filter((pkg) => pkg.source)) {
    const directory = dirname(pkg.manifest_path);
    const checksum = locked.get(`${pkg.name}@${pkg.version}`);
    if (!checksum) throw new Error(`Missing locked checksum: ${pkg.name}`);
    const licenseFiles = readdirSync(directory, { withFileTypes: true }).filter((entry) => /^(licen[cs]e|copying|notice)([._-]|$)/i.test(entry.name));
    const licenses = [];
    for (const entry of licenseFiles) {
      const paths = entry.isDirectory() ? files(join(directory, entry.name)).map((path) => `${entry.name}/${path}`) : [entry.name];
      for (const path of paths) {
        const bytes = readFileSync(join(directory, path));
        const output = `third-party/licenses/${sha256(bytes)}.txt`;
        writeFileSync(join(source, output), bytes);
        licenses.push(output);
      }
    }
    const licenseOverride = json(join(source, "license-overrides/sources.json"))[`${pkg.name}@${pkg.version}`];
    if (!licenses.length && licenseOverride) {
      for (const path of licenseOverride.files) {
        const bytes = readFileSync(join(source, "license-overrides", path));
        const output = `third-party/licenses/${sha256(bytes)}.txt`;
        writeFileSync(join(source, output), bytes);
        licenses.push(output);
      }
    }
    if (!licenses.length) throw new Error(`No license files found for ${pkg.name}`);
    const dep = { name: pkg.name, version: pkg.version, license: pkg.license, checksum,
      sourceUrl: `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate`, licenses: [...new Set(licenses)].sort() };
    if (licenseOverride) dep.licenseSource = licenseOverride.url;
    if (pkg.license.includes("MPL-2.0")) {
      const archive = directory.replace(`${join("registry", "src")}/`, `${join("registry", "cache")}/`) + ".crate";
      if (fileHash(archive) !== checksum) throw new Error(`Crate checksum mismatch: ${pkg.name}`);
      dep.bundledSource = `third-party/source/${pkg.name}-${pkg.version}.crate`;
      mkdirSync(dirname(join(source, dep.bundledSource)), { recursive: true });
      cpSync(archive, join(source, dep.bundledSource));
    }
    packages.push(dep);
  }
  const sysroot = run("rustc", [`+${toolchain}`, "--print", "sysroot"]);
  mkdirSync(join(thirdParty, "rust"), { recursive: true });
  cpSync(join(sysroot, "share/doc/rust/COPYRIGHT-library.html"), join(thirdParty, "rust/COPYRIGHT-library.html"));
  cpSync(join(sysroot, "share/doc/rust/licenses"), join(thirdParty, "rust/licenses"), { recursive: true });
  saveJson(join(thirdParty, "dependencies.json"), { compiler, packages });
  const paths = [...sourceInputs(source), "decoder.wasm", ...files(thirdParty).map((path) => `third-party/${path}`)].sort();
  saveJson(join(source, "manifest.json"), { schemaVersion: 1, compiler, target, upstreamCommit: upstream,
    platformFeatures: { common: ["jpeg", "png", "gif", "webp"], darwin: ["tiff"], win32: ["bmp"] },
    files: Object.fromEntries(paths.map((path) => [path, fileHash(join(source, path))])) });
  verifyMedia();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2] ?? "verify";
  if (command === "generate") generateMedia();
  else if (command === "copy") copyMedia();
  else if (command === "verify") verifyMedia();
  else throw new Error(`Unknown media command: ${command}`);
  console.log(`Media ${command} verified.`);
}
