import { expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LOOP_PAUSE_REPEATS, LOOP_WARN_REPEATS } from "../src/loop.js";
import { registerGoalScheduler } from "../src/scheduler.js";
import type { GoalRecord } from "../src/storage.js";
function harness() {
  const record: GoalRecord = { schemaVersion: 1, recordId: "r", ownerSessionId: "s", cwd: "/test", sessionFile: "/test/s", revision: 1, generation: 1, continuationDeferral: false, recoveredFrom: null, goal: { goalId: "g", generation: 1, objective: "Review", status: "active", tokensUsed: 100, elapsedSeconds: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" } };
  const handlers = new Map<string, Function[]>();
  const history: any[] = [];
  const queued: any[] = [];
  const sendMessage = vi.fn((message: any) => queued.push({ role: "custom", ...message }));
  const ctx = { mode: "tui", model: { provider: "openai-codex" }, isIdle: () => false, sessionManager: { getSessionId: () => "s", getSessionFile: () => "/test/s" }, abort: vi.fn(), ui: { notify: vi.fn(), setStatus: vi.fn() } } as unknown as ExtensionContext;
  const emit = async (type: string, event: any = {}) => { let value; for (const handler of handlers.get(type) ?? []) value = await handler(event, ctx); return value; };
  const stop = vi.fn(async (status: any) => { record.goal!.status = status; });
  const scheduler = registerGoalScheduler({ on: (name: string, handler: Function) => handlers.set(name, [...handlers.get(name) ?? [], handler]), sendMessage } as unknown as ExtensionAPI, { snapshot: () => record, stop });
  let id = 0;
  const request = async () => { history.push(...queued.splice(0)); return emit("context", { messages: history }); };
  const tool = async (input: unknown = { path: "report.md" }, text = "Same report", toolName = "read") => {
    const toolCallId = String(++id);
    const block = await emit("tool_call", { toolCallId, toolName, input });
    if (!block?.block) await emit("tool_result", { toolCallId, toolName, input, content: [{ type: "text", text }], isError: false });
    return block;
  };
  const begin = async () => { await emit("session_start"); scheduler.start(ctx); await request(); };
  const repeat = async (count = LOOP_PAUSE_REPEATS + 1) => { for (let i = 0; i < count; i++) { expect(await tool()).toBeUndefined(); await request(); } };
  return { record, ctx, scheduler, emit, request, tool, begin, sendMessage, stop, repeat };
}
it("warns once and terminates the next repeated tool batch without aborting or clearing user queues", async () => {
  const h = harness(); await h.begin();
  await h.repeat();
  expect(h.sendMessage.mock.calls.filter(([message]) => message.customType === "pi-ext-goal-loop-warning")).toHaveLength(1);
  expect(await h.tool()).toMatchObject({ block: true, terminate: true });
  expect(h.record.goal!.status).toBe("paused");
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(h.record.goal!.tokensUsed).toBe(100);
  expect(await h.tool({ path: "sibling" })).toMatchObject({ block: true, terminate: true });
  expect(h.ctx.abort).not.toHaveBeenCalled();
});
it("pauses at a final-only boundary when repetition remains unresolved instead of queuing another run", async () => {
  const h = harness(); await h.begin();
  await h.repeat();
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Will check again" }] }] });
  expect(h.record.goal!.status).toBe("paused");
  expect(h.sendMessage.mock.calls.filter(([message]) => message.customType === "pi-ext-goal-continuation")).toHaveLength(1);
});
it("does not pause a parallel batch containing an explicit completion attempt", async () => {
  const h = harness(); await h.begin();
  await h.repeat();
  await h.emit("message_end", { message: { role: "assistant", stopReason: "toolUse", content: [
    { type: "toolCall", id: "read-final", name: "read", arguments: { path: "report.md" } },
    { type: "toolCall", id: "complete", name: "update_goal", arguments: { status: "complete" } },
  ] } });
  expect(await h.tool()).toBeUndefined();
  expect(h.stop).not.toHaveBeenCalled();
});
it("releases a loop fence only for delivered external input and retains historical warnings", async () => {
  for (const message of [{ role: "user", content: "New request" }, { role: "custom", customType: "other-extension", content: "New request" }]) {
    const h = harness(); await h.begin();
    await h.repeat();
    await h.tool();
    await h.emit("message_end", { message });
    const next = await h.request();
    expect(next.messages.some((item: any) => item.customType === "pi-ext-goal-loop-warning")).toBe(true);
    expect(await h.tool()).toBeUndefined();
    expect(h.record.goal!.status).toBe("paused");
    expect(h.ctx.abort).not.toHaveBeenCalled();
  }
});
it("does not spend the warning grace period on siblings before the model has received the warning", async () => {
  const h = harness(); await h.begin();
  for (let i = 0; i < 100; i++) expect(await h.tool()).toBeUndefined();
  expect(h.stop).not.toHaveBeenCalled();
  await h.request();
  for (let i = 0; i < LOOP_PAUSE_REPEATS - LOOP_WARN_REPEATS; i++) expect(await h.tool()).toBeUndefined();
  expect(await h.tool()).toMatchObject({ block: true, terminate: true });
});
it("ignores late results from an invalidated goal and starts a fresh audit on resume", async () => {
  const h = harness(); await h.begin();
  await h.repeat(LOOP_WARN_REPEATS + 1);
  await h.emit("tool_call", { toolCallId: "late", toolName: "read", input: { path: "report.md" } });
  h.scheduler.invalidate();
  h.record.goal!.goalId = "replacement";
  h.scheduler.resume(h.ctx);
  await h.request();
  for (let i = 0; i < 40; i++) await h.emit("tool_result", { toolCallId: "late", toolName: "read", input: { path: "report.md" }, content: [{ type: "text", text: "Same report" }], isError: false });
  await h.repeat(LOOP_WARN_REPEATS);
  expect(h.sendMessage.mock.calls.filter(([message]) => message.customType === "pi-ext-goal-loop-warning")).toHaveLength(1);
  expect(h.stop).not.toHaveBeenCalled();
});
it("does not replace terminal or budget states with a loop pause", async () => {
  for (const status of ["complete", "budget_limited", "usage_limited", "blocked", "paused"] as const) {
    const h = harness(); await h.begin();
    await h.repeat();
    h.record.goal!.status = status;
    expect(await h.tool()).toBeUndefined();
    expect(h.stop).not.toHaveBeenCalled();
  }
});
it("keeps a bounded termination fence when the pause cannot be saved", async () => {
  const h = harness(); await h.begin();
  h.stop.mockRejectedValueOnce(new Error("disk unavailable"));
  await h.repeat();
  expect(await h.tool()).toMatchObject({ block: true, terminate: true });
  expect(await h.tool()).toMatchObject({ block: true, terminate: true });
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(h.record.goal!.status).toBe("active");
  expect(h.ctx.abort).not.toHaveBeenCalled();
});
it("does not suspend a replacement goal when an old pause fails", async () => {
  const h = harness(); await h.begin();
  h.stop.mockImplementationOnce(async () => {
    h.scheduler.invalidate();
    h.record.goal!.goalId = "replacement";
    h.scheduler.resume(h.ctx);
    throw new Error("stale write");
  });
  await h.repeat();
  await h.tool();
  const next = await h.request();
  expect(next.messages.some((message: any) => message.customType === "pi-ext-goal-continuation")).toBe(true);
  expect(await h.tool()).toBeUndefined();
});
it("lets a completion attempt or a different action run after the warning instead of forcing a pause", async () => {
  for (const [input, name] of [[{ status: "complete" }, "update_goal"], [{ path: "new-evidence.md" }, "read"]] as const) {
    const h = harness(); await h.begin();
    await h.repeat();
    expect(await h.tool(input, "New evidence", name)).toBeUndefined();
    expect(h.stop).not.toHaveBeenCalled();
    expect(await h.tool()).toBeUndefined();
  }
});
