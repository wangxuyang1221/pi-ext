import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test, vi } from "vitest";
import { acquireFileLock } from "../src/file-lock.js";
import { executeCommand } from "../src/command-executor.js";

const hooks = vi.hoisted(() => ({
  afterRead: undefined as ((path: unknown) => Promise<void>) | undefined,
  beforeUnlink: undefined as ((path: unknown) => Promise<void>) | undefined,
  beforeWrite: undefined as ((path: unknown) => Promise<void>) | undefined,
  beforeRename: undefined as ((source: unknown, target: unknown) => Promise<void>) | undefined,
  beforeRmdir: undefined as ((path: unknown) => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    async readFile(...args: Parameters<typeof fs.readFile>) {
      const result = await fs.readFile(...args);
      await hooks.afterRead?.(args[0]);
      return result;
    },
    async unlink(...args: Parameters<typeof fs.unlink>) {
      await hooks.beforeUnlink?.(args[0]);
      return fs.unlink(...args);
    },
    async writeFile(...args: Parameters<typeof fs.writeFile>) {
      await hooks.beforeWrite?.(args[0]);
      return fs.writeFile(...args);
    },
    async rename(...args: Parameters<typeof fs.rename>) {
      await hooks.beforeRename?.(args[0], args[1]);
      return fs.rename(...args);
    },
    async rmdir(...args: Parameters<typeof fs.rmdir>) {
      await hooks.beforeRmdir?.(args[0]);
      return fs.rmdir(...args);
    },
  };
});

test("independent OS contenders preserve stale-lock exclusion across the owner-publication barrier", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-lock-process-"));
  const controller = new AbortController();
  const running: ReturnType<typeof executeCommand>[] = [];
  const until = async (name: string) => {
    const deadline = performance.now() + 5000;
    while (!existsSync(join(root, name))) {
      if (performance.now() > deadline) throw new Error(`Missing lock process barrier: ${name}`);
      await delay(5);
    }
  };
  try {
    const stopped = spawnSync(process.execPath, ["-e", ""]);
    assert.equal(stopped.status, 0);
    assert.throws(() => process.kill(stopped.pid, 0), { code: "ESRCH" });
    await mkdir(join(root, "lock"));
    await writeFile(join(root, "lock", "stale.json"), JSON.stringify({ pid: stopped.pid, host: hostname(), token: "stale" }));
    const script = join(root, "contender.mjs");
    const entry = process.env.PI_SUBAGENT_FIXTURE_DIST === "1" ? "dist/file-lock.js" : "src/file-lock.ts";
    await writeFile(script, `import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {acquireFileLock} from ${JSON.stringify(pathToFileURL(resolve("extensions/subagent", entry)).href)};
const [root,role]=process.argv.slice(2);
const original={readFile:fs.readFile,writeFile:fs.writeFile,unlink:fs.unlink,rename:fs.rename};
const until=async name=>{const end=performance.now()+5000;while(!existsSync(root+'/'+name)){if(performance.now()>end)throw Error('Missing barrier '+name);await delay(5);}};
const stale=root+'/lock/stale.json';
fs.readFile=async(...args)=>{const value=await original.readFile(...args);if(args[0]===stale){await original.writeFile(root+'/read-'+role,'');await until('read-'+(role==='A'?'B':'A'));}return value;};
fs.unlink=async(...args)=>{if(role==='B'&&args[0]===stale)await until('new-directory');return original.unlink(...args);};
fs.rename=async(...args)=>{if(role==='A'&&args[1]===root+'/lock'&&!existsSync(stale)){await original.writeFile(root+'/new-directory','');await until('b-finished');}return original.rename(...args);};
syncBuiltinESMExports();
let lock;
try{lock=await acquireFileLock(root+'/lock',undefined,role==='B'?0:5000);}catch(error){if(role==='A'||!String(error).includes('Subagent control lock unavailable:'))throw error;}
Object.assign(fs,original);syncBuiltinESMExports();
if(role==='B')await fs.writeFile(root+'/b-finished','');
await fs.writeFile(root+'/result-'+role,JSON.stringify({pid:process.pid,held:Boolean(lock)}));
await until('verify');if(lock)await lock.assertOwned();await fs.writeFile(root+'/verified-'+role,'');
await until('release');await lock?.release();`);
    for (const role of ["A", "B"]) running.push(executeCommand(process.execPath, ["--experimental-strip-types", script, root, role], { signal: controller.signal, timeout: 10000 }));
    await Promise.all([until("result-A"), until("result-B")]);
    await writeFile(join(root, "verify"), "");
    await Promise.all([until("verified-A"), until("verified-B")]);
    const records = await Promise.all(["A", "B"].map(async role => JSON.parse(await readFile(join(root, `result-${role}`), "utf8"))));
    assert.notEqual(records[0].pid, records[1].pid);
    assert.equal(records.filter(record => record.held).length, 1);
    await writeFile(join(root, "release"), "");
    for (const result of await Promise.all(running)) assert.equal(result.code, 0, result.stderr);
    for (const record of records) assert.throws(() => process.kill(record.pid, 0), { code: "ESRCH" });
  } finally {
    controller.abort();
    await Promise.allSettled(running);
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("an interrupted owner publication cannot leave an unowned active lock", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-lock-publication-"));
  const path = join(root, "lock");
  try {
    hooks.beforeWrite = async () => { throw new Error("Owner publication interrupted"); };
    await assert.rejects(acquireFileLock(path), /Owner publication interrupted/);
    hooks.beforeWrite = undefined;
    const next = await acquireFileLock(path, undefined, 0);
    await next.assertOwned();
    await next.release();
  } finally {
    hooks.beforeWrite = undefined;
    await rm(root, { recursive: true, force: true });
  }
});

test("release cannot remove a successor published into the emptied lock directory", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-lock-release-"));
  const path = join(root, "lock");
  const empty = deferred(), resume = deferred();
  let paused = false;
  let releasing: Promise<void> | undefined;
  try {
    const first = await acquireFileLock(path);
    hooks.beforeRmdir = async candidate => {
      if (candidate === path && !paused) { paused = true; empty.resolve(); await resume.promise; }
    };
    releasing = first.release();
    await empty.promise;
    const next = await acquireFileLock(path, undefined, 0);
    resume.resolve();
    await releasing;
    await next.assertOwned();
    hooks.beforeRmdir = undefined;
    await next.release();
  } finally {
    resume.resolve();
    await releasing;
    hooks.beforeRmdir = undefined;
    await rm(root, { recursive: true, force: true });
  }
});

test("a losing stale-lock reclaimer cannot delete a new owner's initializing directory", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-lock-race-"));
  const path = join(root, "controller");
  const stalePath = join(path, "stale.json");
  const scope = new AsyncLocalStorage<string>();
  const bothRead = deferred();
  const newDirectory = deferred();
  const secondFinished = deferred();
  let reads = 0;
  try {
    const stopped = spawnSync(process.execPath, ["-e", ""]);
    assert.equal(stopped.status, 0);
    assert.throws(() => process.kill(stopped.pid, 0), { code: "ESRCH" });
    await mkdir(path);
    await writeFile(stalePath, JSON.stringify({ pid: stopped.pid, host: hostname(), token: "stale" }));
    hooks.afterRead = async candidate => {
      if (candidate !== stalePath) return;
      if (++reads === 2) bothRead.resolve();
      await bothRead.promise;
    };
    hooks.beforeUnlink = async candidate => {
      if (scope.getStore() === "B" && candidate === stalePath) await newDirectory.promise;
    };
    hooks.beforeRename = async (_source, target) => {
      if (scope.getStore() === "A" && target === path && !existsSync(stalePath)) {
        newDirectory.resolve();
        await secondFinished.promise;
      }
    };
    const first = scope.run("A", () => acquireFileLock(path));
    const second = scope.run("B", () => acquireFileLock(path, undefined, 0).finally(secondFinished.resolve));
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    if (results[1].status === "rejected") assert.match(String(results[1].reason), /Subagent control lock unavailable:/u);
    assert.equal((await readdir(path)).length, 1);
    if (results[0].status === "fulfilled") {
      await results[0].value.assertOwned();
      await results[0].value.release();
    }
    const next = await acquireFileLock(path, undefined, 0);
    await next.assertOwned();
    await next.release();
  } finally {
    bothRead.resolve(); newDirectory.resolve(); secondFinished.resolve();
    hooks.afterRead = undefined; hooks.beforeUnlink = undefined; hooks.beforeWrite = undefined; hooks.beforeRename = undefined;
    await rm(root, { recursive: true, force: true });
  }
});

test("waits for a live owner's partially published record instead of parsing it as a failure", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-lock-partial-"));
  const path = join(root, "lock");
  await mkdir(path);
  const ownerFile = join(path, "initializing.json");
  await writeFile(ownerFile, "");
  try {
    await assert.rejects(acquireFileLock(path, undefined, 20), /Subagent control lock unavailable:/u);
    assert.equal(await readFile(ownerFile, "utf8"), "");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recovers a partial record only when its named local owner has exited", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-lock-partial-"));
  const path = join(root, "lock");
  const stopped = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(stopped.status, 0);
  assert.throws(() => process.kill(stopped.pid, 0), { code: "ESRCH" });
  await mkdir(path);
  const filename = `${Buffer.from(hostname()).toString("base64url")}.${stopped.pid}.12345678-1234-1234-1234-123456789abc.json`;
  await writeFile(join(path, filename), "");
  try {
    const lock = await acquireFileLock(path, undefined, 50);
    await lock.assertOwned();
    await lock.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});
