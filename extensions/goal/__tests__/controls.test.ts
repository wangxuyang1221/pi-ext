import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { GoalStore } from "../src/storage.js";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(resolve(".goal-control-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = new GoalStore(resolve(root, "goals"));
  const lease = await store.openSession({ ownerSessionId: "test", cwd: root, sessionFile: resolve(root, "session.jsonl") });
  cleanup.push(() => lease.close());
  await lease.replace("Original", lease.snapshot);
  return { store, lease };
}
it("persists a loop pause reason atomically and clears it on explicit resume", async () => {
  const { store, lease } = await fixture();
  const before = lease.snapshot;
  const paused = await lease.pauseForLoop(before);
  expect(paused.goal).toMatchObject({ status: "paused", pauseReason: "repeated_tool_calls", goalId: before.goal!.goalId, tokensUsed: before.goal!.tokensUsed });
  expect((await store.read(paused.recordId))!.goal!.pauseReason).toBe("repeated_tool_calls");
  const resumed = await lease.control("resume", paused);
  expect(resumed.goal!.status).toBe("active");
  expect(resumed.goal!.pauseReason).toBeUndefined();
  await lease.control("complete", resumed);
  await expect(lease.pauseForLoop(lease.snapshot)).rejects.toThrow(/active/i);
});
it.each(["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"] as const)("edits %s preserving usage and applying the upstream activation rule", async status => {
  const { store, lease } = await fixture();
  const before = lease.snapshot;
  before.goal!.status = status;
  before.goal!.tokensUsed = 8;
  before.goal!.tokenBudget = 10;
  await store.commit(before);
  const saved = await lease.control("edit", before, "Revised");
  expect(saved.goal).toMatchObject({ objective: "Revised", tokensUsed: 8, tokenBudget: 10, goalId: before.goal!.goalId,
    status: ["complete", "budget_limited"].includes(status) ? "active" : status });
  await expect(lease.control("pause", before)).rejects.toThrow(/stale/i);
});
it("preserves budget-limited status when paused", async () => {
  const { lease, store } = await fixture();
  await lease.replace("Budget", lease.snapshot, 10);
  await lease.account(lease.snapshot, { sourceId: "run", tokens: 10, missing: false });
  const before = lease.snapshot;
  const saved = await lease.control("pause", before);
  expect(saved.goal).toMatchObject({ status: "budget_limited", goalId: before.goal!.goalId, tokensUsed: 10, tokenBudget: 10 });
  expect(await store.read(saved.recordId)).toEqual(saved);
});
it("keeps an exhausted saved budget stopped on resume or edit", async () => {
  const { store, lease } = await fixture();
  const before = lease.snapshot;
  before.goal!.tokenBudget = 10;
  before.goal!.tokensUsed = 12;
  await store.commit(before);
  const resumed = await lease.control("resume", before);
  expect(resumed.goal!.status).toBe("budget_limited");
  const edited = await lease.control("edit", resumed, "Revised");
  expect(edited.goal!.status).toBe("budget_limited");
  expect(edited.goal!.tokensUsed).toBe(12);
});
it("pauses without resetting counters, and rejects control after clear", async () => {
  const { lease } = await fixture();
  const paused = await lease.control("pause", lease.snapshot);
  expect(paused.goal!.status).toBe("paused");
  const cleared = await lease.clear(paused);
  await expect(lease.control("resume", cleared)).rejects.toThrow(/no goal/i);
});
it("resumes and releases inherited gating in one authoritative commit without resetting statistics", async () => {
  const { store, lease } = await fixture();
  const before = lease.snapshot;
  before.goal!.status = "blocked";
  before.goal!.tokensUsed = 40;
  before.goal!.tokenBudget = 100;
  before.goal!.elapsedSeconds = 12;
  before.continuationDeferral = true;
  await store.commit(before);
  const saved = await lease.control("resume", before);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.continuationDeferral).toBe(false);
  expect(saved.goal).toMatchObject({ goalId: before.goal!.goalId, status: "active", tokensUsed: 40, tokenBudget: 100, elapsedSeconds: 12 });
  expect(await store.read(saved.recordId)).toEqual(saved);
});
