import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GoalStore, type GoalLease } from "../src/storage.js";
const roots: string[] = [];
const leases: GoalLease[] = [];
afterEach(async () => {
  await Promise.all(leases.splice(0).map(lease => lease.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function setup() {
  let now = 0;
  const root = await mkdtemp(resolve(".goal-timing-")); roots.push(root);
  const store = new GoalStore(root, () => now);
  const lease = await store.openSession({ ownerSessionId: "timing", cwd: process.cwd(), sessionFile: "/timing" }); leases.push(lease);
  await lease.replace("Display time", lease.snapshot, 100);
  return { store, lease, advance: (ms: number) => { now += ms; } };
}
it("does not display time past a pending pause checkpoint", async () => {
  const { store, lease, advance } = await setup();
  advance(59_900);
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = store.commit.bind(store);
  vi.spyOn(store, "commit").mockImplementationOnce(async (...args) => { enter(); await gate; await original(...args); });
  const pause = lease.control("pause", lease.snapshot);
  await entered;
  try {
    advance(2000);
    expect(lease.displayTiming).toEqual({ elapsedSeconds: 59 });
  } finally { release(); await pause; }
  expect(lease.displayTiming).toEqual({ elapsedSeconds: 59 });
});

it("notifies display observers after checkpoints and budget timing changes", async () => {
  const { lease, advance } = await setup();
  const changed = vi.fn();
  lease.onDisplayChange = changed;
  advance(1000);
  await lease.checkpoint(lease.snapshot);
  expect(changed).toHaveBeenCalledTimes(1);
  lease.setBudgetInFlight(true);
  expect(changed).toHaveBeenCalledTimes(2);
  await lease.account(lease.snapshot, { sourceId: "root", tokens: 100, missing: false });
  advance(2000);
  expect(lease.displayTiming!.elapsedSeconds).toBe(3);
  await lease.checkpoint(lease.snapshot);
  lease.setBudgetInFlight(false);
  advance(10000);
  expect(lease.displayTiming).toEqual({ elapsedSeconds: 3 });
});

it("projects whole seconds without storage reads, writes or changing saved usage", async () => {
  const { store, lease, advance } = await setup();
  const read = vi.spyOn(store, "read"); const commit = vi.spyOn(store, "commit");
  advance(59_900);
  expect(lease.displayTiming).toEqual({ elapsedSeconds: 59, nextUpdateMs: 100 });
  expect(lease.snapshot.goal!.elapsedSeconds).toBe(0);
  expect(read).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  await lease.checkpoint(lease.snapshot);
  expect(lease.displayTiming).toEqual({ elapsedSeconds: 59, nextUpdateMs: 100 });
  advance(100);
  expect(lease.displayTiming).toEqual({ elapsedSeconds: 60, nextUpdateMs: 60_000 });
  await lease.control("pause", lease.snapshot);
  advance(60_000);
  expect(lease.displayTiming).toEqual({ elapsedSeconds: 60 });
  await lease.control("resume", lease.snapshot);
  advance(1000);
  expect(lease.displayTiming!.elapsedSeconds).toBe(61);
});
