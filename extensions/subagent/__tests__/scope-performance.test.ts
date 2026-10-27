import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { SessionStateStore, createSessionState } from "../src/state-store.js";
import { registerDirectChild } from "../src/ownership.js";
import { SubagentManager } from "../src/manager.js";
import { readSessionView } from "../src/session-reader.js";

test("ordinary listing reads the same owned records with 0, 100, and 10000 unrelated namespaces", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-scope-"));
  try {
    const store = new SessionStateStore(root);
    const child = createSessionState({ sessionId: "child", epoch: "ce", cwd: root, sessionFile: join(root, "child.jsonl"), now: "now",
      parent: { sessionId: "root", epoch: "re", registrationToken: "r" },
      launch: { processInstanceId: "p", cwd: root, sessionDir: root, displayName: "Child" },
      tmux: { sessionName: "test", paneId: "%1", windowId: "@1", panePid: 1234 } });
    await store.save(registerDirectChild(createSessionState({ sessionId: "root", epoch: "re", cwd: root, sessionFile: "/root.jsonl", now: "now" }), child, "now"));
    await store.save(child);
    let probes = 0;
    const manager = new SubagentManager({ store, stateRoot: root, nativeSessionRoot: root, piPath: "pi", extensionPath: "/extension.js", environment: {},
      runtime: { async capturePane() { throw new Error("Unexpected pane capture"); }, async launch() { throw new Error("unused"); }, async close() {}, async sendPrompt() {}, async isAlive() { probes++; return true; } } });
    await manager.list("root");
    const load = store.loadRuntime.bind(store);
    const reads: string[] = [];
    store.loadRuntime = async (id) => { reads.push(id); return load(id); };
    store.list = async () => { throw new Error("Global scan is forbidden"); };
    let created = 0;
    let baseline: string[] | undefined;
    for (const count of [0, 100, 10000]) {
      while (created < count) {
        const ids = Array.from({ length: Math.min(100, count - created) }, (_, index) => `unrelated-${created + index}`);
        await Promise.all(ids.map(async (id) => { await mkdir(join(root, "sessions", id)); await writeFile(store.statePath(id), "{broken"); }));
        created += ids.length;
      }
      reads.length = 0; probes = 0;
      assert.equal((await manager.list("root")).capacity.active, 1);
      assert.equal(probes, 1);
      assert.ok(reads.every((id) => id === "root" || id === "child"));
      baseline ??= [...reads].sort();
      assert.deepEqual([...reads].sort(), baseline);
    }
    await manager.releaseNamespace("root");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);

test.each([true, false])("listing shared aliases probes once and reuses the parent snapshot with alive=%s", async (alive) => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-scope-"));
  try {
    const store = new SessionStateStore(root);
    let parent = createSessionState({ sessionId: "root", epoch: "re", cwd: root, sessionFile: "/root.jsonl", now: "now" });
    for (let i = 0; i < 20; i++) {
      const child = createSessionState({ sessionId: `alias-${i}`, epoch: `e-${i}`, cwd: root, sessionFile: `/child-${i}.jsonl`, now: "now",
        parent: { sessionId: "root", epoch: "re", registrationToken: "r" },
        launch: { processInstanceId: "p", cwd: root, sessionDir: root, displayName: "Child" },
        tmux: { sessionName: "test", paneId: "%1", windowId: "@1", panePid: 1234 } });
      await store.save(child);
      parent = registerDirectChild(parent, child, "now");
    }
    await store.save(parent);
    let probes = 0;
    const manager = new SubagentManager({ store, stateRoot: root, nativeSessionRoot: root, piPath: "pi", extensionPath: "/extension.js", environment: {},
      runtime: { async capturePane() { throw new Error("Unexpected pane capture"); }, async launch() { throw new Error("unused"); }, async close() {}, async sendPrompt() {}, async isAlive() { probes++; return alive; } } });
    await manager.claimNamespace("root");
    const load = store.loadRuntime.bind(store);
    let parentReads = 0;
    store.loadRuntime = async (id) => { if (id === "root") parentReads++; return load(id); };
    const result = await manager.list("root");
    assert.equal(result.capacity.active, alive ? 1 : 0);
    assert.equal(probes, 1);
    assert.ok(parentReads <= 15, `Parent snapshot was read ${parentReads} times for one list`);
    if (!alive) assert.equal(Object.keys((await store.loadRuntime("root"))!.control!.children).length, 20);
    await manager.releaseNamespace("root");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("long JSONL reads yield to cancellation without truncating a successful view", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-cancel-"));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const file = join(root, "session.jsonl");
    const header = JSON.stringify({ type: "session", version: 3, id: "child" }) + "\n";
    const lines = Array.from({ length: 100000 }, (_, index) => JSON.stringify({ type: "message", id: `m-${index}`, parentId: index ? `m-${index - 1}` : null,
      timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "x".repeat(100) }] } }));
    await writeFile(file, header + lines.join("\n") + "\n");
    const started = performance.now();
    timer = setTimeout(() => controller.abort(new Error("Cancelled long read")), 5);
    await assert.rejects(readSessionView({ sessionFile: file, agentId: "child", epoch: "e", view: "recent_activity", signal: controller.signal }), /abort|Cancelled/i);
    assert.ok(performance.now() - started < 1000);
  } finally { clearTimeout(timer); await rm(root, { recursive: true, force: true }); }
});
