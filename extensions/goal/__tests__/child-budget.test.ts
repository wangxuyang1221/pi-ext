import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { GoalStore } from "../src/storage.js";

it.each(["pause", "blocked", "usage_limited", "complete"] as const)("freezes child charges after %s while advancing the resume baseline", async action => {
  const root = await mkdtemp(resolve(".goal-test-"));
  const store = new GoalStore(root);
  const lease = await store.openSession({ ownerSessionId: "root", cwd: process.cwd(), sessionFile: resolve(root, "session.jsonl") });
  try {
    await lease.replace("Freeze", lease.snapshot, 1000);
    await lease.subscribeChild(lease.snapshot, { sourceId: "child", reportPath: resolve(root, "child.json"), tokens: 0, missing: false });
    await lease.accountChild(lease.snapshot, { sourceId: "child", tokens: 10, missing: false });
    await lease.control(action, lease.snapshot);
    const stopped = lease.snapshot.goal!;
    await lease.accountChild(lease.snapshot, { sourceId: "child", tokens: 50, missing: true });
    expect(lease.snapshot.goal).toMatchObject({ tokensUsed: 10, elapsedSeconds: stopped.elapsedSeconds, updatedAt: stopped.updatedAt });
    expect(lease.snapshot.goal!.usageIncomplete).toBeUndefined();
    expect(lease.snapshot.goal!.childUsage![0]!.tokens).toBe(50);
    await lease.control("resume", lease.snapshot);
    await lease.accountChild(lease.snapshot, { sourceId: "child", tokens: 60, missing: true });
    expect(lease.snapshot.goal!.tokensUsed).toBe(20);
    expect(lease.snapshot.goal!.usageIncomplete).toBe(true);
  } finally { await lease.close(); await rm(root, { recursive: true, force: true }); }
});
it("keeps independent child checkpoints across root usage, replay, and reopen", async () => {
  const root = await mkdtemp(resolve(".goal-test-"));
  const store = new GoalStore(root);
  const lease = await store.openSession({ ownerSessionId: "root", cwd: process.cwd(), sessionFile: resolve(root, "session.jsonl") });
  try {
    await lease.replace("Direct children", lease.snapshot, 100);
    lease.setBudgetInFlight(true);
    await expect(lease.subscribeChild(lease.snapshot, { sourceId: "bad", reportPath: "relative.json", tokens: 0, missing: false })).rejects.toThrow(/child usage/i);
    await lease.subscribeChild(lease.snapshot, { sourceId: "child-a", reportPath: resolve(root, "a.json"), tokens: 0, missing: false });
    await lease.subscribeChild(lease.snapshot, { sourceId: "child-b", reportPath: resolve(root, "b.json"), tokens: 0, missing: false });
    const concurrent = lease.snapshot;
    await Promise.all([
      lease.accountChild(concurrent, { sourceId: "child-a", tokens: 40, missing: false }),
      lease.account(concurrent, { sourceId: "root", tokens: 30, missing: false }),
      lease.checkpoint(concurrent),
    ]);
    await lease.accountChild(lease.snapshot, { sourceId: "child-b", tokens: 30, missing: false });
    await lease.accountChild(lease.snapshot, { sourceId: "child-a", tokens: 50, missing: false });
    await lease.accountChild(lease.snapshot, { sourceId: "child-b", tokens: 30, missing: false });
    expect(lease.snapshot.goal).toMatchObject({ tokensUsed: 110, status: "budget_limited" });
    const fork = await store.openSession({ ownerSessionId: "fork", cwd: process.cwd(), sessionFile: resolve(root, "fork.jsonl") });
    try {
      await fork.inherit(lease.snapshot);
      expect(fork.snapshot.goal!.tokensUsed).toBe(110);
      expect(fork.snapshot.goal!.childUsage).toBeUndefined();
    } finally { await fork.close(); }
    await lease.close();
    const reopened = await store.openSession(lease.snapshot);
    try {
      await reopened.accountChild(reopened.snapshot, { sourceId: "child-a", tokens: 50, missing: false });
      expect(reopened.snapshot.goal!.tokensUsed).toBe(110);
      await reopened.control("complete", reopened.snapshot);
      await reopened.accountChild(reopened.snapshot, { sourceId: "child-a", tokens: 60, missing: false });
      expect(reopened.snapshot.goal).toMatchObject({ tokensUsed: 110, status: "complete" });
      const old = reopened.snapshot;
      await reopened.replace("Replacement", reopened.snapshot);
      await expect(reopened.accountChild(old, { sourceId: "child-a", tokens: 100, missing: false })).rejects.toThrow(/Stale/);
      await expect(reopened.accountChild(reopened.snapshot, { sourceId: "child-a", tokens: 100, missing: false })).rejects.toThrow(/Unregistered/);
      expect(reopened.snapshot.goal!.tokensUsed).toBe(0);
    } finally { await reopened.close(); }
  } finally { await lease.close(); await rm(root, { recursive: true, force: true }); }
});
