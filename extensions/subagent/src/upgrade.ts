import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireFileLock } from "./file-lock.js";
import { parseSessionState, SessionStateStore } from "./state-store.js";

/** Offline conversion only. Finish all child cleanup with v2 before invoking this helper. */
export async function upgradeOffline(root: string, sessionId: string): Promise<void> {
  const store = new SessionStateStore(root);
  const path = store.statePath(sessionId);
  const control = await acquireFileLock(join(root, "controllers", sessionId), undefined, 0);
  let lock: Awaited<ReturnType<typeof acquireFileLock>> | undefined;
  try {
    lock = await acquireFileLock(join(root, "locks", sessionId));
    const original = await readFile(path, "utf8");
    const previous = JSON.parse(original);
    if (previous.schemaVersion === 3) {
      parseSessionState(previous, sessionId);
      return;
    }
    if (previous.schemaVersion !== 2) throw new Error(`Unsupported offline upgrade schema: ${String(previous.schemaVersion)}`);
    const converted = parseSessionState({ ...previous, schemaVersion: 3 }, sessionId);
    if (converted.parent || converted.children.length || converted.reservations.length) {
      throw new Error("Offline upgrade requires an empty root namespace; close all children with the old extension first");
    }
    const pid = converted.runtime.pid;
    let stopped = false;
    if (pid && Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); }
      catch (error) { stopped = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    }
    if (!stopped) throw new Error("Offline upgrade cannot confirm that the old namespace writer has stopped");
    for (const entry of await readdir(join(root, "sessions"), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === sessionId) continue;
      // Recovery scans are deliberately conservative; ordinary operations never scan globally.
      const state = JSON.parse(await readFile(store.statePath(entry.name), "utf8"));
      if (state.parent?.sessionId === sessionId && state.parent?.epoch === converted.epoch) {
        throw new Error(`Offline upgrade found an uncleaned child binding: ${entry.name}`);
      }
    }
    const backup = `${path}.v2.backup`;
    try { await writeFile(backup, original, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(backup, "utf8") !== original) throw error;
    }
    const temporary = `${path}.${randomUUID()}.migration`;
    try {
      await writeFile(temporary, `${JSON.stringify(converted, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await control.assertOwned();
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  } finally {
    try { await lock?.release(); }
    finally { await control.release(); }
  }
}
