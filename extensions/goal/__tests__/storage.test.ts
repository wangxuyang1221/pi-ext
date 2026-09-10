import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { GoalStore } from "../src/storage.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function store() {
  const root = await mkdtemp(resolve(".goal-test-"));
  roots.push(root);
  return new GoalStore(root);
}

it("persists tool recovery independently of status, attribution and inheritance deferral", async () => {
  const disk = await store();
  const lease = await disk.openSession({ ownerSessionId: "source", cwd: process.cwd(), sessionFile: "/source.jsonl" });
  const original = await lease.replace("Keep attribution", lease.snapshot, 100);
  const gated = await lease.requireToolRecovery(original);
  expect(gated.goal).toEqual({ ...original.goal, toolRecoveryRequired: true });
  const billed = await lease.account(original, { sourceId: "in-flight", tokens: 110, missing: false });
  expect(billed.goal).toMatchObject({ tokensUsed: 110, status: "budget_limited", toolRecoveryRequired: true });
  await lease.close();
  const reopened = await disk.openSession(original);
  expect(reopened.snapshot).toEqual(billed);
  const child = await disk.openSession({ ownerSessionId: "child", cwd: process.cwd(), sessionFile: "/child.jsonl" });
  const inherited = await child.inherit(billed);
  const released = await child.releaseDeferral(inherited);
  expect(released.goal!.toolRecoveryRequired).toBe(true);
  await child.close();
  const resumed = await reopened.control("resume", reopened.snapshot);
  expect(resumed.goal).toMatchObject({ tokensUsed: 110, tokenBudget: 100, status: "budget_limited" });
  expect(resumed.goal!.toolRecoveryRequired).toBeUndefined();
  const replaced = await reopened.replace("Independent new goal", resumed);
  expect(replaced.goal!.toolRecoveryRequired).toBeUndefined();
  await expect(reopened.requireToolRecovery(billed)).rejects.toThrow(/stale/i);
  const freshGate = await reopened.requireToolRecovery(replaced);
  const cleared = await reopened.clear(freshGate);
  expect(cleared.goal).toBeNull();
  await reopened.close();
});

it("accepts pre-gate records and rejects malformed tool recovery flags", async () => {
  const disk = await store();
  const lease = await disk.openSession({ ownerSessionId: "legacy", cwd: process.cwd(), sessionFile: "/legacy.jsonl" });
  const saved = await lease.replace("Legacy goal", lease.snapshot);
  await lease.close();
  expect(await disk.read(saved.recordId)).toEqual(saved);
  await writeFile(resolve(disk.root, `${saved.recordId}.json`), JSON.stringify({ ...saved, goal: { ...saved.goal, toolRecoveryRequired: "true" } }));
  await expect(disk.read(saved.recordId)).rejects.toThrow(/tool recovery gate/);
});

it("checkpoints and inherits a complete snapshot into an independent deferred record", async () => {
  const disk = await store();
  const source = await disk.openSession({ ownerSessionId: "source", cwd: process.cwd(), sessionFile: "/source.jsonl" });
  const saved = await source.replace("Full objective", source.snapshot);
  saved.goal = { ...saved.goal!, tokenBudget: 1000, tokensUsed: 450, elapsedSeconds: 32.5, status: "blocked" };
  await disk.commit(saved);
  const checkpoint = await source.checkpoint(saved);
  expect(checkpoint).toEqual(saved);
  const target = await disk.openSession({ ownerSessionId: "clone", cwd: process.cwd(), sessionFile: "/clone.jsonl" });
  const inherited = await target.inherit(checkpoint);
  expect(inherited.goal).toEqual(saved.goal);
  expect(inherited.generation).toBe(saved.generation);
  expect(inherited.recordId).not.toBe(saved.recordId);
  expect(inherited.revision).toBe(1);
  expect(inherited.continuationDeferral).toBe(true);
  expect(await disk.read(saved.recordId)).toEqual(saved);
  await target.close();
  const reopened = await disk.openSession(inherited);
  expect(reopened.snapshot).toEqual(inherited);
  await expect(reopened.inherit(checkpoint)).rejects.toThrow(/new|empty/i);
  await reopened.close();
  await source.close();
});

it.each(["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"] as const)("releases the durable launch gate without changing %s", async status => {
  const disk = await store();
  const source = await disk.openSession({ ownerSessionId: "source", cwd: process.cwd(), sessionFile: "/source.jsonl" });
  const saved = await source.replace("Keep state", source.snapshot);
  saved.goal!.status = status;
  const child = await disk.openSession({ ownerSessionId: "child", cwd: process.cwd(), sessionFile: "/child.jsonl" });
  const inherited = await child.inherit(saved);
  const released = await child.releaseDeferral(inherited);
  expect(released.goal).toEqual(inherited.goal);
  expect(released.continuationDeferral).toBe(false);
  expect((await disk.read(released.recordId))?.continuationDeferral).toBe(false);
  await child.close();
  await source.close();
});

