import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface FileLock {
  token: string;
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

/** No time-based takeover: only a local owner's confirmed absence permits recovery. */
export async function acquireFileLock(path: string, signal?: AbortSignal, timeoutMs = 5_000): Promise<FileLock> {
  const deadline = performance.now() + timeoutMs;
  const token = randomUUID();
  const owner: { pid: number; host: string; token: string } = { pid: process.pid, host: hostname(), token };
  // Keep recovery identity available even if the owner dies during writeFile.
  const filename = `${Buffer.from(owner.host).toString("base64url")}.${owner.pid}.${token}.json`;
  const ownerPath = join(path, filename);
  await mkdir(dirname(path), { recursive: true });
  const pendingPath = `${path}.${token}.pending`;
  await mkdir(pendingPath, { mode: 0o700 });
  try {
    // Publish a nonempty directory atomically. A killed initializer must never
    // leave an active lock without the identity needed for crash recovery.
    await writeFile(join(pendingPath, filename), JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    while (true) {
      signal?.throwIfAborted();
      try {
        await rename(pendingPath, path);
        break;
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
      const files = await readdir(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      if (files.length === 0) {
        // Windows cannot rename over an empty directory. Published owners are
        // always nonempty, so rmdir cannot remove a competing claim.
        try { await rmdir(path); continue; }
        catch (error) {
          if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        }
      }
      if (files.length === 1) {
        const stalePath = join(path, files[0]!);
        try {
          const contents = await readFile(stalePath, "utf8");
          let previous: typeof owner | undefined;
          try { previous = JSON.parse(contents) as typeof owner; }
          catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            const identity = /^([A-Za-z0-9_-]+)\.([0-9]+)\.([a-f0-9-]{36})\.json$/u.exec(files[0]!);
            if (identity) previous = { host: Buffer.from(identity[1]!, "base64url").toString("utf8"), pid: Number(identity[2]), token: identity[3]! };
          }
          if (previous?.host === hostname() && Number.isSafeInteger(previous.pid) && previous.pid > 0) {
            let absent = false;
            try { process.kill(previous.pid, 0); }
            catch (error) { absent = (error as NodeJS.ErrnoException).code === "ESRCH"; }
            if (absent) {
              // Only the contender that removed this generation's owner may remove its directory.
              // ENOENT must leave this block: the path may already contain a new initializing lock.
              await unlink(stalePath);
              await rmdir(path).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
              });
              continue;
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (performance.now() >= deadline) throw new Error(`Subagent control lock unavailable: ${path}`);
      await delay(10, undefined, { signal });
    }
  } finally { await rm(pendingPath, { recursive: true, force: true }); }
  let released = false;
  const assertOwned = async (): Promise<void> => {
    if (released || await readFile(ownerPath, "utf8") !== JSON.stringify(owner)) {
      throw new Error("Subagent controller ownership changed");
    }
  };
  return {
    token,
    assertOwned,
    async release() {
      if (released) return;
      await assertOwned();
      const directory = await stat(path);
      await unlink(ownerPath);
      // A contender can atomically replace the empty directory after unlink.
      await rmdir(path).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return;
        if (error.code === "ENOTEMPTY") {
          const current = await stat(path).catch((probe: NodeJS.ErrnoException) => {
            if (probe.code === "ENOENT") return undefined;
            throw probe;
          });
          if (!current || current.dev !== directory.dev || current.ino !== directory.ino) return;
        }
        throw error;
      });
      released = true;
    },
  };
}
