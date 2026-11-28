import { Working, workingFrameKey } from "../src/working.js";
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { stripTerminalSequences, type Component, type TUI } from "@earendil-works/pi-tui";
import { createTestUi } from "../../../test-support/pi-ui.js";
import { registerWorking } from "../../../shared/ui/working-session.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function harness() {
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => void>();
  const pi = { on(type: string, handler: (event: any, ctx: ExtensionContext) => void) { handlers.set(type, handler); } } as unknown as ExtensionAPI;
  const install = registerWorking(pi, { widgetKey: "codex-ui-working", Working, frameKey: workingFrameKey });
  let normal = 0;
  let widget: (Component & { dispose?(): void }) | undefined;
  const tui = { requestRender() { normal++; } } as unknown as TUI;
  const ui = createTestUi({ setWidget(_key, factory) {
    widget?.dispose?.();
    widget = typeof factory === "function" ? factory(tui, ui.theme) : undefined;
  } });
  const ctx = { mode: "tui", ui, isIdle: () => true } as ExtensionContext;
  const emit = (type: string, event = {}) => handlers.get(type)?.(event, ctx);
  const session = install(ctx)!;
  const footer = session.bind({ render: () => [session.activity.label() ?? "idle"], invalidate() {} }, tui);
  return { ctx, install, session, footer, emit, widget: () => widget, count: () => normal };
}

test("real extension lifecycle keeps working through ends and dialogs, then releases at settlement", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  h.emit("ui_prompt_start"); assert.equal(h.widget(), undefined);
  h.emit("agent_start");
  assert.equal(h.count(), 1);
  assert.equal(vi.getTimerCount(), 1);
  assert.match(h.widget()!.render(100)[0]!, /\(/u);
  vi.advanceTimersByTime(1000); h.emit("agent_start");
  assert.equal(h.session.activity.elapsed(), 1000); assert.equal(vi.getTimerCount(), 1);
  for (const type of ["agent_end", "ui_prompt_start", "ui_prompt_end", "session_before_compact", "session_compact_failed"]) h.emit(type);
  vi.advanceTimersByTime(1000);
  assert.equal(h.session.activity.active, true);
  assert.equal(h.session.activity.elapsed(), 2000);
  assert.equal(h.count(), 26, "one mount and 25 phase-aligned animation frames");
  const beforeStop = h.count();
  h.emit("agent_settled");
  assert.equal(h.count(), beforeStop + 1);
  assert.equal(h.widget(), undefined); assert.equal(h.session.activity.label(), undefined);
  assert.equal(vi.getTimerCount(), 0);
  h.emit("session_shutdown");
  const counts = h.count(); h.emit("agent_start"); vi.advanceTimersByTime(2000);
  assert.deepEqual(h.count(), counts);
});

test("a queued callback from the previous task cannot schedule or render after restart", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const timers = vi.spyOn(globalThis, "setTimeout");
  const h = harness(); h.emit("agent_start");
  const callback = timers.mock.calls.at(-1)![0] as () => void;
  h.emit("agent_settled"); h.emit("agent_start");
  const before = h.count(); callback();
  assert.deepEqual(h.count(), before); assert.equal(vi.getTimerCount(), 1);
  h.emit("session_shutdown");
});

test("response events feed the production sampler, clear immediately on message_end, and release on reinstallation", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness(); h.emit("agent_start");
  const chunk = "0123456789" + "abcdefghijklmnopqrst" + "++++";
  const partial = fauxAssistantMessage(chunk.repeat(4));
  h.emit("message_start", { message: partial });
  h.emit("message_update", { message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: chunk, partial } });
  assert.deepEqual(h.footer.render(100), ["≈10 tok"]);
  vi.advanceTimersByTime(300);
  h.emit("message_update", { message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: chunk.repeat(3), partial } });
  assert.deepEqual(h.footer.render(100), ["≈100 t/s"]);
  h.emit("message_end", { message: partial });
  assert.deepEqual(h.footer.render(100), ["-- t/s"]);
  h.emit("message_start", { message: { role: "toolResult", content: [] } });
  assert.deepEqual(h.footer.render(100), ["-- t/s"]);
  vi.advanceTimersByTime(2100); assert.deepEqual(h.footer.render(100), ["-- t/s"]);
  assert.equal(h.count(), 31, "one mount and 30 deduplicated animation frames");
  h.install(h.ctx);
  assert.equal(vi.getTimerCount(), 0); assert.equal(h.widget(), undefined);
  h.emit("message_update", { message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(800), partial } });
  assert.equal(h.session.activity.active, false);
  h.emit("session_shutdown");
});

test("headless installation, busy reinstallation and disposed bindings do not leak timers", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  assert.equal(h.install({ ...h.ctx, mode: "rpc" }), undefined);
  h.emit("agent_start"); assert.equal(vi.getTimerCount(), 0);
  const busy = h.install({ ...h.ctx, isIdle: () => false })!;
  assert.equal(vi.getTimerCount(), 1);
  h.emit("session_shutdown"); assert.equal(vi.getTimerCount(), 0);
  let released = 0;
  const component = busy.bind({ render: () => ["stale"], invalidate() {}, dispose() { released++; } }, { requestRender() {} } as unknown as TUI);
  component.dispose?.();
  assert.equal(released, 1);
  busy.start(); assert.equal(vi.getTimerCount(), 0);
});

