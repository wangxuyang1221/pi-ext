import { afterEach, expect, it, vi } from "vitest";
import * as actualFs from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

let failingDirectory: string | undefined;
let failure: "open" | "sync" | "close" = "sync";
vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === failingDirectory && args[1] === "r" && failure === "open") throw Object.assign(new Error("Injected directory open failure"), { code: "EIO" });
    const handle = await fs.open(...args);
    if (String(args[0]) !== failingDirectory || args[1] !== "r") return handle;
    return new Proxy(handle, { get(target, property) {
      if (property === "sync" && failure === "sync") return async () => { throw Object.assign(new Error("Injected directory sync failure"), { code: "EIO" }); };
      if (property === "close" && failure === "close") return async () => { await target.close(); throw Object.assign(new Error("Injected directory close failure"), { code: "EIO" }); };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
});
import { GoalCommitPublishedError, GoalStore } from "../src/storage.js";

const roots: string[] = [];
afterEach(async () => {
  failingDirectory = undefined;
  failure = "sync";
  for (const root of roots.splice(0)) await actualFs.rm(root, { recursive: true, force: true });
});

it.each(["open", "sync", "close"] as const)("adopts a published checkpoint after directory %s fails without double counting time", async stage => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `storage-${randomUUID()}`);
  roots.push(root);
  let now = 0;
  const disk = new GoalStore(root, () => now);
  const lease = await disk.openSession({ ownerSessionId: "published", cwd: process.cwd(), sessionFile: join(root, "session.jsonl") });
  await lease.replace("Track elapsed time", lease.snapshot);
  now = 10_000;
  failingDirectory = root;
  failure = stage;
  const commitCalls = vi.spyOn(disk, "commit");
  const readCalls = vi.spyOn(disk, "read");
  await expect(lease.checkpoint(lease.snapshot)).rejects.toBeInstanceOf(GoalCommitPublishedError);
  failingDirectory = undefined;
  expect(commitCalls).toHaveBeenCalledTimes(1);
  expect(readCalls).toHaveBeenCalledTimes(1);
  commitCalls.mockRestore();
  readCalls.mockRestore();
  expect(lease.snapshot.goal?.elapsedSeconds).toBe(10);
  expect((await disk.read(lease.snapshot.recordId))?.revision).toBe(lease.snapshot.revision);
  now = 11_000;
  const saved = await lease.checkpoint(lease.snapshot);
  expect(saved.goal?.elapsedSeconds).toBe(11);
  await lease.close();
});

it("keeps the original error and timing baseline before rename", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `storage-${randomUUID()}`);
  roots.push(root);
  let now = 0;
  const disk = new GoalStore(root, () => now);
  const lease = await disk.openSession({ ownerSessionId: "pre-rename", cwd: process.cwd(), sessionFile: join(root, "session.jsonl") });
  await lease.replace("Track elapsed time", lease.snapshot);
  const original = new Error("Injected pre-rename failure");
  disk.beforeRename = () => { throw original; };
  now = 10_000;
  await expect(lease.checkpoint(lease.snapshot)).rejects.toBe(original);
  expect(lease.snapshot.goal?.elapsedSeconds).toBe(0);
  disk.beforeRename = undefined;
  now = 11_000;
  expect((await lease.checkpoint(lease.snapshot)).goal?.elapsedSeconds).toBe(11);
  await lease.close();
});

it("matches only the exact published record identity", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `storage-${randomUUID()}`);
  roots.push(root);
  const disk = new GoalStore(root);
  const lease = await disk.openSession({ ownerSessionId: "identity", cwd: process.cwd(), sessionFile: join(root, "session.jsonl") });
  const record = await lease.replace("Identity", lease.snapshot);
  const error = new GoalCommitPublishedError(record, new Error("sync"));
  expect(error.matches(record)).toBe(true);
  expect(error.matches(undefined)).toBe(false);
  for (const changed of [
    { recordId: "other" }, { ownerSessionId: "other" }, { revision: record.revision + 1 },
    { generation: record.generation + 1 }, { goal: { ...record.goal!, goalId: "other" } },
    { goal: { ...record.goal!, activation: 0 } },
  ]) expect(error.matches({ ...record, ...changed })).toBe(false);
  await lease.close();
});

it("retains fractional elapsed time across a published failure", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `storage-${randomUUID()}`);
  roots.push(root);
  let now = 0;
  const disk = new GoalStore(root, () => now);
  const lease = await disk.openSession({ ownerSessionId: "fractional", cwd: process.cwd(), sessionFile: join(root, "session.jsonl") });
  await lease.replace("Fractional time", lease.snapshot);
  now = 10_400;
  failingDirectory = root;
  await expect(lease.checkpoint(lease.snapshot)).rejects.toBeInstanceOf(GoalCommitPublishedError);
  failingDirectory = undefined;
  now = 10_900;
  expect((await lease.checkpoint(lease.snapshot)).goal?.elapsedSeconds).toBe(10);
  now = 11_100;
  expect((await lease.checkpoint(lease.snapshot)).goal?.elapsedSeconds).toBe(11);
  await lease.close();
});

