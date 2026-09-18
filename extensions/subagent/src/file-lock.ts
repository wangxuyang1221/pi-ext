import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
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
  const owner = { pid: process.pid, host: hostname(), token };
  const filename = `${token}.json`;
  const ownerPath = join(path, filename);
  await mkdir(dirname(path), { recursive: true });
  while (true) {
    signal?.throwIfAborted();
    try {
      await mkdir(path, { mode: 0o700 });
      await writeFile(ownerPath, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const files = await readdir(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    if (files.length === 1) {
      const stalePath = join(path, files[0]!);
      try {
        const previous = JSON.parse(await readFile(stalePath, "utf8")) as typeof owner;
        if (previous.host === hostname() && Number.isSafeInteger(previous.pid) && previous.pid > 0) {
          let absent = false;
          try { process.kill(previous.pid, 0); }
          catch (error) { absent = (error as NodeJS.ErrnoException).code === "ESRCH"; }
          if (absent) {
            await unlink(stalePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
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
      await unlink(ownerPath);
      await rmdir(path);
      released = true;
    },
  };
}
