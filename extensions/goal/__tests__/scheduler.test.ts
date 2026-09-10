import { expect, it, vi } from "vitest";
import { renderGoalPrompt } from "../src/tools.js";
import { registerGoalScheduler } from "../src/scheduler.js";
import { sessionEntryToContextMessages, type ExtensionAPI, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { createSessionCoordinator } from "../../codex-compact/src/session-coordinator.js";
import { fullInputForBranch, NATIVE_COMPACTION_KIND } from "../../codex-compact/src/native-compaction.js";
import type { GoalRecord } from "../src/storage.js";
function harness() {
  let record: GoalRecord = { schemaVersion: 1, recordId: "r", ownerSessionId: "s", cwd: "/test", sessionFile: "/test/s", revision: 1, generation: 1, continuationDeferral: false, recoveredFrom: null, goal: { goalId: "g", generation: 1, objective: "Objective", status: "active", tokensUsed: 0, elapsedSeconds: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01" } };
  const handlers = new Map<string, Function[]>();
  const sendMessage = vi.fn();
  const ctx = { mode: "tui", model: { provider: "openai-codex" }, isIdle: () => false, sessionManager: { getSessionId: () => "s", getSessionFile: () => "/test/s" }, abort: vi.fn(), ui: { notify: vi.fn(), setStatus: vi.fn() } } as unknown as ExtensionContext;
  const emit = async (type: string, event: any = {}) => { let result; for (const fn of handlers.get(type) ?? []) result = await fn(event, ctx); return result; };
  const scheduler = registerGoalScheduler({ on: (type: string, fn: Function) => handlers.set(type, [...handlers.get(type) ?? [], fn]), sendMessage } as unknown as ExtensionAPI, {
    snapshot: () => record,
    stop: async (status, expected) => { expect(expected.goal!.goalId).toBe(record.goal!.goalId); record = { ...record, goal: { ...record.goal!, status } }; },
  });
  return { scheduler, ctx, emit, sendMessage, get record() { return record; } };
}
it("does not enqueue automatic work ahead of pending user messages", async () => {
  const h = harness(); await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  Object.assign(h.ctx, { hasPendingMessages: () => true });
  await h.emit("agent_end", { messages: [{ role: "assistant", content: [], stopReason: "stop" }] });
  expect(h.sendMessage).not.toHaveBeenCalled();
});
it("does not count queued-but-unadmitted work or repeated context retries as empty continuations", async () => {
  const h = harness(); await h.emit("session_start");
  const empty = { role: "assistant", content: [], stopReason: "stop" };
  for (let n = 0; n < 5; n++) {
    const user = { role: "user", content: `Explicit ${n}` };
    await h.emit("message_end", { message: user });
    await h.emit("context", { messages: [user] });
    await h.emit("message_end", { message: empty });
    await h.emit("agent_end", { messages: [empty] });
  }
  expect(h.record.goal!.status).toBe("active");
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
  const queued = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  for (let retry = 0; retry < 5; retry++) await h.emit("context", { messages: [queued] });
  await h.emit("message_end", { message: empty }); await h.emit("agent_end", { messages: [empty] });
  expect(h.record.goal!.status).toBe("active");
  expect(h.sendMessage).toHaveBeenCalledTimes(2);
});
it("does not schedule a goal in a non-persistent session", async () => {
  const h = harness();
  Object.assign(h.ctx.sessionManager, { getSessionFile: () => undefined });
  await h.emit("session_start");
  h.scheduler.start(h.ctx);
  expect(h.sendMessage).not.toHaveBeenCalled();
});
it("blocks after three admitted empty automatic continuations without scheduling a fourth", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  const answer = { role: "assistant", content: [], stopReason: "stop" };
  await h.emit("agent_end", { messages: [answer] });
  for (let turn = 0; turn < 3; turn++) {
    const queued = { role: "custom", ...h.sendMessage.mock.calls.at(-1)![0] };
    await h.emit("context", { messages: [queued] });
    await h.emit("message_end", { message: answer });
    await h.emit("agent_end", { messages: [answer] });
  }
  expect(h.record.goal!.status).toBe("blocked");
  expect(h.sendMessage).toHaveBeenCalledTimes(3);
});
it.each(["text", "thinking", "tool", "failed-tool", "stream", "custom", "input", "compaction", "edit", "resume", "error"])("resets empty auditing on %s activity", async kind => {
  const h = harness();
  await h.emit("session_start");
  const empty = { role: "assistant", content: [{ type: "text", text: " \n " }], stopReason: "stop" };
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  await h.emit("agent_end", { messages: [empty] });
  const admit = async () => h.emit("context", { messages: [{ role: "custom", ...h.sendMessage.mock.calls.at(-1)![0] }] });
  const finish = async () => { await h.emit("message_end", { message: empty }); await h.emit("agent_end", { messages: [empty] }); };
  for (let n = 0; n < 2; n++) { await admit(); await finish(); }
  await admit();
  if (kind === "text" || kind === "thinking") await h.emit("message_end", { message: { ...empty, stopReason: "toolUse", content: [kind === "text" ? { type: "text", text: "Progress" } : { type: "thinking", thinking: "Reasoning" }] } });
  if (kind === "tool" || kind === "failed-tool") await h.emit("tool_result", { toolName: "read", toolCallId: "activity", content: [], isError: kind === "failed-tool" });
  if (kind === "stream") await h.emit("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "Reasoning" } });
  if (kind === "custom") await h.emit("message_end", { message: { role: "custom", customType: "external-question", content: "Question" } });
  if (kind === "input") await h.emit("input", { source: "interactive", text: "Continue" });
  if (kind === "compaction") await h.emit("session_before_compact", { reason: "threshold" });
  if (kind === "edit" || kind === "resume") { h.scheduler.invalidate(); h.scheduler.resume(h.ctx, kind === "edit"); await admit(); }
  if (kind === "error") { await h.emit("agent_end", { messages: [{ ...empty, stopReason: "error" }] }); await h.emit("context", { messages: [] }); }
  await finish();
  expect(h.record.goal!.status).toBe("active");
  for (let n = 0; n < 2; n++) { await admit(); await finish(); expect(h.record.goal!.status).toBe("active"); }
});
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

it("retains all delivered continuation prompts across automatic turns", async () => {
  const h = harness();
  await h.emit("session_start");
  h.scheduler.start(h.ctx);
  const first = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  await h.emit("context", { messages: [first] });
  const answer = { role: "assistant", content: [], stopReason: "stop" };
  await h.emit("agent_end", { messages: [answer] });
  const second = { role: "custom", ...h.sendMessage.mock.calls[1]![0] };
  const messages = [first, answer, second];
  expect((await h.emit("context", { messages })).messages).toEqual(messages);
  expect((await h.emit("context", { messages })).messages).toEqual(messages);
  expect(h.sendMessage).toHaveBeenCalledTimes(2);
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

it("does not reinsert prompts removed by compaction or absent after mid-turn goal creation", async () => {
  const h = harness();
  await h.emit("session_start");
  const user = { role: "user", content: "Finish now" };
  const first = await h.emit("context", { messages: [user] });
  expect(first.messages).toEqual([user]);
  h.record.goal!.tokensUsed = 500;
  const output = { role: "toolResult", content: "Verified" };
  const second = await h.emit("context", { messages: [user, output] });
  expect(second.messages).toEqual([user, output]);
  expect(h.sendMessage).not.toHaveBeenCalled();
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
  expect(filtered.messages).toEqual([pending]);
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
it("steers a live edit past an obsolete pending continuation", async () => {
  const h = harness();
  await h.emit("session_start");
  h.scheduler.start(h.ctx);
  const old = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  h.scheduler.invalidate();
  h.record.goal!.objective = "Revised";
  h.scheduler.resume(h.ctx, true);
  expect(h.sendMessage).toHaveBeenCalledTimes(2);
  expect(h.sendMessage.mock.calls[1]![1]).toEqual({ deliverAs: "steer", triggerTurn: true });
  const revised = { role: "custom", ...h.sendMessage.mock.calls[1]![0] };
  await h.emit("context", { messages: [revised] });
  expect(h.ctx.abort).not.toHaveBeenCalled();
  const final = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Revised progress" }] };
  await h.emit("message_end", { message: final });
  await h.emit("context", { messages: [revised, final, old] });
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
  await h.emit("agent_end", { messages: [final, { role: "assistant", stopReason: "aborted" }] });
  await h.emit("agent_settled");
  expect(h.record.goal!.status).toBe("active");
  expect(h.sendMessage).toHaveBeenCalledTimes(3);
  const next = { role: "custom", ...h.sendMessage.mock.calls[2]![0] };
  expect(next.content).toContain("Revised");
  await h.emit("context", { messages: [revised, final, old, next] });
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
});
it("does not cancel user input delivered beside an obsolete edit ticket", async () => {
  const h = harness();
  await h.emit("session_start");
  h.scheduler.resume(h.ctx, true);
  const old = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  h.scheduler.invalidate();
  h.record.goal!.objective = "Latest";
  await h.emit("input", { source: "interactive", text: "User work" });
  const user = { role: "user", content: "User work" };
  await h.emit("message_end", { message: user });
  const result = await h.emit("context", { messages: [user, old] });
  expect(h.ctx.abort).not.toHaveBeenCalled();
  expect(result.messages).toContainEqual(user);
  expect(result.messages).toEqual([user, old]);
  const replay = await h.emit("context", { messages: [user, old] });
  expect(replay.messages).toEqual(result.messages);
  const model = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-6-astra", reasoning: true, contextWindow: 200_000 } as Model<any>;
  const branch = [{ type: "message", id: "user", parentId: null, message: user },
    { type: "custom_message", id: "discarded", parentId: "user", ...old },
    { type: "custom", id: "checkpoint", parentId: "discarded", customType: NATIVE_COMPACTION_KIND, data: {
      kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: "openai-codex:openai-codex-responses:gpt-6-astra",
      replacementHistory: [{ type: "compaction", encrypted_content: "stable-checkpoint" }],
    } }] as unknown as SessionEntry[];
  const createCheckpoint = vi.fn(async () => { throw new Error("Unexpected remote compaction"); });
  const coordinator = createSessionCoordinator({ getBranch: () => branch, getAllTools: () => [], createCheckpoint, appendCheckpoint: vi.fn(), shouldAutoCompact: () => false });
  Object.assign(h.ctx, { getSystemPrompt: () => "", modelRegistry: { find: () => model } });
  const inputs = [result, replay].map(projected => fullInputForBranch({ model, tools: [], branch: projected.messages.map((message: any, index: number) => message.role === "custom"
    ? { type: "custom_message", id: String(index), ...message } : { type: "message", id: String(index), message }) as SessionEntry[] }));
  expect(inputs[1]).toEqual(inputs[0]);
  for (const input of inputs) expect((await coordinator.prepareRequest(model, h.ctx, input))?.[0]).toEqual({ type: "compaction", encrypted_content: "stable-checkpoint" });
  expect(createCheckpoint).not.toHaveBeenCalled();
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
it("retains the old objective and records the edited prompt once for a new explicit turn", async () => {
  const h = harness();
  await h.emit("session_start");
  const initial = await h.emit("before_agent_start", { prompt: "Work" });
  const old = { role: "custom", ...initial.message };
  await h.emit("context", { messages: [old] });
  h.scheduler.invalidate();
  h.record.goal!.objective = "Revised";
  const revised = await h.emit("before_agent_start", { prompt: "Continue" });
  const messages = [old, { role: "user", content: "Continue" }, { role: "custom", ...revised.message }];
  expect((await h.emit("context", { messages })).messages).toEqual(messages);
  expect(old.content).toContain("Objective");
  expect(revised.message.content).toContain("Revised");
  expect(h.ctx.abort).not.toHaveBeenCalled();
});
it.each(["clear", "blocked", "edit", "reload"])("does not cancel delivered history after %s even when a reminder is last", async change => {
  const h = harness();
  await h.emit("session_start");
  h.scheduler.start(h.ctx);
  const old = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  await h.emit("context", { messages: [old] });
  h.scheduler.invalidate();
  if (change === "clear") h.record.goal = null;
  if (change === "blocked") h.record.goal!.status = "blocked";
  if (change === "edit") h.record.goal!.objective = "Replacement";
  if (change === "reload") {
    await h.emit("session_shutdown");
    await h.emit("session_start");
  }
  expect((await h.emit("context", { messages: [old] })).messages).toEqual([old]);
  expect(h.ctx.abort).not.toHaveBeenCalled();
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
});

it("cancels an undelivered budget request once after clear while keeping its history", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("context", { messages: [{ role: "user", content: "Work" }] });
  h.record.goal!.status = "budget_limited";
  h.scheduler.budget(h.ctx);
  const queued = { role: "custom", ...h.sendMessage.mock.calls[0]![0] };
  h.record.goal = null;
  h.scheduler.invalidate();
  expect((await h.emit("context", { messages: [queued] })).messages).toEqual([queued]);
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
  await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "aborted" }] });
  await h.emit("context", { messages: [queued] });
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
});

it("reuses a native checkpoint across goal history, tool follow-ups, and clear without remote recovery", async () => {
  const h = harness();
  await h.emit("session_start");
  const model = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-6-astra", reasoning: true, contextWindow: 200_000 } as Model<any>;
  const branch: SessionEntry[] = [];
  const append = (entry: object) => branch.push({ id: `entry-${branch.length}`, parentId: branch.at(-1)?.id ?? null, timestamp: "2026-01-01T00:00:00Z", ...entry } as SessionEntry);
  for (let turn = 0; turn < 2; turn++) {
    h.scheduler.start(h.ctx);
    const prompt = h.sendMessage.mock.calls.at(-1)![0];
    append({ type: "custom_message", ...prompt });
    await h.emit("context", { messages: branch.flatMap(sessionEntryToContextMessages) });
  }
  append({ type: "custom", customType: NATIVE_COMPACTION_KIND, data: {
    kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: "openai-codex:openai-codex-responses:gpt-6-astra",
    replacementHistory: [{ type: "compaction", encrypted_content: "offline-checkpoint" }],
  } });
  const createCheckpoint = vi.fn(async () => { throw new Error("Unexpected remote compaction"); });
  const coordinator = createSessionCoordinator({ getBranch: () => branch, getAllTools: () => [], createCheckpoint, appendCheckpoint: vi.fn(), shouldAutoCompact: () => false });
  Object.assign(h.ctx, { getSystemPrompt: () => "", modelRegistry: { find: () => model } });
  for (let step = 0; step < 4; step++) {
    if (step === 0 || step === 2) {
      if (step === 2) { h.record.goal = null; h.scheduler.invalidate(); }
      append({ type: "message", message: { role: "user", content: [{ type: "text", text: `Request ${step}` }], timestamp: step } });
    } else {
      append({ type: "message", message: { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "toolCall", id: `call_${step}`, name: "read", arguments: { path: "report.md" } }], stopReason: "toolUse", timestamp: step } });
      append({ type: "message", message: { role: "toolResult", toolCallId: `call_${step}`, toolName: "read", content: [{ type: "text", text: "Verified" }], isError: false, timestamp: step } });
    }
    const messages = branch.flatMap(sessionEntryToContextMessages);
    const projected = (await h.emit("context", { messages })).messages;
    expect(projected).toEqual(messages);
    // Serialize the hook output, not the unfiltered source branch.
    const inputBranch = projected.map((message: any, index: number) => message.role === "custom"
      ? { type: "custom_message", id: String(index), customType: message.customType, content: message.content, display: message.display, details: message.details }
      : { type: "message", id: String(index), message }) as SessionEntry[];
    const input = fullInputForBranch({ branch: inputBranch, model, tools: [] });
    const result = await coordinator.prepareRequest(model, h.ctx, input);
    expect(result?.[0]).toEqual({ type: "compaction", encrypted_content: "offline-checkpoint" });
  }
  expect(createCheckpoint).not.toHaveBeenCalled();
  expect(h.sendMessage).toHaveBeenCalledTimes(2);
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
it("keeps one pending continuation and aborts an invalid queued request without rewriting history", async () => {
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
  expect(result.messages).toEqual([{ role: "assistant", content: [] }, queued]);
  await h.emit("context", { messages: [{ role: "user", content: "Unrelated" }] });
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
});
