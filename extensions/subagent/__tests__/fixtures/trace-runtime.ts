import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

/** Observe real parent operations without substituting results or performing I/O on their critical path. */
export async function traceRuntime(mode: string, root: string) {
  const directory = process.env.PI_SUBAGENT_TRACE_DIR;
  if (!directory) return async () => {};
  const target = resolve(directory);
  assert.ok(target.startsWith(process.cwd() + sep), "Trace directory must stay inside the repository");
  const compiled = process.env.PI_SUBAGENT_FIXTURE_DIST === "1";
  const { SubagentManager } = compiled ? await import("../../dist/manager.js") : await import("../../src/manager.js");
  const { TmuxRuntime } = compiled ? await import("../../dist/tmux-runtime.js") : await import("../../src/tmux-runtime.js");
  const { SessionStateStore } = compiled ? await import("../../dist/state-store.js") : await import("../../src/state-store.js");
  const entries: unknown[] = [];
  const restore: (() => void)[] = [];
  let sequence = 0;
  for (const [owner, prototype, names] of [
    ["manager", SubagentManager.prototype, ["close", "closeAll", "closeDirect", "confirmClosed", "claimNamespace", "reconcileOwnedSessions", "recordControlStatus", "retireProcesses"]],
    ["runtime", TmuxRuntime.prototype, ["observe", "close", "launch", "sendPrompt"]],
    ["store", SessionStateStore.prototype, ["load", "update", "delete", "listOwned"]],
  ] as const) {
    for (const name of names) {
      const proto = prototype as any, original = proto[name];
      assert.equal(typeof original, "function", `Missing diagnostic method ${owner}.${name}`);
      proto[name] = async function (...args: any[]) {
        const id = ++sequence;
        entries.push({ id, owner, name, phase: "start", ms: performance.now() });
        try {
          const result = await original.apply(this, args);
          entries.push({ id, owner, name, phase: "end", ms: performance.now(),
            ...(name === "observe" ? { observation: result } : {}) });
          return result;
        } catch (error) {
          entries.push({ id, owner, name, phase: "error", ms: performance.now(), error: String(error) });
          throw error;
        }
      };
      restore.push(() => { proto[name] = original; });
    }
  }
  return async () => {
    for (const reset of restore.reverse()) reset();
    const lockRoot = join(root, "state", "locks");
    const locks = await Promise.all((await readdir(lockRoot).catch(() => [])).map(async name => ({ name,
      files: await Promise.all((await readdir(join(lockRoot, name)).catch(() => [])).map(async file => ({ file,
        owner: await readFile(join(lockRoot, name, file), "utf8").catch(() => "unavailable") }))) })));
    await mkdir(target, { recursive: true });
    await writeFile(join(target, `${compiled ? "dist" : "source"}-${mode}-${basename(root)}.json`), JSON.stringify({ mode, compiled, root, pid: process.pid, entries, locks }, null, 2));
  };
}
