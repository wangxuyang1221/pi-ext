import { afterEach, expect, it, vi } from "vitest";
import * as actualFs from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

let failure: "open" | "write" | "sync" | "close" | undefined;
let closeCount = 0;
let onSyncFailure: (() => Promise<void>) | undefined;
let failIdentity: "directory" | "owner" | undefined;
let failCloseToo = false;
let directoryStats = 0;
let ownerStats = 0;
vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, lstat: async (...args: Parameters<typeof fs.lstat>) => {
    if (String(args[0]).endsWith(".lock")) directoryStats++;
    if (failIdentity === "directory" && String(args[0]).endsWith(".lock")) throw new Error("Injected directory identity failure");
    return fs.lstat(...args);
  }, open: async (...args: Parameters<typeof fs.open>) => {
    if (failure === "open" && String(args[0]).endsWith(".json") && args[1] === "wx") {
      failure = undefined;
      throw Object.assign(new Error("Injected owner open failure"), { code: "EMFILE" });
    }
    const handle = await fs.open(...args);
    if (!String(args[0]).endsWith(".json") || args[1] !== "wx") return handle;
    return new Proxy(handle, { get(target, property) {
      if (property === "writeFile" && failure === "write") return async () => { await target.writeFile("{"); throw new Error("Injected owner write failure"); };
      if (property === "sync" && failure === "sync") return async () => { await onSyncFailure?.(); throw new Error("Injected owner sync failure"); };
      if (property === "stat") return async () => { ownerStats++; if (failIdentity === "owner") throw new Error("Injected owner identity failure"); return target.stat(); };
      if (property === "close") return async () => { closeCount++; await target.close(); if (failure === "close" || failCloseToo) throw new Error("Injected owner close failure"); };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
});
import { WriterLock } from "../src/lock.js";
import { GoalStore } from "../src/storage.js";

const roots: string[] = [];
afterEach(async () => {
  failure = undefined;
  closeCount = 0;
  onSyncFailure = undefined;
  failIdentity = undefined;
  failCloseToo = false;
  directoryStats = 0;
  ownerStats = 0;
  for (const root of roots.splice(0)) await actualFs.rm(root, { recursive: true, force: true });
});

it("reads directory and owner identity once on normal acquisition", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `lock-${randomUUID()}`);
  roots.push(root);
  await actualFs.mkdir(root, { recursive: true });
  const lock = await WriterLock.acquire(join(root, "writer.lock"), "owner");
  expect(directoryStats).toBe(1);
  expect(ownerStats).toBe(1);
  await lock.close();
});

it("preserves a replacement lock directory when initialization fails", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `lock-${randomUUID()}`);
  roots.push(root);
  await actualFs.mkdir(root, { recursive: true });
  const directory = join(root, "writer.lock");
  const moved = join(root, "old-writer.lock");
  let replacement: WriterLock | undefined;
  failure = "sync";
  onSyncFailure = async () => {
    await actualFs.rename(directory, moved);
    failure = undefined;
    replacement = await WriterLock.acquire(directory, "replacement");
  };
  const error = await WriterLock.acquire(directory, "original").catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors[0]).toMatchObject({ message: "Injected owner sync failure" });
  expect((error as AggregateError).errors[1]).toMatchObject({ message: expect.stringContaining("changed") });
  await replacement!.assertOwned();
  await replacement!.close();
  expect((await actualFs.readdir(moved))).toHaveLength(1);
});

it("preserves a replacement owner file and reports incomplete cleanup", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `lock-${randomUUID()}`);
  roots.push(root);
  await actualFs.mkdir(root, { recursive: true });
  const directory = join(root, "writer.lock");
  let replacementFile = "";
  failure = "sync";
  onSyncFailure = async () => {
    const owner = join(directory, (await actualFs.readdir(directory))[0]!);
    await actualFs.rename(owner, `${owner}.moved`);
    await actualFs.writeFile(owner, "foreign owner");
    replacementFile = owner;
    failure = undefined;
  };
  const error = await WriterLock.acquire(directory, "original").catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors[0]).toMatchObject({ message: "Injected owner sync failure" });
  expect((error as AggregateError).errors.some(item => String(item).includes("owner changed"))).toBe(true);
  expect(await actualFs.readFile(replacementFile, "utf8")).toBe("foreign owner");
});

it("recovers catalog acquisition after its owner open fails", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `lock-${randomUUID()}`);
  roots.push(root);
  const disk = new GoalStore(root);
  const owner = { ownerSessionId: "catalog", cwd: process.cwd(), sessionFile: join(root, "session.jsonl") };
  failure = "open";
  await expect(disk.openSession(owner)).rejects.toThrow("Injected owner open failure");
  await expect(actualFs.lstat(join(root, "catalog.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  const lease = await disk.openSession(owner);
  await lease.close();
});

it("retains an unknown file and reports cleanup failure without deleting it", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `lock-${randomUUID()}`);
  roots.push(root);
  await actualFs.mkdir(root, { recursive: true });
  const directory = join(root, "writer.lock");
  failure = "sync";
  onSyncFailure = async () => {
    const owner = join(directory, (await actualFs.readdir(directory))[0]!);
    await actualFs.unlink(owner);
    await actualFs.writeFile(join(directory, "foreign.txt"), "foreign");
  };
  const error = await WriterLock.acquire(directory, "original").catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors[0]).toMatchObject({ message: "Injected owner sync failure" });
  expect(await actualFs.readFile(join(directory, "foreign.txt"), "utf8")).toBe("foreign");
});

it("keeps the primary write failure when closing and cleanup also fail", async () => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `lock-${randomUUID()}`);
  roots.push(root);
  await actualFs.mkdir(root, { recursive: true });
  const directory = join(root, "writer.lock");
  failure = "write";
  failCloseToo = true;
  const error = await WriterLock.acquire(directory, "original").catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors[0]).toMatchObject({ message: "Injected owner write failure" });
  expect((error as AggregateError).errors[1]).toMatchObject({ message: "Injected owner close failure" });
  expect(closeCount).toBe(1);
});

it.each(["directory", "owner"] as const)("retains resources when initial %s identity cannot be verified", async target => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `lock-${randomUUID()}`);
  roots.push(root);
  await actualFs.mkdir(root, { recursive: true });
  const directory = join(root, "writer.lock");
  failIdentity = target;
  const error = await WriterLock.acquire(directory, "original").catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors[0]).toMatchObject({ message: `Injected ${target} identity failure` });
  failIdentity = undefined;
  expect(await actualFs.readdir(directory)).toHaveLength(target === "directory" ? 0 : 1);
});

it.each(["open", "write", "sync", "close"] as const)("removes a newly created lock directory after owner %s fails", async stage => {
  const root = join(process.cwd(), ".tmp", "goal-bugfix", `lock-${randomUUID()}`);
  roots.push(root);
  await actualFs.mkdir(root, { recursive: true });
  const directory = join(root, "writer.lock");
  failure = stage;
  await expect(WriterLock.acquire(directory, "test")).rejects.toThrow(`Injected owner ${stage} failure`);
  expect(closeCount).toBe(stage === "open" ? 0 : 1);
  await expect(actualFs.lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  failure = undefined;
  const lock = await WriterLock.acquire(directory, "test");
  await lock.assertOwned();
  await lock.close();
});
