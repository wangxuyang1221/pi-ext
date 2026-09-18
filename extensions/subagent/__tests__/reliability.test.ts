import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { createSessionState, SessionStateStore } from "../src/state-store.js";
import { registerDirectChild } from "../src/ownership.js";
import { encodeSettledCursor } from "../src/cursor.js";
import { SubagentManager, type ManagedTmuxRuntime } from "../src/manager.js";

async function fixture(closeTimeoutMs = 1000) {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reliability-"));
  const store = new SessionStateStore(root);
  let alive = true;
  const runtime: ManagedTmuxRuntime = {
    async launch() { throw new Error("Unexpected launch"); },
    async sendPrompt() {}, async capturePane() { return ""; },
    async isAlive() { return alive; }, async close() { alive = false; },
  };
  const child = createSessionState({
    sessionId: "child", epoch: "child-e", cwd: root, sessionFile: join(root, "child.jsonl"), now: "now",
    parent: { sessionId: "root", epoch: "root-e", registrationToken: "reg" },
    launch: { processInstanceId: "process", cwd: root, sessionDir: root, displayName: "Child" },
    processInstanceId: "process", tmux: { sessionName: "test", windowId: "@1", paneId: "%1", panePid: 1234 },
  });
  await store.save(registerDirectChild(createSessionState({ sessionId: "root", epoch: "root-e", cwd: root, sessionFile: join(root, "root.jsonl"), now: "now" }), child, "now"));
  await store.save(child);
  const manager = new SubagentManager({ store, runtime, stateRoot: root, nativeSessionRoot: root, extensionPath: "/extension.js", piPath: "pi", environment: {}, maxActive: 1, closeTimeoutMs });
  return { root, store, child, manager, runtime, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("cancelled delivery retains a durable identity instead of implying nonexecution", async () => {
  const f = await fixture();
  const controller = new AbortController();
  try {
    f.runtime.sendPrompt = async () => { controller.abort(new Error("Reply lost")); return new Promise<void>(() => {}); };
    let failure: any;
    try { await f.manager.prompt("root", "child", "Work", "follow_up", controller.signal); }
    catch (error) { failure = error; }
    assert.equal(failure?.code, "delivery_unconfirmed");
    assert.match(failure.deliveryId, /^[a-f0-9]{12}$/);
    const record = JSON.parse(await readFile(join(f.root, "deliveries", "root", "root-e", `${failure.deliveryId}.json`), "utf8"));
    assert.equal(record.processInstanceId, "process");
    assert.equal(record.phase, "prepared");
    assert.equal((await f.manager.list("root")).capacity.active, 1);
  } finally { await f.cleanup(); }
});

test("controller handoff cancels old I/O and fences old callbacks without changing namespace epoch", async () => {
  const f = await fixture();
  try {
    await f.manager.list("root");
    const oldGuard = await f.manager.controllerGuard("root");
    const oldEpoch = (await f.store.load("root"))!.control!.controllerEpoch;
    const isAlive = f.runtime.isAlive;
    let signal: AbortSignal | undefined;
    f.runtime.isAlive = async (_locator, options) => { signal = options?.signal; return new Promise<boolean>(() => {}); };
    const closing = f.manager.close("root", "child").catch((error: unknown) => error);
    const deadline = performance.now() + 1000;
    while (!signal && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(signal);
    await f.manager.releaseNamespace("root");
    assert.equal(signal.aborted, true);
    assert.ok(await closing instanceof Error);
    await assert.rejects(oldGuard(), /ownership changed/);
    f.runtime.isAlive = isAlive;
    const other = new SubagentManager({ store: new SessionStateStore(f.root), runtime: f.runtime,
      stateRoot: f.root, nativeSessionRoot: f.root, extensionPath: "/extension.js", piPath: "pi", environment: {} });
    await other.close("root", "child");
    const parent = await f.store.load("root");
    assert.equal(parent!.epoch, "root-e");
    assert.notEqual(parent!.control!.controllerEpoch, oldEpoch);
  } finally { await f.cleanup(); }
});

test("process capacity survives an empty session binding set", async () => {
  const f = await fixture();
  try {
    await f.store.update("root", (state) => ({ ...state, children: [] }));
    await rm(join(f.root, "bindings"), { recursive: true, force: true });
    const result = await f.manager.list("root");
    assert.equal(result.capacity.active, 1);
    await assert.rejects(f.manager.spawn("root", { task: "No extra process" }, { cwd: f.root }), /capacity reached/);
    await f.manager.close("root", "all");
    assert.equal((await f.manager.list("root")).capacity.active, 0);
  } finally { await f.cleanup(); }
});

test("failed namespace validation does not leak controller ownership after shutdown", async () => {
  const f = await fixture();
  try {
    const valid = await readFile(f.store.statePath("root"), "utf8");
    await writeFile(f.store.statePath("root"), "{broken");
    await assert.rejects(f.manager.claimNamespace("root"));
    await f.manager.releaseNamespace("root");
    await writeFile(f.store.statePath("root"), valid);
    const other = new SubagentManager({ store: new SessionStateStore(f.root), runtime: f.runtime,
      stateRoot: f.root, nativeSessionRoot: f.root, extensionPath: "/extension.js", piPath: "pi", environment: {} });
    assert.equal(await other.claimNamespace("root"), true);
    await other.releaseNamespace("root");
  } finally { await f.cleanup(); }
});

test("validation failure on an existing controller does not release its active ownership", async () => {
  const f = await fixture();
  try {
    await f.manager.claimNamespace("root");
    const guard = await f.manager.controllerGuard("root");
    const original = await readFile(f.store.statePath("root"), "utf8");
    await writeFile(f.store.statePath("root"), "{broken");
    await assert.rejects(f.manager.claimNamespace("root"));
    await guard();
    const other = new SubagentManager({ store: new SessionStateStore(f.root), runtime: f.runtime,
      stateRoot: f.root, nativeSessionRoot: f.root, extensionPath: "/extension.js", piPath: "pi", environment: {} });
    assert.equal(await other.claimNamespace("root", false), false);
    await writeFile(f.store.statePath("root"), original);
    assert.equal((await f.manager.list("root")).capacity.active, 1);
    await f.manager.releaseNamespace("root");
  } finally { await f.cleanup(); }
});

test("a second controller can inspect but cannot close another controller's namespace", async () => {
  const f = await fixture();
  try {
    await f.manager.list("root");
    const other = new SubagentManager({ store: new SessionStateStore(f.root), runtime: f.runtime,
      stateRoot: f.root, nativeSessionRoot: f.root, extensionPath: "/extension.js", piPath: "pi", environment: {} });
    assert.equal((await other.list("root")).capacity.active, 1);
    await assert.rejects(other.close("root", "child"), /control lock|controller/);
    assert.ok(await f.store.load("child"));
  } finally { await f.cleanup(); }
});

test("a corrupt owned binding remains a diagnosed capacity occupant", async () => {
  const f = await fixture();
  try {
    await writeFile(f.store.statePath("child"), "{broken");
    const result = await f.manager.list("root");
    assert.equal(result.capacity.active, 1);
    assert.equal(result.capacity.available, 0);
    assert.ok(result.diagnostics?.some((entry) => entry.agentId === "child"));
    await assert.rejects(f.manager.spawn("root", { task: "No oversell" }, { cwd: f.root }), /capacity reached/);
  } finally { await f.cleanup(); }
});

test("single-target close cannot remove a terminal binding with no runtime locator", async () => {
  const f = await fixture();
  try {
    await f.store.update("child", state => ({ ...state, runtime: { ...state.runtime, status: "closed", tmux: undefined } }));
    await f.store.update("root", state => ({ ...state, processes: { process: { registrationToken: "reg", phase: "active" } } }));
    await assert.rejects(f.manager.close("root", "child"), /locator.*unavailable/u);
    assert.ok(await f.store.load("child"));
    assert.equal((await f.manager.list("root")).capacity.available, 0);
  } finally { await f.cleanup(); }
});

test("unknown launch outcome retains its durable reservation", async () => {
  const f = await fixture();
  try {
    await f.manager.close("root", "child");
    f.runtime.launch = async () => { throw new Error("Server reply was lost after launch"); };
    await assert.rejects(f.manager.spawn("root", { task: "Start" }, { cwd: f.root }), /reply was lost/);
    assert.equal((await f.store.load("root"))?.reservations.length, 1);
    assert.equal((await f.manager.list("root")).capacity.available, 0);
    await assert.rejects(f.manager.close("root", "all"), /unknown|unavailable/);
  } finally { await f.cleanup(); }
});

test("close deadline bounds a hanging query and keeps the relationship", async () => {
  const f = await fixture(20);
  try {
    f.runtime.isAlive = async () => new Promise<boolean>(() => {});
    const outcome = f.manager.close("root", "child").then(() => "closed", () => "rejected");
    let timer: ReturnType<typeof setTimeout>;
    const result = await Promise.race([outcome, new Promise<string>((resolve) => { timer = setTimeout(() => resolve("hung"), 200); })]);
    clearTimeout(timer!);
    assert.equal(result, "rejected");
    assert.equal((await f.store.load("root"))?.children.length, 1);
  } finally { await f.cleanup(); }
});

test("manager wait cancellation reaches its in-flight runtime query without closing the child", async () => {
  const f = await fixture();
  let querySignal: AbortSignal | undefined;
  let closes = 0;
  try {
    f.runtime.isAlive = async (_locator, options) => { querySignal = options?.signal; return new Promise<boolean>(() => {}); };
    f.runtime.close = async () => { closes++; };
    const result = await f.manager.wait("root", "child", {
      afterSettled: encodeSettledCursor({ agentId: "child", epoch: "child-e", generation: 0 }), timeoutMs: 100,
    });
    assert.equal(result.outcome, "timeout");
    assert.equal(querySignal?.aborted, true);
    assert.equal(closes, 0);
  } finally { await f.cleanup(); }
});

test("unknown runtime identity retains capacity and reports a diagnostic", async () => {
  const f = await fixture();
  try {
    f.runtime.isAlive = async () => { throw new Error("identity mismatch"); };
    const result = await f.manager.list("root");
    assert.equal(result.capacity.active, 1);
    assert.match(JSON.stringify(result), /identity mismatch/);
    await assert.rejects(f.manager.spawn("root", { task: "No extra process" }, { cwd: f.root }), /capacity reached/);
    await assert.rejects(f.manager.close("root", "child"), /identity mismatch/);
    assert.ok(await f.store.load("child"));
  } finally { await f.cleanup(); }
});

test("session handoff retains its live process slot before the new binding exists", async () => {
  const f = await fixture();
  try {
    await f.store.update("child", (state) => ({ ...state, runtime: { ...state.runtime, status: "closed" } }));
    assert.equal((await f.manager.list("root")).capacity.active, 1);
    await assert.rejects(f.manager.spawn("root", { task: "No extra process" }, { cwd: f.root }), /capacity reached/);
  } finally { await f.cleanup(); }
});

test("unrelated corrupt state cannot block closing a healthy child", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "sessions", "unrelated"));
    await writeFile(f.store.statePath("unrelated"), "{broken");
    await f.manager.close("root", "child");
    assert.equal(await f.store.load("child"), undefined);
  } finally { await f.cleanup(); }
});