test("phase-aligned 80ms scheduling handles early wake, cross-boundary dual reads, late wake and slow start", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const timers = vi.spyOn(globalThis, "setTimeout");

  // (a)-(c): spy on elapsed() after start() so mount calls do not consume the queue.
  const h = harness();
  h.emit("agent_start");
  assert.equal(timers.mock.calls.at(-1)![1], 80, "initial start at elapsed=0 schedules 80ms");

  const elapsedSpy = vi.spyOn(h.session.activity, "elapsed");

  // (a) Early wake at 79.5ms (both tick and schedule read 79.5ms): skips redundant render and retries in 1ms.
  elapsedSpy.mockReturnValueOnce(79.5).mockReturnValueOnce(79.5);
  const beforeEarly = h.count();
  (timers.mock.calls.at(-1)![0] as () => void)();
  assert.equal(h.count(), beforeEarly, "early wake at 79.5ms must not double-render frame 0");
  assert.equal(timers.mock.calls.at(-1)![1], 1, "early wake at 79.5ms must schedule 1ms to hit 80ms boundary");

  // (b) Cross-boundary dual read: tick reads 79.9ms (frame 0), schedule reads 80.1ms -> still retries in 1ms, never 80ms.
  elapsedSpy.mockReturnValueOnce(79.9).mockReturnValueOnce(80.1);
  (timers.mock.calls.at(-1)![0] as () => void)();
  assert.equal(h.count(), beforeEarly, "79.9ms observation still sees frame 0");
  assert.equal(timers.mock.calls.at(-1)![1], 1, "cross-boundary 79.9 -> 80.1ms must schedule 1ms, not skip frame 1");

  // Next retry at 81.1ms renders frame 1 and aligns to 160ms (delay = 79ms).
  elapsedSpy.mockReturnValueOnce(81.1).mockReturnValueOnce(81.1);
  (timers.mock.calls.at(-1)![0] as () => void)();
  assert.equal(h.count(), beforeEarly + 1, "retry after cross-boundary wake must render frame 1");
  assert.equal(timers.mock.calls.at(-1)![1], 79, "81.1ms wake aligns next tick to 160ms boundary (79ms)");

  // (c) Late wake at 82ms -> schedules 78ms to prevent cumulative drift.
  elapsedSpy.mockReturnValueOnce(82).mockReturnValueOnce(82);
  (timers.mock.calls.at(-1)![0] as () => void)();
  assert.equal(timers.mock.calls.at(-1)![1], 78, "late wake at 82ms aligns next tick to 160ms boundary (78ms)");
  h.emit("session_shutdown");

  // (d) start() straddling the 80ms boundary (observed 0ms at start, 80.1ms after synchronous widget mount/refresh).
  const slow = harness();
  vi.spyOn(slow.session.activity, "elapsed").mockReturnValueOnce(0).mockReturnValueOnce(80.1);
  slow.emit("agent_start");
  assert.equal(timers.mock.calls.at(-1)![1], 1, "start() crossing 80ms boundary must schedule 1ms, not defer frame 1 to 160ms");
  slow.emit("session_shutdown");
});

test("virtual-routed and faux host models never update calibration even with positive reasoning usage", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  const chunk = "0123456789" + "abcdefghijklmnopqrst" + "++++";

  for (const hostModel of [
    { provider: "pi-virtual", api: "pi-virtual", id: "auto", baseUrl: "https://api.example.com", reasoning: true },
    { provider: "custom-faux", api: "custom-api", id: "faux-1", baseUrl: "http://localhost:0", reasoning: false },
  ]) {
    (h.ctx as unknown as { model: unknown }).model = hostModel;
    const session = h.install(h.ctx)!;
    h.emit("agent_start");
    const msg = {
      ...fauxAssistantMessage(chunk.repeat(10)),
      provider: hostModel.provider === "pi-virtual" ? "openai" : hostModel.provider,
      api: hostModel.provider === "pi-virtual" ? "openai-responses" : hostModel.api,
      model: hostModel.provider === "pi-virtual" ? "gpt-real" : hostModel.id,
      stopReason: "stop" as const,
      usage: {
        input: 100,
        output: 350,
        reasoning: 200,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 450,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    h.emit("message_start", { message: msg });
    h.emit("message_update", { message: msg, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: chunk.repeat(10), partial: msg } });
    h.emit("message_end", { message: msg });
    assert.equal(session.activity.calibration.size(), 0, `expected no calibration for ${hostModel.provider}`);
    h.emit("agent_settled");
  }
  h.emit("session_shutdown");
});

test("install forwards dynamic interrupt key getter to the mounted working widget", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  let key = "f8";
  h.install(h.ctx, () => key);
  h.emit("agent_start");
  assert.match(stripTerminalSequences(h.widget()!.render(100)[0]!), /f8 to interrupt/u);
  key = "";
  assert.doesNotMatch(stripTerminalSequences(h.widget()!.render(100)[0]!), /interrupt/u);
  h.emit("session_shutdown");
});
