import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { SubagentManager, type ManagedTmuxRuntime } from "../src/manager.js";
import { registerDirectChild } from "../src/ownership.js";
import { SessionRuntimeHost } from "../src/runtime-host.js";
import { encodeSettledCursor } from "../src/cursor.js";
import { createSessionState, SessionStateStore } from "../src/state-store.js";

const locator = { sessionName: "isolated-test", windowId: "@1", paneId: "%1", panePid: 1234 };
const now = "2026-09-09T00:00:00.000Z";

async function fixture() {
  const root = await mkdtemp(join(process.cwd(), ".subagent-races-"));
  const store = new SessionStateStore(root);
  const sessionFile = join(root, "child.jsonl");
  const child = createSessionState({
    sessionId: "child", epoch: "child-epoch", cwd: root, sessionFile, now,
    parent: { sessionId: "parent", epoch: "parent-epoch", registrationToken: "registration" },
    launch: { cwd: root, sessionDir: root, displayName: "Child", processInstanceId: "process" },
    processInstanceId: "process", tmux: locator,
  });
  const parent = registerDirectChild(createSessionState({
    sessionId: "parent", epoch: "parent-epoch", cwd: root, sessionFile: join(root, "parent.jsonl"), now,
  }), child, now);
  await store.save(parent);
  await store.save(child);
  await writeFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "child" })}\n`);
  let alive = true;
  let closes = 0;
  const runtime: ManagedTmuxRuntime = {
    async launch() { return locator; },
    async sendPrompt() {},
    async capturePane() { return ""; },
    async isAlive() { return alive; },
    async close() { closes++; alive = false; },
  };
  const manager = new SubagentManager({ store, runtime, stateRoot: root, nativeSessionRoot: root,
    extensionPath: "unused", piPath: "unused", environment: {}, pollIntervalMs: 1,
    promptAckTimeoutMs: 10, closeTimeoutMs: 1_000, registrationTimeoutMs: 10, maxActive: 1 });
  return { root, store, child, parent, sessionFile, runtime, manager,
    setAlive(value: boolean) { alive = value; }, getCloses: () => closes,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function message(id: string, parentId: string | null, role: string, text: string) {
  return { type: "message", id, parentId, timestamp: now,
    message: { role, content: [{ type: "text", text }], ...(role === "assistant" ? { stopReason: "stop" } : {}) } };
}

async function append(sessionFile: string, ...entries: object[]) {
  await appendFile(sessionFile, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

test("confirms a persisted prompt beyond the first bounded turns page", async () => {
  const f = await fixture();
  try {
    f.runtime.sendPrompt = async (_locator, text) => {
      await append(f.sessionFile,
        message("old", null, "user", "Earlier work"),
        message("a1", "old", "assistant", "A".repeat(64 * 1024)),
        message("a2", "a1", "assistant", "B".repeat(64 * 1024)),
        message("new", "a2", "user", text));
    };
    const delivered = await f.manager.prompt("parent", "child", "New work", "follow_up");
    assert.equal(delivered.confirmation, "session");
  } finally { await f.cleanup(); }
});

test.each(["steer", "follow_up"] as const)("keeps %s delivery bound when it finishes before prompt returns", async (delivery) => {
  const f = await fixture();
  try {
    f.runtime.sendPrompt = async (_locator, text) => {
      const deliveryId = /^\[subagent:([a-f0-9]+)\]/u.exec(text)![1];
      await append(f.sessionFile, {
        type: "custom", customType: "subagent_delivery", id: "receipt", parentId: null, timestamp: now,
        data: { agentId: "child", epoch: "child-epoch", deliveryId, generation: 1 },
      }, message("u", "receipt", "user", text), message("a", "u", "assistant", "Fast result"));
      await f.store.update("child", (state) => ({ ...state,
        runtime: { ...state.runtime, generation: 1, settledGeneration: 1, busy: false, status: "settled" } }));
    };
    const delivered = await f.manager.prompt("parent", "child", "Fast work", delivery);
    const settled = await f.manager.wait("parent", "child", { afterSettled: delivered.agent.settledCursor, timeoutMs: 0 });
    assert.equal(settled.outcome, "settled");
    assert.equal(settled.activity[0]?.id, "a");
  } finally { await f.cleanup(); }
});

test.each(["steer", "follow_up"] as const)("does not settle an unconsumed %s queue entry", async (delivery) => {
  const f = await fixture();
  try {
    await f.store.update("child", (state) => ({ ...state,
      runtime: { ...state.runtime, generation: 1, busy: true } }));
    let queued = "";
    f.runtime.sendPrompt = async (_locator, text) => { queued = text; };
    f.runtime.capturePane = async () => `${delivery === "steer" ? "Steering" : "Follow-up"}: ${queued}`;
    const first = await f.manager.prompt("parent", "child", "First queued work", delivery);
    const second = await f.manager.prompt("parent", "child", "Second queued work", delivery);
    await f.store.update("child", (state) => ({ ...state,
      runtime: { ...state.runtime, settledGeneration: 1, busy: false } }));
    assert.equal((await f.manager.wait("parent", "child", { afterSettled: first.agent.settledCursor, timeoutMs: 0 })).outcome, "timeout");
    await append(f.sessionFile, {
      type: "custom", customType: "subagent_delivery", id: "first-receipt", parentId: null, timestamp: now,
      data: { agentId: "child", epoch: "child-epoch", deliveryId: first.deliveryId, generation: 2 },
    });
    await f.store.update("child", (state) => ({ ...state,
      runtime: { ...state.runtime, generation: 2, settledGeneration: 2, busy: false } }));
    assert.equal((await f.manager.wait("parent", "child", { afterSettled: first.agent.settledCursor, timeoutMs: 0 })).outcome, "settled");
    assert.equal((await f.manager.wait("parent", "child", { afterSettled: second.agent.settledCursor, timeoutMs: 0 })).outcome, "timeout");
  } finally { await f.cleanup(); }
});

test("returns bounded assistant errors from a settled wait", async () => {
  const f = await fixture();
  try {
    const errorMessage = "HTTP 401: invalid API key";
    await append(f.sessionFile, message("u", null, "user", "Work"), {
      type: "message", id: "error", parentId: "u", timestamp: now,
      message: { role: "assistant", content: [], stopReason: "error", errorMessage },
    });
    await f.store.update("child", (state) => ({ ...state,
      runtime: { ...state.runtime, generation: 1, settledGeneration: 1, busy: false } }));
    const result = await f.manager.wait("parent", "child", {
      afterSettled: encodeSettledCursor({ agentId: "child", epoch: "child-epoch", generation: 0 }),
      timeoutMs: 0,
    });
    assert.equal(result.outcome, "settled");
    assert.equal(result.activity[0]?.kind, "assistant");
    assert.equal(result.activity[0].errorMessage, errorMessage);
    assert.ok(result.returnedBytes <= 72 * 1024);
  } finally { await f.cleanup(); }
});

test("waits for the consumed delivery generation instead of the previous run", async () => {
  const f = await fixture();
  try {
    await append(f.sessionFile, message("u1", null, "user", "Old work"));
    await f.store.update("child", (state) => ({ ...state,
      runtime: { ...state.runtime, generation: 1, busy: true } }));
    f.runtime.sendPrompt = async (_locator, text) => {
      await append(f.sessionFile, message("a1", "u1", "assistant", "Old result"));
      await f.store.update("child", (state) => ({ ...state,
        runtime: { ...state.runtime, generation: 2, settledGeneration: 1, busy: true } }));
      const deliveryId = /^\[subagent:([a-f0-9]+)\]/u.exec(text)![1];
      await append(f.sessionFile, {
        type: "custom", customType: "subagent_delivery", id: "receipt", parentId: "a1", timestamp: now,
        data: { agentId: "child", epoch: "child-epoch", deliveryId, generation: 2 },
      }, message("u2", "receipt", "user", text));
    };
    const delivered = await f.manager.prompt("parent", "child", "New work", "follow_up");
    const pending = await f.manager.wait("parent", "child", { afterSettled: delivered.agent.settledCursor, timeoutMs: 0 });
    assert.equal(pending.outcome, "timeout");
    await f.store.update("child", (state) => ({ ...state,
      runtime: { ...state.runtime, settledGeneration: 2, busy: false } }));
    const settled = await f.manager.wait("parent", "child", { afterSettled: delivered.agent.settledCursor, timeoutMs: 0 });
    assert.equal(settled.outcome, "settled");
    assert.equal(settled.generation, 2);
  } finally { await f.cleanup(); }
});

test("honors explicit tree navigation after an interrupted run", async () => {
  const f = await fixture();
  try {
    const host = new SessionRuntimeHost({ store: f.store, parent: f.child.parent,
      launch: f.child.launch, createEpoch: () => "child-epoch" });
    await host.startSession({ sessionId: "child", cwd: f.root, sessionFile: f.sessionFile, leafId: null, tmux: locator });
    await host.agentStarted();
    await append(f.sessionFile, message("u1", null, "user", "Work"), message("a1", "u1", "assistant", "Persisted"));
    f.setAlive(false);
    await f.manager.list("parent");
    await host.leafChanged("u1", true);
    const result = await f.manager.read("parent", "child", { view: "recent_activity" });
    assert.equal(result.view, "recent_activity");
    assert.deepEqual(result.activity, []);
  } finally { await f.cleanup(); }
});

test("follows newly appended descendants of a pinned leaf without restoring abandoned history", async () => {
  const f = await fixture();
  try {
    await append(f.sessionFile, message("u1", null, "user", "Work"), message("a1", "u1", "assistant", "Abandoned"));
    const host = new SessionRuntimeHost({ store: f.store, parent: f.child.parent, launch: f.child.launch });
    await host.startSession({ sessionId: "child", cwd: f.root, sessionFile: f.sessionFile, leafId: "u1", leafPosition: 2, tmux: locator });
    const first = await f.manager.read("parent", "child", { view: "recent_activity" });
    assert.equal(first.view, "recent_activity");
    assert.deepEqual(first.activity, []);
    await append(f.sessionFile, message("a2", "u1", "assistant", "New branch"));
    const second = await f.manager.read("parent", "child", { view: "recent_activity", after: first.cursor });
    assert.equal(second.view, "recent_activity");
    assert.deepEqual(second.activity.map(item => item.id), ["a2"]);
    await host.startSession({ sessionId: "child", cwd: f.root, sessionFile: f.sessionFile, leafId: null, leafPosition: 3, tmux: locator });
    assert.equal((await f.store.load("child"))?.runtime.leafId, undefined);
    const reset = await f.manager.read("parent", "child", { view: "recent_activity" });
    assert.equal(reset.view, "recent_activity");
    assert.deepEqual(reset.activity, []);
  } finally { await f.cleanup(); }
});

test("retains persisted progress in every view after interruption", async () => {
  const f = await fixture();
  try {
    await append(f.sessionFile, message("u1", null, "user", "Work"), message("a1", "u1", "assistant", "Persisted"));
    await f.store.update("child", (state) => ({ ...state,
      runtime: { ...state.runtime, generation: 1, busy: true, leafId: "u1" } }));
    f.setAlive(false);
    await f.manager.list("parent");
    const recent = await f.manager.read("parent", "child", { view: "recent_activity" });
    assert.equal(recent.view, "recent_activity");
    assert.equal(recent.activity[0]?.id, "a1");
    const turns = await f.manager.read("parent", "child", { view: "turns" });
    assert.equal(turns.view, "turns");
    assert.equal(turns.turns[0]?.activity[0]?.id, "a1");
    const detail = await f.manager.read("parent", "child", { view: "activity_detail", activityId: "a1", section: "assistant_text" });
    assert.equal(detail.view, "activity_detail");
    assert.equal(detail.content, "Persisted");
  } finally { await f.cleanup(); }
});

test("keeps a registered spawn alive when list takes over before launch returns", async () => {
  const f = await fixture();
  try {
    await f.store.update("parent", (parent) => ({ ...parent, children: [], processes: {} }));
    await f.store.delete("child");
    f.runtime.launch = async (options) => {
      const parent = JSON.parse(options.environment.PI_SUBAGENT_PARENT);
      const launch = JSON.parse(options.environment.PI_SUBAGENT_LAUNCH);
      await f.store.save({ ...f.child, parent, launch,
        runtime: { ...f.child.runtime, processInstanceId: launch.processInstanceId } });
      const listing = await f.manager.list("parent");
      assert.equal(listing.capacity.active, 1);
      assert.equal(listing.capacity.pending, 0);
      assert.equal((await f.store.load("parent"))?.reservations.length, 0);
      await Promise.all([
        f.manager.list("parent"),
        assert.rejects(f.manager.spawn("parent", { task: "Parallel work" }, { cwd: f.root }), /Subagent capacity reached/u),
      ]);
      return locator;
    };
    f.runtime.sendPrompt = async (_locator, text) => {
      await append(f.sessionFile, message("initial", null, "user", text));
    };
    const spawned = await f.manager.spawn("parent", { task: "Initial work" }, { cwd: f.root });
    assert.equal(spawned.agentId, "child");
    assert.equal(f.getCloses(), 0);
    assert.equal((await f.store.load("parent"))?.children.length, 1);
  } finally { await f.cleanup(); }
});

test.each(["process", "locator"])("rejects a registered spawn with mismatched runtime %s identity", async (mismatch) => {
  const f = await fixture();
  try {
    await f.store.update("parent", (state) => ({ ...state, children: [], processes: {} }));
    await f.store.delete("child");
    f.runtime.launch = async (options) => {
      const parent = JSON.parse(options.environment.PI_SUBAGENT_PARENT);
      const launch = JSON.parse(options.environment.PI_SUBAGENT_LAUNCH);
      await f.store.save({ ...f.child, parent, launch, runtime: { ...f.child.runtime,
        processInstanceId: mismatch === "process" ? "unrelated" : launch.processInstanceId,
        tmux: mismatch === "locator" ? { ...locator, panePid: 5678 } : locator,
      } });
      await f.manager.list("parent");
      return locator;
    };
    f.runtime.sendPrompt = async (_locator, text) => {
      await append(f.sessionFile, message("u", null, "user", text));
    };
    await assert.rejects(f.manager.spawn("parent", { task: "Work" }, { cwd: f.root }), /Spawn reservation is no longer active|Timed out waiting for child runtime registration/u);
    assert.equal(f.getCloses(), 1);
  } finally { await f.cleanup(); }
});

test("does not let an interruption timestamp make a historical alias kill its live sibling", async () => {
  const f = await fixture();
  try {
    const sibling = { ...f.child, sessionId: "sibling", epoch: "sibling-epoch" };
    await f.store.save(sibling);
    await f.store.update("parent", (state) => registerDirectChild(state, sibling, now));
    await f.store.update("child", (state) => ({ ...state,
      runtime: { ...state.runtime, status: "interrupted", updatedAt: "2026-09-10T00:00:00.000Z" } }));
    await f.manager.close("parent", "child");
    assert.equal(f.getCloses(), 0);
    assert.ok(await f.store.load("sibling"));
  } finally { await f.cleanup(); }
});

test("retains the recovered single target and its slot when closing fails", async () => {
  const f = await fixture();
  try {
    f.setAlive(false);
    await f.manager.list("parent");
    f.setAlive(true);
    f.runtime.close = async () => { throw new Error("Fixture close failure"); };
    await assert.rejects(f.manager.close("parent", "child"), /Fixture close failure/u);
    assert.equal((await f.store.load("child"))?.runtime.status, "closing");
    assert.equal((await f.store.load("parent"))?.children.length, 1);
    assert.equal((await f.manager.list("parent")).capacity.active, 1);
    await assert.rejects(f.manager.spawn("parent", { task: "Extra work" }, { cwd: f.root }), /capacity reached/u);
  } finally { await f.cleanup(); }
});

test("closes a recovered single target after transient locator loss", async () => {
  const f = await fixture();
  try {
    f.setAlive(false);
    await f.manager.list("parent");
    assert.equal((await f.store.load("child"))?.runtime.status, "interrupted");
    f.setAlive(true);
    await f.manager.close("parent", "child");
    assert.equal(f.getCloses(), 1);
    assert.equal(await f.store.load("child"), undefined);
  } finally { await f.cleanup(); }
});
