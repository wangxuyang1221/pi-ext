import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
/** No time-based takeover: only a local owner's confirmed absence permits recovery. */
export async function acquireFileLock(path, signal, timeoutMs = 5_000) {
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
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
        }
        const files = await readdir(path).catch((error) => {
            if (error.code === "ENOENT")
                return [];
            throw error;
        });
        if (files.length === 1) {
            const stalePath = join(path, files[0]);
            try {
                const previous = JSON.parse(await readFile(stalePath, "utf8"));
                if (previous.host === hostname() && Number.isSafeInteger(previous.pid) && previous.pid > 0) {
                    let absent = false;
                    try {
                        process.kill(previous.pid, 0);
                    }
                    catch (error) {
                        absent = error.code === "ESRCH";
                    }
                    if (absent) {
                        // Only the contender that removed this generation's owner may remove its directory.
                        // ENOENT must leave this block: the path may already contain a new initializing lock.
                        await unlink(stalePath);
                        await rmdir(path).catch((error) => {
                            if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY")
                                throw error;
                        });
                        continue;
                    }
                }
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw error;
            }
        }
        if (performance.now() >= deadline)
            throw new Error(`Subagent control lock unavailable: ${path}`);
        await delay(10, undefined, { signal });
    }
    let released = false;
    const assertOwned = async () => {
        if (released || await readFile(ownerPath, "utf8") !== JSON.stringify(owner)) {
            throw new Error("Subagent controller ownership changed");
        }
    };
    return {
        token,
        assertOwned,
        async release() {
            if (released)
                return;
            await assertOwned();
            await unlink(ownerPath);
            await rmdir(path);
            released = true;
        },
    };
}
//# sourceMappingURL=file-lock.js.map