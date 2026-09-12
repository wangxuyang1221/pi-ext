import { afterEach, expect, test, vi } from "vitest";
import { GoalPreviewClock } from "../../../prototypes/goal-footer-prototype/src/clock.js";
import { formatMinutes, renderGoalLines, GOAL_FIXTURE } from "../../../prototypes/goal-footer-prototype/src/view.js";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

const theme = {
  fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
  bold: (text: string) => text,
} as Theme;

test("goal footer keeps minute precision and bounds Chinese text at narrow widths", () => {
  expect([0, 59, 60, 3599, 3600, 3660].map(formatMinutes)).toEqual(["<1m", "<1m", "1m", "59m", "1h 00m", "1h 01m"]);
  for (const status of ["active", "paused", "complete"] as const) {
    for (const width of [1, 16, 40, 80, 120]) {
      const lines = renderGoalLines(width, { status, elapsedSeconds: 775, timerWakeups: 0 }, theme);
      expect(lines).toHaveLength(2);
      expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
    }
  }
  const text = renderGoalLines(120, { status: "active", elapsedSeconds: 775, timerWakeups: 0 }, theme).map(stripTerminalSequences).join("\n");
  expect(text).toContain(GOAL_FIXTURE.objective);
  expect(text).toContain("Active · 12m · 12.3k / 80k tokens");
  expect(text).not.toContain("775s");
});

afterEach(() => vi.useRealTimers());

test("pause freezes exact time and completion removes scheduled refreshes", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const clock = new GoalPreviewClock(() => Date.now());
  clock.start(refresh);
  vi.advanceTimersByTime(1_500);
  clock.setStatus("paused");
  expect(vi.getTimerCount()).toBe(0);
  expect(clock.snapshot().elapsedSeconds).toBe(776);
  vi.advanceTimersByTime(90_000);
  expect(clock.snapshot().elapsedSeconds).toBe(776);
  clock.setStatus("active");
  vi.advanceTimersByTime(3_500);
  expect(clock.snapshot().elapsedSeconds).toBe(780);
  expect(clock.snapshot().timerWakeups).toBe(1);
  clock.setStatus("complete");
  expect(vi.getTimerCount()).toBe(0);
  const calls = refresh.mock.calls.length;
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(calls);
  clock.dispose();
});

test("boundary fixture replaces the old timer and samples delayed time without drift", () => {
  vi.useFakeTimers();
  let now = 0;
  const refresh = vi.fn();
  const clock = new GoalPreviewClock(() => now);
  clock.start(refresh);
  clock.reset(778_000);
  expect(vi.getTimerCount()).toBe(1);
  now = 125_000;
  vi.advanceTimersByTime(2_000);
  expect(clock.snapshot().elapsedSeconds).toBe(903);
  expect(clock.snapshot().timerWakeups).toBe(1);
  expect(refresh).toHaveBeenCalledTimes(3);
  clock.dispose();
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(3);
});

test("minute preview wakes only at elapsed-minute boundaries", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const clock = new GoalPreviewClock(() => Date.now(), 12 * 60_000 + 55_000);
  clock.start(refresh);
  expect(clock.snapshot().elapsedSeconds).toBe(775);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(4_999);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(clock.snapshot().elapsedSeconds).toBe(780);
  expect(refresh).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(59_999);
  expect(refresh).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(clock.snapshot().timerWakeups).toBe(2);
  clock.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
