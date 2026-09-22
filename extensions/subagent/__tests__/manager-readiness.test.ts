import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { SubagentManager, type ManagedTmuxRuntime } from "../src/manager.js";
import { createSessionState, SessionStateStore } from "../src/state-store.js";

async function fixture(authenticationEnvironment?: () => Promise<Record<string, string>>) {
  const root = await mkdtemp(join(process.cwd(), ".sa-readiness-"));
  const store = new SessionStateStore(root);
  const locator = { sessionName: "test", windowId: "@1", paneId: "%1", panePid: 123 };
  let ready = false;
  let alive = true;
  let now = 0;
  let sent = 0;
  let sessionFile = "";
  let onPoll = async () => {
    ready = true;
    await store.update("child", child => ({ ...child, runtime: { ...child.runtime, promptReady: true } }));
  };
  const runtime: ManagedTmuxRuntime = {
    async launch(spec) {
      sessionFile = spec.args[3]!;
      await appendFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "child", cwd: root,
        timestamp: new Date().toISOString() })}\n`);
      const launch = JSON.parse(spec.environment.PI_SUBAGENT_LAUNCH!);
      const child = createSessionState({ sessionId: "child", epoch: "ce", cwd: root, sessionFile, now: "now",
        parent: JSON.parse(spec.environment.PI_SUBAGENT_PARENT!), launch,
        processInstanceId: launch.processInstanceId, tmux: locator });
      await store.save(child);
      return locator;
    },
    async sendPrompt(_locator, text) {
      sent++;
      // Pi accepts editor input during startup, but does not yet consume a task.
      if (!ready) return;
      await appendFile(sessionFile, `${JSON.stringify({ type: "message", id: "user", parentId: null, timestamp: new Date().toISOString(),
        message: { role: "user", content: text } })}\n`);
    },
    async capturePane() { return ""; },
    async isAlive() { return alive; },
    async close() { alive = false; },
  };
  const manager = new SubagentManager({ store, runtime, stateRoot: root, nativeSessionRoot: join(root, "native"),
    extensionPath: "/extension.js", piPath: "/pi", environment: {}, nowMs: () => now, registrationTimeoutMs: 100,
    authenticationEnvironment,
    sleep: async (ms) => {
      now += ms;
      await onPoll();
    },
  });
  await store.save(createSessionState({ sessionId: "parent", epoch: "pe", cwd: root,
      sessionFile: join(root, "parent.jsonl"), now: "now" }));
  return { store, runtime, manager, root,
    spawn: (signal?: AbortSignal) => manager.spawn("parent", { task: "First task" }, { cwd: root }, signal),
    sent: () => sent, now: () => now, alive: () => alive,
    setAlive: (value: boolean) => { alive = value; },
    onPoll: (fn: () => Promise<void>) => { onPoll = fn; },
    cleanup: async () => { await manager.releaseAllNamespaces(); await rm(root, { recursive: true, force: true }); },
  };
}

test("waits for the child input loop before sending its first task", async () => {
  const f = await fixture();
  try {
    const child = await f.spawn();
    assert.equal(child.agentId, "child");
    assert.equal(f.sent(), 1);
    assert.equal(f.now(), 50);
  } finally { await f.cleanup(); }
});

test("stops waiting immediately when a registered child exits before readiness", async () => {
  const f = await fixture();
  f.onPoll(async () => { f.setAlive(false); });
  try {
    await assert.rejects(f.spawn(), /Child runtime exited before prompt readiness/u);
    assert.equal(f.now(), 50);
    assert.equal(f.sent(), 0);
    assert.equal(await f.store.load("child"), undefined);
    assert.deepEqual((await f.store.load("parent"))?.reservations, []);
  } finally { await f.cleanup(); }
});

test("rejects a replaced pane identity before submitting a task", async () => {
  const f = await fixture();
  f.runtime.observe = async () => ({ identity: f.now() ? "mismatch" : "matched", process: f.alive() ? "alive" : "exited",
    terminal: f.alive() ? "present" : "absent", promptReady: true });
  try {
    await assert.rejects(f.spawn(), /Child runtime identity could not be confirmed before prompt readiness/u);
    assert.equal(f.sent(), 0);
    assert.equal(await f.store.load("child"), undefined);
  } finally { await f.cleanup(); }
});

test("times out readiness without submitting a task and releases the spawn slot", async () => {
  const f = await fixture();
  f.onPoll(async () => {});
  try {
    await assert.rejects(f.spawn(), /Timed out waiting for child prompt readiness/u);
    assert.equal(f.now(), 100);
    assert.equal(f.sent(), 0);
    assert.equal(f.alive(), false);
    assert.equal(await f.store.load("child"), undefined);
    assert.deepEqual((await f.store.load("parent"))?.reservations, []);
    assert.deepEqual((await f.store.load("parent"))?.children, []);
  } finally { await f.cleanup(); }
});

test("does not delay a child that is already ready", async () => {
  const f = await fixture();
  const launch = f.runtime.launch.bind(f.runtime);
  f.runtime.launch = async spec => {
    const locator = await launch(spec);
    await f.store.update("child", child => ({ ...child, runtime: { ...child.runtime, promptReady: true } }));
    return locator;
  };
  f.runtime.sendPrompt = async (_locator, text) => {
    const child = (await f.store.load("child"))!;
    await appendFile(child.runtime.sessionFile, `${JSON.stringify({ type: "message", id: "user", parentId: null,
      timestamp: new Date().toISOString(), message: { role: "user", content: text } })}\n`);
  };
  try {
    await f.spawn();
    assert.equal(f.now(), 0);
  } finally { await f.cleanup(); }
});

test("cancels readiness without leaving a live child or occupied slot", async () => {
  const f = await fixture();
  const controller = new AbortController();
  f.onPoll(async () => { controller.abort(new Error("Cancelled during readiness")); });
  try {
    await assert.rejects(f.spawn(controller.signal), /Cancelled during readiness/u);
    assert.equal(f.sent(), 0);
    assert.equal(f.alive(), false);
    assert.equal(await f.store.load("child"), undefined);
    assert.deepEqual((await f.store.load("parent"))?.reservations, []);
  } finally { await f.cleanup(); }
});

test("does not accept readiness from a replacement session epoch", async () => {
  const f = await fixture();
  f.onPoll(async () => { await f.store.update("child", child => ({ ...child, epoch: "replacement",
    runtime: { ...child.runtime, promptReady: true } })); });
  try {
    await assert.rejects(f.spawn(), /Child session identity changed before prompt readiness/u);
    assert.equal(f.sent(), 0);
  } finally { await f.cleanup(); }
});

test("reports a bound authentication rejection without resending and releases the slot", async () => {
  const f = await fixture();
  let calls = 0;
  f.runtime.sendPrompt = async (_locator, text) => {
    calls++;
    const deliveryId = /^\[subagent:([a-f0-9]+)\]/u.exec(text)![1];
    await f.store.update("child", child => ({ ...child, runtime: { ...child.runtime,
      promptRejection: { deliveryId, code: "authentication_unavailable" } } }));
  };
  try {
    await assert.rejects(f.spawn(), /delivery_rejected: Child authentication unavailable/u);
    assert.equal(calls, 1);
    assert.equal(f.alive(), false);
    assert.equal(await f.store.load("child"), undefined);
    assert.deepEqual((await f.store.load("parent"))?.reservations, []);
  } finally { await f.cleanup(); }
});

test("ignores a stale rejection and preserves unknown delivery without retry", async () => {
  const f = await fixture();
  let calls = 0;
  f.runtime.sendPrompt = async () => {
    calls++;
    await f.store.update("child", child => ({ ...child, runtime: { ...child.runtime,
      promptRejection: { deliveryId: "stale", code: "authentication_unavailable" } } }));
  };
  try {
    await assert.rejects(f.spawn(), /delivery_unconfirmed/u);
    assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

test("removes a private credential transfer after launch fails", async () => {
  const f = await fixture(async () => ({ DEEPSEEK_API_KEY: "fixture-key" }));
  let path = "";
  f.runtime.launch = async spec => {
    path = spec.privateEnvironmentFile!;
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.match(await readFile(path, "utf8"), /fixture-key/u);
    assert.doesNotMatch(JSON.stringify(spec), /fixture-key/u);
    throw new Error("Launch failed");
  };
  try {
    await assert.rejects(f.spawn(), /Launch failed/u);
    await assert.rejects(readFile(path), { code: "ENOENT" });
  } finally { await f.cleanup(); }
});

test("does not overwrite or remove an existing file while preparing credentials", async () => {
  let previous = "";
  const f = await fixture(async () => {
    const parentDirectory = join(f.root, "native", "parent");
    const [directory] = await readdir(parentDirectory);
    previous = join(parentDirectory, directory, "authentication.sh");
    await writeFile(previous, "previous user file");
    return { DEEPSEEK_API_KEY: "fixture-key" };
  });
  try {
    await f.spawn();
    assert.equal(await readFile(previous, "utf8"), "previous user file");
  } finally { await f.cleanup(); }
});
