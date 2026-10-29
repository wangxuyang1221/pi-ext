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
  assert.ok(h.counters().region >= 60);
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
  assert.ok(h.counters().normal > 60); assert.equal(h.counters().region, 0);
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
