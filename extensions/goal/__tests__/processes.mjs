import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GoalStore } from "../dist/storage.js";

const childMode = process.argv[2] === "child";
const root = childMode ? process.argv[3] : await mkdtemp(resolve(".goal-process-test-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const sdkRoot = resolve(childMode ? process.argv[4] : process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const { SessionManager } = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const version = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8")).version;
const disk = new GoalStore(join(root, "goals"));
if (childMode) {
  process.once("message", async message => {
    try {
      const manager = SessionManager.create(root, join(root, "sessions"));
      const owner = { ownerSessionId: manager.getSessionId(), cwd: root, sessionFile: manager.getSessionFile() };
      if (message.action === "replacement-only") {
        process.send({ ok: true, owner });
        return;
      }
      const lease = message.action === "create" ? await disk.openSession(owner) : await disk.takeover(message.expected, owner);
      if (message.action === "create") await lease.replace("Survive SIGKILL", lease.snapshot);
      process.send({ ok: true, record: lease.snapshot });
    } catch (error) { process.send({ ok: false, error: error.message }); }
  });
  // Deliberately hold the writer until the parent kills this process.
  setInterval(() => {}, 1000);
} else {
  const children = new Set();
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) { children.delete(child); return; }
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
    children.delete(child);
  }
  async function run(message) {
    const child = fork(fileURLToPath(import.meta.url), ["child", root, sdkRoot], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    children.add(child);
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Child deadline exceeded")); }, 10000);
      child.once("message", data => { clearTimeout(timeout); resolve(data); });
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.send(message);
    });
    return { child, result };
  }
  try {
    const created = await run({ action: "create" });
    assert.equal(created.result.ok, true);
    const saved = created.result.record;
    assert.equal(existsSync(saved.sessionFile), false);
    assert.deepEqual(await disk.recoverable(root), []);
    await stop(created.child);
    assert.equal((await disk.recoverable(root))[0].recordId, saved.recordId);
    assert.deepEqual(await disk.read(saved.recordId), saved);

    const interrupted = await run({ action: "replacement-only" });
    assert.equal(interrupted.result.ok, true);
    await stop(interrupted.child);
    assert.deepEqual(await disk.read(saved.recordId), saved);

    const contenders = await Promise.all([run({ action: "takeover", expected: saved }), run({ action: "takeover", expected: saved })]);
    assert.equal(contenders.filter(contender => contender.result.ok).length, 1);
    const winner = contenders.find(contender => contender.result.ok).result.record;
    assert.equal(winner.recordId, saved.recordId);
    assert.equal(winner.revision, saved.revision + 1);
    assert.deepEqual(winner.goal, saved.goal);
    assert.equal((await disk.records()).length, 1);
    for (const contender of contenders) await stop(contender.child);
    const reopened = await disk.openSession(winner);
    assert.deepEqual(reopened.snapshot, winner);
    await reopened.close();
    console.log(JSON.stringify({ version, results: ["SIGKILL-after-pre-reply-commit", "SIGKILL-between-session-creation-and-ownership-commit", "two-process-single-record-takeover", "SIGKILL-winner-restart"], childProcessesStopped: children.size === 0 }, null, 2));
  } finally {
    for (const child of children) await stop(child);
    await rm(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  }
}
