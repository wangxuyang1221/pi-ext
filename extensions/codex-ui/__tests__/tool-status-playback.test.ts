import { afterEach, expect, it, vi } from "vitest";
import { playTimeline } from "./fixtures/tool-status/playback.mjs";
import { makeScenario } from "./fixtures/tool-status/scenarios.mjs";

afterEach(() => vi.useRealTimers());

it("plays discrete progress updates and removes the final timer", async () => {
  vi.useFakeTimers();
  const emit = vi.fn();
  const settled = vi.fn();
  const result = playTimeline({ durationMs: 1000, updates: [{ at: 200, text: "first" }, { at: 600, text: "second" }] }, undefined, emit).then(settled);
  await vi.advanceTimersByTimeAsync(199);
  expect(settled).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(401);
  expect(emit.mock.calls).toEqual([["first"], ["second"]]);
  await vi.advanceTimersByTimeAsync(400);
  await result;
  expect(settled).toHaveBeenCalledWith(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels playback without emitting queued progress", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const emit = vi.fn();
  const result = playTimeline({ durationMs: 1000, updates: [{ at: 500, text: "late" }] }, controller.signal, emit);
  await vi.advanceTimersByTimeAsync(200);
  controller.abort();
  expect(vi.getTimerCount()).toBe(0);
  expect(await result).toBe(false);
  await vi.advanceTimersByTimeAsync(2000);
  expect(emit).not.toHaveBeenCalled();
  expect(await playTimeline({ durationMs: 1000 }, controller.signal, emit)).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("gives each batch file a distinct fixed path and mixed outcome", () => {
  for (const tool of ["read", "edit", "write"]) {
    const calls = makeScenario({ tool, batch: true, outcome: "mixed", animate: true });
    expect(calls.map((call: any) => call.outcome)).toEqual(["success", "error", "interrupted"]);
    expect(new Set(calls.map((call: any) => call.args.path)).size).toBe(3);
    expect(calls.every((call: any) => !call.args.path.includes("..") && typeof call.seed === "string")).toBe(true);
  }
  expect(() => makeScenario({ tool: "../../outside" })).toThrow("Unknown fixture scenario");
});

it("cleans up when a progress consumer aborts inside an update", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const result = playTimeline({ durationMs: 1000, updates: [{ at: 200, text: "stop" }] }, controller.signal, () => controller.abort());
  await vi.advanceTimersByTimeAsync(200);
  expect(await result).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
