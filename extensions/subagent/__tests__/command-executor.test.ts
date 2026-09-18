import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { executeCommand } from "../src/command-executor.js";

test("reaps an ignoring descendant even when its command leader exits on SIGTERM", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-exec-"));
  const pidFile = join(root, "descendant");
  try {
    const code = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
    const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(code)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
    await assert.rejects(executeCommand(process.execPath, ["-e", parent], { timeout: 300 }), /timed out/iu);
    const pid = Number(await readFile(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
    if (pid > 0) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await rm(root, { recursive: true, force: true });
  }
});

test("terminates a command that ignores SIGTERM before returning its timeout", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-exec-"));
  try {
    const pidFile = join(root, "pid");
    const started = performance.now();
    await assert.rejects(executeCommand(process.execPath, ["-e", `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`], { timeout: 300 }), /timed out/iu);
    const pid = Number(await readFile(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.ok(performance.now() - started < 2000);
  } finally { await rm(root, { recursive: true, force: true }); }
});