it("adopts a published pause and excludes paused time", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `storage-${randomUUID()}`);
  roots.push(root);
  let now = 0;
  const disk = new GoalStore(root, () => now);
  const lease = await disk.openSession({ ownerSessionId: "pause", cwd: process.cwd(), sessionFile: join(root, "session.jsonl") });
  await lease.replace("Pause time", lease.snapshot);
  now = 10_000;
  failingDirectory = root;
  await expect(lease.control("pause", lease.snapshot)).rejects.toBeInstanceOf(GoalCommitPublishedError);
  failingDirectory = undefined;
  expect(lease.snapshot.goal).toMatchObject({ status: "paused", elapsedSeconds: 10 });
  now = 20_000;
  expect((await lease.checkpoint(lease.snapshot)).goal?.elapsedSeconds).toBe(10);
  await lease.control("resume", lease.snapshot);
  now = 21_000;
  expect((await lease.checkpoint(lease.snapshot)).goal?.elapsedSeconds).toBe(11);
  await lease.close();
});

it("adopts a published usage receipt without charging it twice", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `storage-${randomUUID()}`);
  roots.push(root);
  let now = 0;
  const disk = new GoalStore(root, () => now);
  const lease = await disk.openSession({ ownerSessionId: "usage", cwd: process.cwd(), sessionFile: join(root, "session.jsonl") });
  await lease.replace("Usage receipt", lease.snapshot);
  now = 10_000;
  failingDirectory = root;
  await expect(lease.account(lease.snapshot, { sourceId: "response", tokens: 25, missing: false, lastReceipt: "one" })).rejects.toBeInstanceOf(GoalCommitPublishedError);
  failingDirectory = undefined;
  expect(lease.snapshot.goal).toMatchObject({ tokensUsed: 25, elapsedSeconds: 10, usageCheckpoint: { sourceId: "response", tokens: 25, lastReceipt: "one" } });
  now = 11_000;
  const saved = await lease.account(lease.snapshot, { sourceId: "response", tokens: 25, missing: false, lastReceipt: "one" });
  expect(saved.goal).toMatchObject({ tokensUsed: 25, elapsedSeconds: 11 });
  expect(await disk.read(saved.recordId)).toEqual(saved);
  await lease.close();
});

it("adopts published replacement and clear identities", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `storage-${randomUUID()}`);
  roots.push(root);
  let now = 0;
  const disk = new GoalStore(root, () => now);
  const lease = await disk.openSession({ ownerSessionId: "replacement", cwd: process.cwd(), sessionFile: join(root, "session.jsonl") });
  const first = await lease.replace("First", lease.snapshot);
  now = 10_000;
  failingDirectory = root;
  await expect(lease.replace("Second", lease.snapshot)).rejects.toBeInstanceOf(GoalCommitPublishedError);
  failingDirectory = undefined;
  const second = lease.snapshot;
  expect(second.goal?.goalId).not.toBe(first.goal?.goalId);
  expect(second.goal?.elapsedSeconds).toBe(0);
  expect(await disk.read(second.recordId)).toEqual(second);
  await expect(lease.control("pause", first)).rejects.toThrow(/stale/i);
  failingDirectory = root;
  await expect(lease.clear(second)).rejects.toBeInstanceOf(GoalCommitPublishedError);
  failingDirectory = undefined;
  expect(lease.snapshot.goal).toBeNull();
  expect(await disk.read(second.recordId)).toEqual(lease.snapshot);
  await lease.close();
});

it.each([true, false])("keeps budget-limited timing when wrap-up is %s", async inFlight => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `storage-${randomUUID()}`);
  roots.push(root);
  let now = 0;
  const disk = new GoalStore(root, () => now);
  const lease = await disk.openSession({ ownerSessionId: `budget-${inFlight}`, cwd: process.cwd(), sessionFile: join(root, "session.jsonl") });
  await lease.replace("Budget", lease.snapshot, 5);
  lease.setBudgetInFlight(inFlight);
  now = 10_000;
  failingDirectory = root;
  await expect(lease.account(lease.snapshot, { sourceId: "response", tokens: 5, missing: false })).rejects.toBeInstanceOf(GoalCommitPublishedError);
  failingDirectory = undefined;
  expect(lease.snapshot.goal).toMatchObject({ status: "budget_limited", elapsedSeconds: 10 });
  now = 11_000;
  expect((await lease.checkpoint(lease.snapshot)).goal?.elapsedSeconds).toBe(inFlight ? 11 : 10);
  await lease.close();
});
