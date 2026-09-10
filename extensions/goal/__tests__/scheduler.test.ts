import { expect, it, vi } from "vitest";
import { renderGoalPrompt } from "../src/tools.js";
import { registerGoalScheduler } from "../src/scheduler.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GoalRecord } from "../src/storage.js";
function harness() {
  let record: GoalRecord = { schemaVersion: 1, recordId: "r", ownerSessionId: "s", cwd: "/test", sessionFile: "/test/s", revision: 1, generation: 1, continuationDeferral: false, recoveredFrom: null, goal: { goalId: "g", generation: 1, objective: "Objective", status: "active", tokensUsed: 0, elapsedSeconds: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01" } };
  const handlers = new Map<string, Function[]>();
  const sendMessage = vi.fn();
  const ctx = { mode: "tui", model: { provider: "openai-codex" }, isIdle: () => false, sessionManager: { getSessionId: () => "s" }, abort: vi.fn(), ui: { notify: vi.fn(), setStatus: vi.fn() } } as unknown as ExtensionContext;
  const emit = async (type: string, event: any = {}) => { let result; for (const fn of handlers.get(type) ?? []) result = await fn(event, ctx); return result; };
  const scheduler = registerGoalScheduler({ on: (type: string, fn: Function) => handlers.set(type, [...handlers.get(type) ?? [], fn]), sendMessage } as unknown as ExtensionAPI, {
    snapshot: () => record,
    stop: async (status, expected) => { expect(expected.goal!.goalId).toBe(record.goal!.goalId); record = { ...record, goal: { ...record.goal!, status } }; },
  });
  return { scheduler, ctx, emit, sendMessage, get record() { return record; } };
}
it("keeps a continuation at its original history position across tool responses and user steering", async () => {
  const h = harness();
  await h.emit("session_start");
  h.scheduler.start(h.ctx);
  const queued = { role: "custom", ...h.sendMessage.mock.calls[0]![0], timestamp: 1 };
  const output = { role: "toolResult", toolName: "read", content: [{ type: "text", text: "Verified report" }], timestamp: 2 };
  const user = { role: "user", content: "Finish now", timestamp: 3 };
  for (const messages of [[queued, output], [queued, output, user]]) {
    const result = await h.emit("context", { messages });
    expect(result.messages).toEqual(messages);
  }
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
});

it("provides one persisted reminder for an explicit work turn and keeps retries unchanged", async () => {
  const h = harness();
  await h.emit("session_start");
  const initial = await h.emit("before_agent_start", { prompt: "Work" });
  expect(initial.message.content).toBe(renderGoalPrompt(h.record.goal!));
  const messages = [{ role: "user", content: "Work" }, { role: "custom", ...initial.message }];
  const first = await h.emit("context", { messages });
  h.record.goal!.tokensUsed = 500;
  expect((await h.emit("context", { messages })).messages).toEqual(first.messages);
});

it("restores missing goal context before retained evidence without regenerating an audit per request", async () => {
  const h = harness();
  await h.emit("session_start");
  const user = { role: "user", content: "Finish now" };
  const first = await h.emit("context", { messages: [user] });
  expect(first.messages.at(-1)).toEqual(user);
  const reminder = first.messages[0];
  h.record.goal!.tokensUsed = 500;
  const output = { role: "toolResult", content: "Verified" };
  const second = await h.emit("context", { messages: [user, output] });
  expect(second.messages).toEqual([reminder, user, output]);
});

it("delivers the budget reminder once and preserves its original position", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  h.record.goal!.status = "budget_limited";
  h.scheduler.budget(h.ctx);
  h.scheduler.budget(h.ctx);
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
  const queued = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  const messages = [queued, { role: "toolResult", content: "Verified" }, { role: "user", content: "Finish" }];
  expect((await h.emit("context", { messages })).messages).toEqual(messages);
  expect((await h.emit("context", { messages })).messages).toEqual(messages);
});

it("does not turn late child exhaustion into a new wrap-up after a root continuation was queued", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
  const pending = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  h.record.goal!.status = "budget_limited";
  h.scheduler.budget(h.ctx);
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
  const filtered = await h.emit("context", { messages: [pending] });
  expect(filtered.messages).toEqual([]);
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
});

