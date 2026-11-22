import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { createTestUi } from "../../../test-support/pi-ui.js";
import { registerWorking } from "../src/working-session.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function harness(local = true) {
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => void>();
  const pi = { on(type: string, handler: (event: any, ctx: ExtensionContext) => void) { handlers.set(type, handler); } } as unknown as ExtensionAPI;
  const install = registerWorking(pi);
  let normal = 0, region = 0, disposed = 0;
  let widget: (Component & { dispose?(): void }) | undefined;
  const tui = { requestRender() { normal++; }, ...(local ? { registerTextRegion() { return { requestRender() { region++; }, dispose() { disposed++; } }; } } : {}) } as unknown as TUI;
  const ui = createTestUi({ setWidget(_key, factory) {
    widget?.dispose?.();
    widget = typeof factory === "function" ? factory(tui, ui.theme) : undefined;
  } });
  const ctx = { mode: "tui", ui, isIdle: () => true } as ExtensionContext;
  const emit = (type: string, event = {}) => handlers.get(type)?.(event, ctx);
  const session = install(ctx)!;
  const footer = session.bind({ render: () => [session.activity.label() ?? "idle"], invalidate() {} }, tui);
  return { ctx, install, session, footer, emit, widget: () => widget, counters: () => ({ normal, region, disposed }) };
}

test("real extension lifecycle keeps working through ends and dialogs, then releases at settlement", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  h.emit("ui_prompt_start"); assert.equal(h.widget(), undefined);
  h.emit("agent_start");
  assert.equal(h.counters().normal, 2);
  assert.equal(vi.getTimerCount(), 1);
  assert.match(h.widget()!.render(100)[0]!, /\(/u);
  vi.advanceTimersByTime(1000); h.emit("agent_start");
  assert.equal(h.session.activity.elapsed(), 1000); assert.equal(vi.getTimerCount(), 1);
  for (const type of ["agent_end", "ui_prompt_start", "ui_prompt_end", "session_before_compact", "session_compact_failed"]) h.emit(type);
  vi.advanceTimersByTime(1000);
  assert.equal(h.session.activity.active, true);
  assert.equal(h.session.activity.elapsed(), 2000);
  assert.equal(h.counters().region, 25, "expected exact 25 phase-aligned 80ms region refreshes over (0, 2000ms]");
  const beforeStop = h.counters().normal;
  h.emit("agent_settled");
  assert.equal(h.counters().normal, beforeStop + 1);
  assert.equal(h.widget(), undefined); assert.equal(h.session.activity.label(), undefined);
  assert.equal(vi.getTimerCount(), 0);
  h.emit("session_shutdown");
  const counts = h.counters(); h.emit("agent_start"); vi.advanceTimersByTime(2000);
  assert.deepEqual(h.counters(), counts);
});

test("a queued callback from the previous task cannot schedule or render after restart", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const timers = vi.spyOn(globalThis, "setTimeout");
  const h = harness(); h.emit("agent_start");
  const callback = timers.mock.calls.at(-1)![0] as () => void;
  h.emit("agent_settled"); h.emit("agent_start");
  const before = h.counters(); callback();
  assert.deepEqual(h.counters(), before); assert.equal(vi.getTimerCount(), 1);
  h.emit("session_shutdown");
});

test("response events feed the production sampler, while reinstall and fallback remain isolated", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness(false); h.emit("agent_start");
  const partial = fauxAssistantMessage("abcdefgh".repeat(10));
  h.emit("message_start", { message: partial });
  h.emit("message_update", { message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "abcdefgh", partial } });
  assert.deepEqual(h.footer.render(100), ["≈1 t/s"]);
  h.emit("message_end", { message: partial });
  assert.deepEqual(h.footer.render(100), ["≈10 t/s"]);
  h.emit("message_start", { message: { role: "toolResult", content: [] } });
  assert.deepEqual(h.footer.render(100), ["≈10 t/s"]);
  vi.advanceTimersByTime(2100); assert.deepEqual(h.footer.render(100), ["-- t/s"]);
  assert.equal(h.counters().normal, 28, "expected 2 mount refreshes + 26 deduplicated 80ms ticks over (0, 2100ms]");
  assert.equal(h.counters().region, 0);
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

test("80ms ticks skip unchanged frames and only refresh footer regions when rate label changes", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => void>();
  const pi = { on(type: string, handler: (event: any, ctx: ExtensionContext) => void) { handlers.set(type, handler); } } as unknown as ExtensionAPI;
  const install = registerWorking(pi);
  let workingRenders = 0;
  let footerRenders = 0;
  let widget: (Component & { dispose?(): void }) | undefined;
  let footerComponent: Component | undefined;
  const tui = {
    requestRender() {},
    registerTextRegion(component: Component) {
      return {
        requestRender() {
          if (component === footerComponent) footerRenders++;
          else workingRenders++;
        },
        dispose() {},
      };
    },
  } as unknown as TUI;
  const ui = createTestUi({
    setWidget(_key, factory) {
      widget?.dispose?.();
      widget = typeof factory === "function" ? factory(tui, ui.theme) : undefined;
    },
  });
  const ctx = { mode: "tui", ui, isIdle: () => true } as ExtensionContext;
  const emit = (type: string, event = {}) => handlers.get(type)?.(event, ctx);
  const session = install(ctx)!;
  footerComponent = session.bind({ render: () => [session.activity.label() ?? "idle"], invalidate() {} }, tui);
  emit("agent_start");
  vi.advanceTimersByTime(2000);
  // Silent run: footer rate stays "-- t/s" so footer receives zero tick renders while working fires 25 80ms ticks.
  assert.equal(footerRenders, 0);
  assert.equal(workingRenders, 25, `expected 25 working renders over 2000ms, got ${workingRenders}`);
  const partial = fauxAssistantMessage("abcdefgh".repeat(10));
  emit("message_start", { message: partial });
  emit("message_update", { message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "abcdefgh", partial } });
  vi.advanceTimersByTime(80);
  assert.ok(footerRenders >= 1, "rate change should refresh footer region on next 80ms tick");
  const afterDelta = footerRenders;
  vi.advanceTimersByTime(2100);
  assert.ok(footerRenders > afterDelta, "rate decay back to -- t/s should refresh footer region");
  emit("session_shutdown");
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
  const beforeEarly = h.counters().region;
  (timers.mock.calls.at(-1)![0] as () => void)();
  assert.equal(h.counters().region, beforeEarly, "early wake at 79.5ms must not double-render frame 0");
  assert.equal(timers.mock.calls.at(-1)![1], 1, "early wake at 79.5ms must schedule 1ms to hit 80ms boundary");

  // (b) Cross-boundary dual read: tick reads 79.9ms (frame 0), schedule reads 80.1ms -> still retries in 1ms, never 80ms.
  elapsedSpy.mockReturnValueOnce(79.9).mockReturnValueOnce(80.1);
  (timers.mock.calls.at(-1)![0] as () => void)();
  assert.equal(h.counters().region, beforeEarly, "79.9ms observation still sees frame 0");
  assert.equal(timers.mock.calls.at(-1)![1], 1, "cross-boundary 79.9 -> 80.1ms must schedule 1ms, not skip frame 1");

  // Next retry at 81.1ms renders frame 1 and aligns to 160ms (delay = 79ms).
  elapsedSpy.mockReturnValueOnce(81.1).mockReturnValueOnce(81.1);
  (timers.mock.calls.at(-1)![0] as () => void)();
  assert.equal(h.counters().region, beforeEarly + 1, "retry after cross-boundary wake must render frame 1");
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
