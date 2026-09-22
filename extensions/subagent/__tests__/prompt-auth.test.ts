import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test, vi } from "vitest";
import { installAuthenticationPreflight } from "../src/prompt-auth.js";
import { SessionRuntimeHost } from "../src/runtime-host.js";
import { createSessionState, SessionStateStore } from "../src/state-store.js";

async function fixture() {
  const root = await mkdtemp(join(process.cwd(), ".sa-auth-"));
  const store = new SessionStateStore(root);
  const parent = createSessionState({ sessionId: "parent", epoch: "pe", cwd: root, sessionFile: join(root, "parent.jsonl"), now: "now" });
  await store.save(parent);
  const host = new SessionRuntimeHost({ store, parent: { sessionId: "parent", epoch: "pe", registrationToken: "token" },
    launch: { cwd: root, sessionDir: root, displayName: "Child", processInstanceId: "process" }, createEpoch: () => "ce" });
  await host.startSession({ sessionId: "child", cwd: root, sessionFile: join(root, "child.jsonl"), leafId: null });
  const child = (await store.loadRuntime("child"))!;
  const deliveryId = "012345abcdef";
  await store.recordDelivery(parent, child, deliveryId, "steer");
  let input!: (event: any, ctx: any) => Promise<any>;
  installAuthenticationPreflight({ on: (_event: string, handler: typeof input) => { input = handler; } } as never, host);
  const ctx = { isIdle: () => true, model: { provider: "deepseek", id: "deepseek-flash" },
    sessionManager: { getSessionId: () => "child" },
    modelRegistry: { hasConfiguredAuth: vi.fn(() => false), getProviderAuth: vi.fn(async (): Promise<unknown> => undefined) } };
  return { root, store, host, ctx, input, deliveryId, event: { text: `[subagent:${deliveryId}]\nwork`, source: "interactive" },
    cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("records a bound rejection and consumes unauthenticated input", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.input(f.event, f.ctx), { action: "handled" });
    assert.deepEqual((await f.store.loadRuntime("child"))?.runtime.promptRejection,
      { deliveryId: f.deliveryId, code: "authentication_unavailable" });
    assert.equal(f.ctx.modelRegistry.getProviderAuth.mock.calls.length, 1);
  } finally { await f.cleanup(); }
});

test("never persists a provider exception that contains credentials", async () => {
  const f = await fixture();
  f.ctx.modelRegistry.getProviderAuth.mockRejectedValue(new Error("key=fixture-private-key"));
  try {
    assert.deepEqual(await f.input(f.event, f.ctx), { action: "handled" });
    const state = await readFile(f.store.statePath("child"), "utf8");
    assert.match(state, /authentication_failed/u);
    assert.doesNotMatch(state, /fixture-private-key/u);
  } finally { await f.cleanup(); }
});

test("does not repeat authentication for configured providers or streaming input", async () => {
  const f = await fixture();
  try {
    f.ctx.modelRegistry.hasConfiguredAuth.mockReturnValue(true);
    assert.equal(await f.input(f.event, f.ctx), undefined);
    f.ctx.modelRegistry.hasConfiguredAuth.mockReturnValue(false);
    assert.equal(await f.input(f.event, { ...f.ctx, isIdle: () => false }), undefined);
    assert.equal(f.ctx.modelRegistry.getProviderAuth.mock.calls.length, 0);
    assert.equal((await f.store.loadRuntime("child"))?.runtime.promptRejection, undefined);
  } finally { await f.cleanup(); }
});

test.each(["epoch", "process", "parent", "registration", "delivery"])("ignores input with mismatched %s ownership", async (field) => {
  const f = await fixture();
  try {
    if (field === "epoch") await f.store.update("child", child => ({ ...child, epoch: "new-epoch" }));
    if (field === "process") await f.store.update("child", child => ({ ...child, launch: { ...child.launch!, processInstanceId: "new-process" } }));
    if (field === "parent") await f.store.update("child", child => ({ ...child, parent: { ...child.parent!, epoch: "new-parent" } }));
    if (field === "registration") await f.store.update("child", child => ({ ...child, parent: { ...child.parent!, registrationToken: "new-token" } }));
    if (field === "delivery") f.event.text = "[subagent:ffffffffffff]\nwork";
    assert.equal(await f.input(f.event, f.ctx), undefined);
    assert.equal(f.ctx.modelRegistry.getProviderAuth.mock.calls.length, 0);
    assert.equal((await f.store.loadRuntime("child"))?.runtime.promptRejection, undefined);
  } finally { await f.cleanup(); }
});

test("does not write a late rejection into a replacement epoch", async () => {
  const f = await fixture();
  f.ctx.modelRegistry.getProviderAuth.mockImplementation(async () => {
    await f.store.update("child", child => ({ ...child, epoch: "replacement" }));
    return undefined;
  });
  try {
    await f.input(f.event, f.ctx);
    assert.equal((await f.store.loadRuntime("child"))?.runtime.promptRejection, undefined);
  } finally { await f.cleanup(); }
});

test("does not recreate state after a delivery is cancelled and the child removed", async () => {
  const f = await fixture();
  f.ctx.modelRegistry.getProviderAuth.mockImplementation(async () => { await f.store.delete("child"); return undefined; });
  try {
    assert.deepEqual(await f.input(f.event, f.ctx), { action: "handled" });
    assert.equal(await f.store.loadRuntime("child"), undefined);
  } finally { await f.cleanup(); }
});
