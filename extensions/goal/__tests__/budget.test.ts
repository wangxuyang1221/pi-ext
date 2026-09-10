import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { GoalStore } from "../src/storage.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function openStore(now?: () => number) {
  const root = await mkdtemp(resolve(".goal-test-")); roots.push(root);
  const store = new GoalStore(root, now);
  const lease = await store.openSession({ ownerSessionId: "budget", cwd: process.cwd(), sessionFile: resolve(root, "session.jsonl") });
  return { store, lease };
}
import { resolveGoalBudget } from "../src/budget.js";

it("commits cumulative usage checkpoints once and retains actual overshoot after recovery", async () => {
  const { store, lease } = await openStore();
  try {
    await lease.replace("Budget fixture", lease.snapshot, 100);
    await lease.account(lease.snapshot, { sourceId: "run", tokens: 100, missing: false });
    expect(lease.snapshot.goal).toMatchObject({ tokensUsed: 100, status: "budget_limited" });
    await lease.account(lease.snapshot, { sourceId: "run", tokens: 110, missing: false });
    await lease.account(lease.snapshot, { sourceId: "run", tokens: 110, missing: false });
    expect(lease.snapshot.goal!.tokensUsed).toBe(110);
    await lease.close();
    const reopened = await store.openSession(lease.snapshot);
    try {
      await reopened.account(reopened.snapshot, { sourceId: "run", tokens: 110, missing: false });
      await reopened.control("edit", reopened.snapshot, "Edited");
      await reopened.control("resume", reopened.snapshot);
      expect(reopened.snapshot.goal).toMatchObject({ tokensUsed: 110, status: "budget_limited", tokenBudget: 100 });
    } finally { await reopened.close(); }
  } finally { await lease.close(); }
});

it("checkpoints monotonic active time without counting paused or offline intervals", async () => {
  let now = 5000;
  const { store, lease } = await openStore(() => now);
  await lease.replace("Clock", lease.snapshot);
  now += 2500;
  await lease.checkpoint(lease.snapshot);
  expect(lease.snapshot.goal!.elapsedSeconds).toBe(2);
  now += 600;
  await lease.control("pause", lease.snapshot);
  expect(lease.snapshot.goal!.elapsedSeconds).toBe(3);
  now += 100000;
  await lease.control("resume", lease.snapshot);
  now += 1000;
  await lease.checkpoint(lease.snapshot);
  expect(lease.snapshot.goal!.elapsedSeconds).toBe(4);
  await lease.close();
  now += 86400000;
  const reopened = await store.openSession(lease.snapshot);
  try {
    await reopened.checkpoint(reopened.snapshot);
    expect(reopened.snapshot.goal!.elapsedSeconds).toBe(4);
    now += 2000;
    await reopened.checkpoint(reopened.snapshot);
    expect(reopened.snapshot.goal!.elapsedSeconds).toBe(6);
  } finally { await reopened.close(); }
});

it("counts in-flight wrap time but not idle exhausted time or an old goal baseline", async () => {
  let now = 0;
  const { lease } = await openStore(() => now);
  try {
    await lease.replace("Old", lease.snapshot, 100);
    now = 2000;
    lease.setBudgetInFlight(true);
    await lease.account(lease.snapshot, { sourceId: "old", tokens: 100, missing: false });
    now = 5000;
    await lease.checkpoint(lease.snapshot);
    expect(lease.snapshot.goal!.elapsedSeconds).toBe(5);
    lease.setBudgetInFlight(false);
    now = 60000;
    await lease.checkpoint(lease.snapshot);
    expect(lease.snapshot.goal!.elapsedSeconds).toBe(5);
    await lease.replace("New", lease.snapshot, 100);
    expect(lease.snapshot.goal).toMatchObject({ tokensUsed: 0, elapsedSeconds: 0 });
    now += 2000;
    await lease.checkpoint(lease.snapshot);
    expect(lease.snapshot.goal!.elapsedSeconds).toBe(2);
  } finally { await lease.close(); }
});

describe("goal budget configuration", () => {
  it("defaults to the configured maximum without parsing objective flags", () => {
    expect(resolveGoalBudget(undefined, {})).toBeUndefined();
    expect(resolveGoalBudget(undefined, { maxGoalTokenBudget: 100 })).toBe(100);
    expect(resolveGoalBudget(80, { maxGoalTokenBudget: 100 })).toBe(80);
    expect(() => resolveGoalBudget(101, { maxGoalTokenBudget: 100 })).toThrow(/maximum/);
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100", null]) {
      expect(() => resolveGoalBudget(undefined, { maxGoalTokenBudget: value })).toThrow(/positive safe integer/);
    }
  });
});
