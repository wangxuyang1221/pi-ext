import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

interface Identity { pid: number; host: string; instanceId: string; owner: string }
const instanceId = randomUUID();

/** A directory lock with a unique owner filename; no timeout-based stealing. */
export class WriterLock {
  private closed = false;
  private constructor(private readonly directory: string, private readonly ownerFile: string) {}
  static async available(directory: string): Promise<boolean> {
    try {
      const names = await readdir(directory);
      if (names.length !== 1 || !names[0]?.endsWith(".json")) return false;
      const identity = JSON.parse(await readFile(join(directory, names[0]), "utf8")) as Identity;
      if (identity.host !== hostname() || !Number.isSafeInteger(identity.pid) || identity.pid <= 0) return false;
      try { process.kill(identity.pid, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
    } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
  }
  static async acquire(directory: string, owner: string): Promise<WriterLock> {
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Read the exact owner's unique filename before checking liveness. A losing
      // reclaimer can never unlink a new owner's file, even after PID reuse.
      const names = await readdir(directory);
      if (names.length !== 1 || !names[0]?.endsWith(".json")) throw new Error("Goal writer identity is uncertain. Close other instances and explicitly repair the lock before recovery.");
      const file = join(directory, names[0]);
      let identity: Identity;
      try { identity = JSON.parse(await readFile(file, "utf8")); }
      catch { throw new Error("Goal writer identity is uncertain. Explicit lock repair is required."); }
      if (identity.host !== hostname() || !Number.isSafeInteger(identity.pid) || identity.pid <= 0) throw new Error("Goal writer identity is uncertain. Explicit lock repair is required.");
      let dead = false;
      try { process.kill(identity.pid, 0); }
      catch (probe) { dead = (probe as NodeJS.ErrnoException).code === "ESRCH"; }
      if (!dead) throw new Error("Goal already has a writer. Close its other session before recovery.");
      try { await unlink(file); await rmdir(directory); await mkdir(directory, { mode: 0o700 }); }
      catch { throw new Error("Goal writer changed during recovery. Try again."); }
    }
    const ownerFile = join(directory, `${randomUUID()}.json`);
    let directoryIdentity: { dev: number; ino: number } | undefined;
    let ownerIdentity: { dev: number; ino: number } | undefined;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let primary: unknown;
    const closeErrors: unknown[] = [];
    const same = (current: { dev: number; ino: number }, original: { dev: number; ino: number }) => current.dev === original.dev && current.ino === original.ino;
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Goal writer lock directory identity is uncertain.");
      directoryIdentity = { dev: info.dev, ino: info.ino };
      handle = await open(ownerFile, "wx", 0o600);
      const file = await handle.stat();
      if (!file.isFile()) throw new Error("Goal writer owner identity is uncertain.");
      ownerIdentity = { dev: file.dev, ino: file.ino };
      await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), instanceId, owner }));
      await handle.sync();
    } catch (error) { primary = error; }
    if (handle) {
      try { await handle.close(); }
      catch (error) { primary ??= error; if (primary !== error) closeErrors.push(error); }
    }
    if (primary === undefined) return new WriterLock(directory, ownerFile);
    const cleanupErrors: unknown[] = [...closeErrors];
    if (!directoryIdentity) cleanupErrors.push(new Error("Goal writer lock directory identity could not be verified."));
    else {
      const verifyDirectory = async () => {
        try {
          const info = await lstat(directory);
          if (!info.isDirectory() || info.isSymbolicLink() || !same(info, directoryIdentity)) throw new Error("Goal writer lock directory changed during cleanup.");
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          cleanupErrors.push(error);
          return false;
        }
      };
      if (await verifyDirectory()) {
        if (handle && !ownerIdentity) cleanupErrors.push(new Error("Goal writer owner identity could not be verified."));
        if (ownerIdentity) {
          try {
            const info = await lstat(ownerFile);
            if (!info.isFile() || info.isSymbolicLink() || !same(info, ownerIdentity)) cleanupErrors.push(new Error("Goal writer owner changed during cleanup."));
            else await unlink(ownerFile);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(error); }
        }
        if (await verifyDirectory()) {
          try { await rmdir(directory); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(error); }
        }
      }
    }
    if (cleanupErrors.length) throw new AggregateError([primary, ...cleanupErrors], "Goal writer initialization failed and cleanup was incomplete.", { cause: primary });
    throw primary;
  }
  async assertOwned(): Promise<void> {
    if (this.closed) throw new Error("Goal writer is closed.");
    await readFile(this.ownerFile);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await unlink(this.ownerFile);
    await rmdir(this.directory);
  }
}
