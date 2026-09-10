import { expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { registerChildAccounting } from "../src/children.js";
import { GoalStore } from "../src/storage.js";

it("flushes a fresh public context before observing completion when watchers are deferred", async () => {
  const root = await mkdtemp(resolve(".goal-test-"));
  const store = new GoalStore(root);
  const lease = await store.openSession({ ownerSessionId: "root", cwd: process.cwd(), sessionFile: join(root, "session.jsonl") });
  const ctx = { sessionManager: { getSessionId: () => "root" } } as never;
  const account = vi.fn(async (expected, usage) => { await lease.accountChild(expected, usage); });
  const unsubscribe = vi.fn();
  const collector = registerChildAccounting({ events: { on: () => unsubscribe } } as never, {
    snapshot: () => lease.snapshot, account, subscribe: async () => {}, budget: () => {}, error: () => {}, busy: () => true,
  });
  try {
    await lease.replace("Observe child", lease.snapshot);
    await lease.subscribeChild(lease.snapshot, { sourceId: "child", reportPath: join(root, "child.json"), tokens: 0, missing: false });
    await collector.start(ctx);
    await writeFile(join(root, "child.json"), JSON.stringify({ sourceId: "child", tokens: 40, missing: false }));
    await collector.checkpoint({ ...ctx } as never);
    expect(lease.snapshot.goal!.tokensUsed).toBe(40);
    await collector.checkpoint({ ...ctx } as never);
    expect(account).toHaveBeenCalledTimes(1);
    await collector.stop(ctx);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  } finally { await collector.stop(ctx); await lease.close(); await rm(root, { recursive: true, force: true }); }
});
