import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rmdir, unlink } from "node:fs/promises";
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
    const handle = await open(ownerFile, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), instanceId, owner })); await handle.sync(); }
    finally { await handle.close(); }
    return new WriterLock(directory, ownerFile);
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
