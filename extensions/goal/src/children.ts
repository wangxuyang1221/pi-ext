import { randomUUID } from "node:crypto";
import { constants, watch, type FSWatcher } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { goalCapability } from "./capability.js";
import type { ChildUsageCheckpoint, GoalRecord, UsageCheckpoint } from "./storage.js";

interface Access {
  snapshot(): GoalRecord | undefined;
  subscribe(expected: GoalRecord, source: ChildUsageCheckpoint, ctx: ExtensionContext): Promise<void>;
  account(expected: GoalRecord, usage: UsageCheckpoint, ctx: ExtensionContext): Promise<void>;
  budget(ctx: ExtensionContext): void;
  error(error: unknown, ctx: ExtensionContext): void;
  busy(): boolean;
}
/** Only explicitly subscribed files are read; observations never manufacture tool usage. */
export function registerChildAccounting(pi: ExtensionAPI, access: Access) {
  let context: ExtensionContext | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const watchers = new Map<string, FSWatcher>();
  const same = (expected: GoalRecord) => {
    const latest = access.snapshot();
    return latest?.recordId === expected.recordId && latest.ownerSessionId === expected.ownerSessionId && latest.generation === expected.generation && latest.goal?.goalId === expected.goal?.goalId;
  };
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const checkpoint = (caller: ExtensionContext) => {
    const ctx = context;
    return serialize(async () => {
    if (!ctx || caller.sessionManager.getSessionId() !== ctx.sessionManager.getSessionId()) return;
    const expected = access.snapshot();
    if (context !== ctx || !expected?.goal) return;
    for (const child of expected.goal.childUsage ?? []) {
      if (!same(expected) || context !== ctx) return;
      let file;
      try { file = await open(child.reportPath, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      let value: UsageCheckpoint;
      try {
        if ((await file.stat()).size > 8192) throw new Error("Child usage report is too large.");
        value = JSON.parse(await file.readFile("utf8"));
      } finally { await file.close(); }
      if (!value || value.sourceId !== child.sourceId || !Number.isSafeInteger(value.tokens) || value.tokens < child.tokens || typeof value.missing !== "boolean" || (value.lastReceipt !== undefined && (typeof value.lastReceipt !== "string" || value.lastReceipt.length > 128))) throw new Error("Invalid child usage report.");
      if (!same(expected) || context !== ctx) return;
      const current = access.snapshot()!;
      const previous = current.goal!.childUsage!.find(source => source.sourceId === child.sourceId)!;
      if (previous.tokens === value.tokens && previous.missing === value.missing && previous.lastReceipt === value.lastReceipt) continue;
      await access.account(current, { sourceId: value.sourceId, tokens: value.tokens, missing: value.missing, ...(value.lastReceipt ? { lastReceipt: value.lastReceipt } : {}) }, ctx);
      access.budget(ctx);
    }
    });
  };
  const refresh = () => {
    const directories = new Set((access.snapshot()?.goal?.childUsage ?? []).map(source => dirname(source.reportPath)));
    for (const [directory, watcher] of watchers) {
      if (!directories.has(directory)) { watcher.close(); watchers.delete(directory); }
    }
    if (!context) return;
    for (const directory of directories) {
      if (watchers.has(directory)) continue;
      const ctx = context;
      const watcher = watch(directory, { persistent: false }, (_event, name) => {
        if (context !== ctx || access.busy() || !name?.endsWith(".json")) return;
        void checkpoint(ctx).catch(error => { if (context === ctx) access.error(error, ctx); });
      });
      watcher.on("error", error => { if (context === ctx) access.error(error, ctx); });
      watchers.set(directory, watcher);
    }
  };
  // emit is synchronous; the caller explicitly awaits the promises claimed by an owner.
  let unsubscribe: (() => void) | undefined;
  const onTask = (data: unknown) => {
    const request = data as { parentSessionId: string; directory: string; promises: Promise<string | undefined>[] };
    const ctx = context;
    if (!ctx || request.parentSessionId !== ctx.sessionManager.getSessionId()) return;
    request.promises.push(serialize(async () => {
      const expected = access.snapshot();
      if (!expected?.goal || context !== ctx || !goalCapability(ctx).supported || (expected.goal.status !== "active" && !(expected.goal.status === "budget_limited" && !ctx.isIdle()))) return;
      if (!isAbsolute(request.directory)) throw new Error("Invalid managed report directory.");
      const sourceId = randomUUID();
      await mkdir(request.directory, { recursive: true, mode: 0o700 });
      if (!same(expected) || context !== ctx || !goalCapability(ctx).supported) return;
      await access.subscribe(access.snapshot()!, { sourceId, reportPath: join(request.directory, `${sourceId}.json`), tokens: 0, missing: false }, ctx);
      refresh();
      return sourceId;
    }));
  };
  return {
    async start(ctx: ExtensionContext) {
      context = ctx;
      unsubscribe ??= pi.events?.on("pi-ext:goal:subagent-task", onTask);
      refresh();
      await checkpoint(ctx);
    },
    async stop(ctx: ExtensionContext) {
      try { await checkpoint(ctx); }
      finally {
        context = undefined;
        unsubscribe?.();
        unsubscribe = undefined;
        for (const watcher of watchers.values()) watcher.close();
        watchers.clear();
        await queue;
      }
    },
    checkpoint,
    refresh,
  };
}
