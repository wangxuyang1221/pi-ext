import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerTerminalTitleSpinner, TerminalTitleSpinner } from "../src/terminal-title.js";

function harness(mode = "tui") {
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => void>>();
  const titles: string[] = [];
  let name = "";
  let idle = true;
  const pi = {
    getSessionName: () => name,
    on(event: string, handler: (event: any, ctx: ExtensionContext) => void) {
      const listeners = handlers.get(event) ?? []; listeners.push(handler); handlers.set(event, listeners);
    },
  } as unknown as ExtensionAPI;
  const install = registerTerminalTitleSpinner(pi);
  const ctx = { mode, cwd: "/repo/pi-ext", isIdle: () => idle,
    ui: { setTitle: (title: string) => titles.push(title) } } as unknown as ExtensionContext;
  const emit = (type: string, event = {}) => handlers.get(type)?.forEach(handler => handler(event, ctx));
  return { install: () => install(ctx), titles, emit, rename(value: string) { name = value; emit("session_info_changed", { name }); },
    setIdle(value: boolean) { idle = value; }, dispose: () => emit("session_shutdown") };
}
afterEach(() => vi.useRealTimers());

test("delayed title ticks skip missed frames without catch-up writes or a second timer", () => {
  let now = 0;
  let pending: (() => void) | undefined;
  let delay = 0;
  const titles: string[] = [];
  const spinner = new TerminalTitleSpinner(title => titles.push(title), "π · fixture", () => now, (callback, wait) => {
    assert.equal(pending, undefined);
    pending = callback; delay = wait;
    return () => { pending = undefined; };
  });
  spinner.start();
  now = 350;
  const tick = pending; pending = undefined; tick?.();
  assert.deepEqual(titles, ["⠋ π · fixture", "⠼ π · fixture"]);
  assert.equal(delay, 50);
  spinner.start();
  assert.equal(titles.length, 2);
  spinner.setBaseTitle("π · renamed");
  assert.equal(titles.at(-1), "⠼ π · renamed");
  assert.equal(delay, 50);
  spinner.stop();
  assert.equal(pending, undefined);
  assert.equal(titles.at(-1), "π · renamed");
  spinner.stop();
  assert.equal(titles.length, 4);
});

test("non-TUI events and post-shutdown events never write titles or create timers", () => {
  vi.useFakeTimers();
  for (const mode of ["rpc", "print", "json"]) {
    const h = harness(mode);
    h.install();
    for (const event of ["agent_start", "session_before_compact", "session_compact", "session_compact_failed", "agent_settled"]) h.emit(event);
    h.rename("name"); h.dispose();
    assert.deepEqual(h.titles, []);
    assert.equal(vi.getTimerCount(), 0);
  }
});

test("terminal title spins at 80ms throughout a run and restores the static title on settlement", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  try {
    h.install();
    assert.deepEqual(h.titles, ["π · pi-ext"]);
    assert.equal(vi.getTimerCount(), 0);
    h.emit("agent_start");
    assert.equal(h.titles.at(-1), "⠋ π · pi-ext");
    vi.advanceTimersByTime(80);
    assert.equal(h.titles.at(-1), "⠙ π · pi-ext");
    vi.advanceTimersByTime(80);
    assert.equal(h.titles.at(-1), "⠹ π · pi-ext");
    h.emit("agent_start");
    assert.equal(vi.getTimerCount(), 1);
    assert.equal(h.titles.at(-1), "⠹ π · pi-ext");
    h.emit("agent_end");
    vi.advanceTimersByTime(80);
    assert.equal(h.titles.at(-1), "⠸ π · pi-ext");
    h.emit("agent_settled");
    assert.equal(h.titles.at(-1), "π · pi-ext");
    assert.equal(vi.getTimerCount(), 0);
    const length = h.titles.length;
    vi.advanceTimersByTime(1000);
    assert.equal(h.titles.length, length);
  } finally { h.dispose(); }
});

test("compaction, renames, and busy reinstalls preserve activity without leaking timers", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  try {
    h.install();
    h.emit("session_before_compact");
    assert.equal(vi.getTimerCount(), 1);
    h.emit("session_compact_failed");
    assert.equal(vi.getTimerCount(), 0);
    h.emit("agent_start");
    vi.advanceTimersByTime(80);
    h.emit("agent_end");
    h.emit("session_before_compact");
    h.rename("修复\n布局\x1b]0;injected\x07");
    assert.equal(h.titles.at(-1), "⠙ π · 修复 布局 · pi-ext");
    h.emit("session_compact");
    vi.advanceTimersByTime(80);
    assert.equal(h.titles.at(-1), "⠹ π · 修复 布局 · pi-ext");
    assert.equal(vi.getTimerCount(), 1);
    h.emit("agent_settled");
    h.setIdle(false); h.install();
    assert.equal(vi.getTimerCount(), 1);
    h.dispose();
    assert.equal(vi.getTimerCount(), 0);
    const count = h.titles.length;
    h.emit("agent_start"); vi.advanceTimersByTime(800);
    assert.equal(h.titles.length, count);
  } finally { h.dispose(); }
});