it("rechecks session validity at authoritative replacement after asynchronous file writes", async () => {
  const disk = await store();
  let live = true;
  const lease = await disk.openSession({ ownerSessionId: "invalidated", cwd: process.cwd(), sessionFile: "/invalidated.jsonl" }, () => {
    if (!live) throw new Error("Stale session");
  });
  disk.beforeRename = () => { live = false; };
  await expect(lease.replace("Do not commit after invalidation", lease.snapshot)).rejects.toThrow(/stale/i);
  expect(await disk.records()).toEqual([]);
  expect((await readdir(disk.root)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  await lease.close();
});

it("rejects newly submitted writes once close begins", async () => {
  const disk = await store();
  const lease = await disk.openSession({ ownerSessionId: "closing", cwd: process.cwd(), sessionFile: "/closing.jsonl" });
  const saved = await lease.replace("Saved", lease.snapshot);
  const checkpoint = lease.checkpoint(saved);
  const closing = lease.close();
  await expect(lease.clear(saved)).rejects.toThrow(/closed/i);
  await checkpoint;
  await closing;
  expect(await disk.read(saved.recordId)).toEqual(saved);
});

it("does not reconstruct a deleted authority from an in-memory snapshot", async () => {
  const disk = await store();
  const lease = await disk.openSession({ ownerSessionId: "deleted", cwd: process.cwd(), sessionFile: "/deleted.jsonl" });
  const saved = await lease.replace("Do not resurrect", lease.snapshot);
  await rm(resolve(disk.root, `${saved.recordId}.json`));
  await expect(lease.clear(saved)).rejects.toThrow(/missing/i);
  await lease.close();
});

it("keeps the committed snapshot on a failed write and rejects corrupt records", async () => {
  const disk = await store();
  const lease = await disk.openSession({ ownerSessionId: "a", cwd: process.cwd(), sessionFile: "/a.jsonl" });
  const saved = await lease.replace("Saved", lease.snapshot);
  disk.beforeRename = () => { throw new Error("Injected write failure"); };
  await expect(lease.replace("Not saved", saved)).rejects.toThrow("Injected write failure");
  expect(lease.snapshot).toEqual(saved);
  expect(await disk.read(saved.recordId)).toEqual(saved);
  expect((await readdir(disk.root)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  await lease.close();
  await writeFile(resolve(disk.root, `${saved.recordId}.json`), JSON.stringify({ ...saved, schemaVersion: 9 }));
  await expect(disk.read(saved.recordId)).rejects.toThrow(/unsupported|invalid/i);
  await writeFile(resolve(disk.root, `${saved.recordId}.json`), JSON.stringify({ ...saved, goal: { ...saved.goal, tokensUsed: -1 } }));
  await expect(disk.read(saved.recordId)).rejects.toThrow(/invalid/i);
});

it("takes over one orphan record with a fresh revision and rejects competing recovery", async () => {
  const disk = await store();
  const original = await disk.openSession({ ownerSessionId: "lost", cwd: process.cwd(), sessionFile: "/missing.jsonl" });
  const saved = await original.replace("Recover me", original.snapshot);
  await original.close();
  expect((await disk.recoverable(process.cwd())).map(row => row.recordId)).toEqual([saved.recordId]);
  const attempts = await Promise.allSettled(["new-a", "new-b"].map(ownerSessionId => disk.takeover(saved, { ownerSessionId, cwd: process.cwd(), sessionFile: `/${ownerSessionId}.jsonl` })));
  expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const winner = attempts.find(result => result.status === "fulfilled")!;
  if (winner.status !== "fulfilled") throw new Error("No recovery winner");
  expect(winner.value.snapshot.recordId).toBe(saved.recordId);
  expect(winner.value.snapshot.goal).toEqual(saved.goal);
  expect(winner.value.snapshot.revision).toBe(2);
  const newOwner = winner.value.snapshot;
  await winner.value.close();
  const reopened = await disk.openSession(newOwner);
  expect(reopened.snapshot.recordId).toBe(saved.recordId);
  await reopened.close();
  await expect(disk.takeover(saved, { ownerSessionId: "late", cwd: process.cwd(), sessionFile: "/late.jsonl" })).rejects.toThrow(/stale/i);
});

it("rejects a second writer and stale mutations, and persists a clear tombstone", async () => {
  const disk = await store();
  const owner = { ownerSessionId: "session-a", cwd: process.cwd(), sessionFile: "/not-created.jsonl" };
  const lease = await disk.openSession(owner);
  await expect(new GoalStore(disk.root).openSession(owner)).rejects.toThrow(/writer/i);
  const old = lease.snapshot;
  await lease.replace("First", old);
  await expect(lease.replace("Stale", old)).rejects.toThrow(/stale/i);
  const first = lease.snapshot;
  await lease.replace("Second", first);
  await expect(lease.clear(first)).rejects.toThrow(/stale/i);
  await lease.clear(lease.snapshot);
  await lease.close();
  const restored = await disk.openSession(owner);
  expect(restored.snapshot.goal).toBeNull();
  expect(restored.snapshot.revision).toBe(3);
  await restored.close();
});

it("commits a goal before a session file exists and rereads it after restart", async () => {
  const disk = await store();
  const lease = await disk.openSession({ ownerSessionId: "session-a", cwd: process.cwd(), sessionFile: "/not-created.jsonl" });
  const saved = await lease.replace("Ship the change", lease.snapshot);
  expect(saved.goal?.objective).toBe("Ship the change");
  expect(saved.revision).toBe(1);
  await lease.close();
  const reopened = await new GoalStore(disk.root).openSession({ ownerSessionId: "session-a", cwd: process.cwd(), sessionFile: "/not-created.jsonl" });
  expect(reopened.snapshot).toEqual(saved);
  await reopened.close();
});
