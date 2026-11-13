import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createTestEnvironment } from "../test-support/environment.mjs";
import { stopProcessGroup } from "./codex-compact-quality-process.mjs";

const profile = process.argv[2];
assert.ok(["stock", "patched"].includes(profile), "Choose stock or patched");
assert.equal(process.argv.length, 3, "Usage: pnpm run pi152:check stock|patched");
mkdirSync(resolve(".tmp/test-results"), { recursive: true });
const evidence = mkdtempSync(resolve(`.tmp/test-results/pi152-${profile}-`));
const runtime = join(evidence, "runtime");
const launcher = profile === "patched" ? "scripts/pi152-patched-verify.mjs" : "scripts/pi152-verify.mjs";
const run = (...args) => [process.execPath, launcher, "run", ...args];
const python = (...args) => run("conda", "run", "--no-capture-output", "-n", "codex-py312", "python", ...args);
const verify = name => run("node", ".cursor/skills/verify-pi-ext/scripts/verify.mjs", "run", name);
const commands = [
  ...["prepare", "build", "types"].map(step => [process.execPath, launcher, step]),
  run("node", "test-support/pi152/load.mjs", ...(profile === "patched" ? ["--patched"] : [])),
  run("pnpm", "test", "test-support/__tests__/local-refresh.test.ts", "test-support/__tests__/pi152-upstream.test.ts", "extensions/skill-mentions/__tests__/session-summary.test.ts", "extensions/openai-fast-mode/__tests__/host-compatibility.test.ts", "extensions/mcp/__tests__/history-host.test.ts", "extensions/codex-compact/__tests__/resume-runtime.test.ts", "extensions/codex-compact/__tests__/repair-runtime.test.ts"),
  run("node", ".cursor/skills/verify-pi-openai-fast-mode/scripts/verify.mjs", "full"),
  run("pnpm", "run", "web-search:check"),
  python("-m", "unittest", "discover", "-s", ".cursor/skills/verify-pi-ext/scripts", "-p", "test_event_readers.py"),
  verify("search-production"), verify("search-production-fullscreen"),
  python("-m", "unittest", "discover", "-s", "extensions/mcp/__tests__", "-p", "verification_records_test.py"),
  verify("mcp-combination"), verify("mcp-history"), verify("mcp-recovery"),
  run("node", "extensions/skill-mentions/__tests__/journeys.mjs", profile === "patched" ? "resume" : "resume-stock"),
  run("node", "extensions/skill-mentions/__tests__/journeys.mjs", "combination-prebuilt"),
  python(".cursor/skills/verify-pi-codex-compact/scripts/compact-pty.py", ".tmp/compact-combination", "combination"),
  python(".cursor/skills/verify-pi-codex-compact/scripts/compact-pty.py", ".tmp/compact-navigation", "navigation"),
  run("pnpm", "run", "codemode:check"),
  ...["regular", "fullscreen"].flatMap(mode => [false, true].map(working => python("scripts/local-refresh-pty.py", `.tmp/text-${mode}-${working ? "working" : "regions"}`, "--cli", "node_modules/.bin/pi", "--mode", mode, ...(working ? ["--working"] : []), ...(profile === "stock" ? ["--original"] : [])))),
  python("scripts/local-refresh-pty.py", ".tmp/text-kitty", "--cli", "node_modules/.bin/pi", "--mode", "fullscreen", "--kitty", ...(profile === "stock" ? ["--original"] : [])),
];
const isolated = createTestEnvironment(`pi152-${profile}`);
const env = { ...isolated.env, PI152_RUNTIME: runtime };
const summary = { profile, evidence, runtime, startedAt: new Date().toISOString(), status: "running", commands: [], cleanup: "pending" };
const save = () => writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
let child;
const abort = new AbortController();
const interrupt = () => abort.abort(new Error("Host verification interrupted"));
process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
try {
  console.log(JSON.stringify({ profile, evidence, runtime }));
  for (const [index, command] of commands.entries()) {
    abort.signal.throwIfAborted();
    const record = { command, startedAt: new Date().toISOString(), status: "running", cleanup: "pending" };
    summary.commands.push(record); save();
    console.log(JSON.stringify({ index, ...record }));
    const log = createWriteStream(join(evidence, `${index}.log`));
    child = spawn(command[0], command.slice(1), { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const closed = new Promise(resolve => child.once("close", resolve));
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { process.stdout.write(data); log.write(data); });
    try {
      const [code] = await once(child, "exit", { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(600_000)]) });
      record.exitCode = code;
      assert.equal(code, 0, `Pi ${profile} verification failed at command ${index}`);
      record.status = "passed";
    } catch (error) {
      record.status = "failed"; record.error = String(error);
      if (child.pid && child.exitCode === null) try { process.kill(-child.pid, "SIGTERM"); } catch (signalError) { if (signalError.code !== "ESRCH") record.signalError = String(signalError); }
      throw error;
    }
    finally {
      try { if (child.pid) record.cleanup = await stopProcessGroup(child, { graceMs: 15_000 }); await closed; }
      finally { log.end(); await once(log, "finish"); child = undefined; save(); }
    }
  }
  summary.status = "passed";
} catch (error) { summary.status = "failed"; summary.error = String(error); process.exitCode = 1; }
finally {
  process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  // Keep the independent installation and nested evidence for CI artifacts and diagnosis.
  const { rmSync } = await import("node:fs");
  if (summary.commands.every(record => record.cleanup?.groupStopped)) { rmSync(isolated.directory, { recursive: true, force: true }); summary.cleanup = "removed"; }
  else summary.cleanup = "unverified";
  summary.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ profile, status: summary.status, evidence, cleanup: summary.cleanup }));
}