it("pauses a genuinely aborted model run without treating stale-request cancellation as a user pause", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "aborted" }] });
  expect(h.record.goal!.status).toBe("paused");
  expect(h.sendMessage).not.toHaveBeenCalled();
});
it("pauses an interrupted tool run even when the provider reports an error stop reason", async () => {
  const h = harness();
  const controller = new AbortController();
  Object.assign(h.ctx, { signal: controller.signal });
  await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  controller.abort();
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error", errorMessage: "This operation was aborted" }] });
  await h.emit("agent_settled");
  expect(h.record.goal!.status).toBe("paused");
  expect(h.sendMessage).not.toHaveBeenCalled();
});
it("blocks a failed compaction chain but releases its guard for explicit input and manual compaction", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  await h.emit("session_compact_failed", { reason: "threshold", aborted: false, errorMessage: "Summary failed" });
  expect(h.record.goal!.status).toBe("blocked");
  expect(await h.emit("session_before_compact", { reason: "threshold" })).toEqual({ cancel: true });
  await h.emit("input", { source: "interactive", text: "New work" });
  expect(await h.emit("session_before_compact", { reason: "threshold" })).toBeUndefined();
  expect(await h.emit("session_before_compact", { reason: "manual" })).toBeUndefined();
});
it("does not let an old run stop a replacement goal", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Old" }] });
  h.scheduler.invalidate();
  h.record.goal!.goalId = "replacement";
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error", errorMessage: "insufficient_quota" }] });
  await h.emit("agent_settled");
  expect(h.record.goal!.status).toBe("active");
});
it("leaves retry decisions to Pi, stopping only a settled error and classifying explicit quota errors", async () => {
  for (const [errorMessage, status] of [["500 Internal Server Error", "blocked"], ["insufficient_quota", "usage_limited"], ["429 Too many requests", "blocked"]]) {
    const h = harness();
    await h.emit("session_start");
    await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
    await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error", errorMessage }] });
    expect(h.record.goal!.status).toBe("active");
    expect(h.sendMessage).not.toHaveBeenCalled();
    await h.emit("agent_settled");
    expect(h.record.goal!.status).toBe(status);
  }
});
it("counts complete runs rather than individual bash failures and stops on the third failed run", async () => {
  const h = harness();
  await h.emit("session_start");
  for (let run = 1; run <= 3; run++) {
    await h.emit("context", { messages: [{ role: "user", content: `Run ${run}` }] });
    for (let call = 0; call < 4; call++) await h.emit("tool_result", { toolName: "bash", isError: true, content: [{ type: "text", text: "Command exited with code 1" }] });
    expect(h.record.goal!.status).toBe("active");
    await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    expect(h.record.goal!.status).toBe(run === 3 ? "blocked" : "active");
  }
});
it("resets failed-turn auditing on successful tools and ignores rejected or cancelled bash results", async () => {
  const h = harness();
  await h.emit("session_start");
  const turn = async (texts: string[], success = false) => {
    await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
    for (const text of texts) await h.emit("tool_result", { toolName: "bash", isError: true, content: [{ type: "text", text }] });
    if (success) await h.emit("tool_result", { toolName: "read", isError: false, content: [] });
    await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  };
  for (let n = 0; n < 3; n++) await turn(["Permission denied before execution", "Command aborted"]);
  expect(h.record.goal!.status).toBe("active");
  await turn(["Command exited with code 1"]);
  await turn(["Command timed out after 1 second"], true);
  for (let n = 0; n < 2; n++) { await turn(["Command exited with code 2"]); expect(h.record.goal!.status).toBe("active"); }
  await turn(["Command exited with code 3"]);
  expect(h.record.goal!.status).toBe("blocked");
});
it("sends the pinned objective-updated instruction exactly once after an edit", async () => {
  const h = harness();
  await h.emit("session_start");
  h.scheduler.resume(h.ctx, true);
  expect(h.sendMessage.mock.calls[0]![0].content).toBe(renderGoalPrompt(h.record.goal!, true));
  const queued = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  const first = await h.emit("context", { messages: [queued] });
  expect(first.messages.at(-1).content).toBe(renderGoalPrompt(h.record.goal!, true));
  const next = await h.emit("context", { messages: [queued, { role: "user", content: "Continue" }] });
  expect(next.messages).toEqual([queued, { role: "user", content: "Continue" }]);
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  expect(h.sendMessage.mock.calls[1]![0].content).toBe(renderGoalPrompt(h.record.goal!));
});
it("fails closed after a storage failure until an explicit successful resume", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  h.scheduler.suspend();
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  expect(h.sendMessage).not.toHaveBeenCalled();
  await h.emit("context", { messages: [{ role: "user", content: "Other work" }] });
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  expect(h.sendMessage).not.toHaveBeenCalled();
  h.scheduler.resume(h.ctx);
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
});
it("refreshes current hidden context for an explicit user request without retaining old reminders", async () => {
  const h = harness();
  await h.emit("session_start");
  const first = await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  expect(first.messages[0].content).toContain("Objective");
  h.scheduler.invalidate();
  h.record.goal!.objective = "Revised";
  const second = await h.emit("context", { messages: [...first.messages, { role: "user", content: "Continue" }] });
  expect(second.messages.filter((message: any) => message.role === "custom")).toHaveLength(1);
  expect(second.messages[0].content).toContain("Revised");
  expect(second.messages.at(-1).content).toBe("Continue");
  expect(h.ctx.abort).not.toHaveBeenCalled();
});
it("remembers explicit resume while the old pending continuation is being cancelled", async () => {
  const h = harness();
  await h.emit("session_start");
  h.scheduler.start(h.ctx);
  const old = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  h.scheduler.invalidate();
  h.scheduler.start(h.ctx);
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
  await h.emit("context", { messages: [old] });
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "aborted" }] });
  expect(h.record.goal!.status).toBe("active");
  expect(h.sendMessage).toHaveBeenCalledTimes(2);
});
it("keeps one pending continuation and aborts only an invalid owned request, filtering its reminder", async () => {
  const h = harness();
  await h.emit("session_start");
  h.scheduler.start(h.ctx);
  h.scheduler.start(h.ctx);
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
  const queued = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  h.record.goal!.status = "paused";
  h.scheduler.invalidate();
  const result = await h.emit("context", { messages: [{ role: "assistant", content: [] }, queued] });
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
  expect(result.messages).toHaveLength(1);
  await h.emit("context", { messages: [{ role: "user", content: "Unrelated" }] });
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
});
