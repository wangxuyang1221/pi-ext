#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectPi152Runtime, resolvePi152Runtime } from "./pi152-runtime.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolvePi152Runtime(repo, process.env.PI152_RUNTIME ?? ".tmp/pi152-patches/runtime");
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const packages = inspectPi152Runtime(repo, runtime, true);
const patches = Object.fromEntries(["pi-coding-agent", "pi-tui"].map(name => {
  const path = `patches/@earendil-works__${name}@1.5.2.patch`;
  return [path, hash(join(runtime, path))];
}));
const cli = packages["pi-coding-agent"].binPath;
console.error(JSON.stringify({ host: "pi152-patched", cwd: process.cwd(), cli, packages, patches, lockSha256: hash(join(runtime, "pnpm-lock.yaml")) }));
const extensions = ["codex-ui", "codex-compact", "openai-fast-mode", "mcp", "skill-mentions"];
const child = spawn(process.execPath, [cli, "--no-extensions", ...extensions.flatMap(name => ["-e", join(runtime, `extensions/${name}/dist/index.js`)]), ...process.argv.slice(2)], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
