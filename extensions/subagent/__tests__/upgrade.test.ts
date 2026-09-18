import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { createSessionState, SessionStateStore } from "../src/state-store.js";
import { upgradeOffline } from "../src/upgrade.js";

test.each(["live", "unknown", "managed", "corrupt"])("refuses an unsafe %s upgrade without replacing its source", async (kind) => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-upgrade-"));
  try {
    const store = new SessionStateStore(root);
    const state = { ...createSessionState({ sessionId: "root", epoch: "e", cwd: root, sessionFile: "/native.jsonl", now: "now", pid: kind === "live" ? process.pid : 2147483647 }),
      schemaVersion: kind === "unknown" ? 99 : 2,
      reservations: kind === "managed" ? [{ reservationId: "r", processInstanceId: "p", createdAt: "now", expiresAt: "later" }] : [],
    };
    await mkdir(join(root, "sessions", "root"), { recursive: true });
    const original = kind === "corrupt" ? "{broken" : JSON.stringify(state);
    await writeFile(store.statePath("root"), original);
    await assert.rejects(upgradeOffline(root, "root"));
    assert.equal(await readFile(store.statePath("root"), "utf8"), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each([false, true])("upgrades, retries and rolls back an empty v2 namespace with an existing backup=%s", async (hasBackup) => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-upgrade-"));
  try {
    const store = new SessionStateStore(root);
    const native = join(root, "native.jsonl");
    await writeFile(native, "native transcript\n");
    const previous = { ...createSessionState({ sessionId: "root", epoch: "epoch", cwd: root, sessionFile: native, now: "now", pid: 2147483647 }), schemaVersion: 2 };
    const original = JSON.stringify(previous);
    await mkdir(join(root, "sessions", "root"), { recursive: true });
    await writeFile(store.statePath("root"), original);
    if (hasBackup) {
      await writeFile(`${store.statePath("root")}.v2.backup`, original);
      await writeFile(`${store.statePath("root")}.abandoned.migration`, "{interrupted");
    }
    await upgradeOffline(root, "root");
    await upgradeOffline(root, "root");
    assert.equal((await store.load("root"))?.schemaVersion, 3);
    assert.equal((await store.load("root"))?.epoch, "epoch");
    assert.equal(await readFile(`${store.statePath("root")}.v2.backup`, "utf8"), original);
    assert.equal(await readFile(native, "utf8"), "native transcript\n");
    // Rollback is an offline operator action, never an automatic schema downgrade.
    await writeFile(store.statePath("root"), await readFile(`${store.statePath("root")}.v2.backup`));
    assert.equal(JSON.parse(await readFile(store.statePath("root"), "utf8")).schemaVersion, 2);
    await upgradeOffline(root, "root");
    assert.equal((await store.load("root"))?.schemaVersion, 3);
    assert.equal(await readFile(native, "utf8"), "native transcript\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});
