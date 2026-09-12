import { afterEach, expect, it, vi } from "vitest";
import { formatGoalMinutes, GoalPresentation } from "../src/presentation.js";
import type { GoalRecord } from "../src/storage.js";
const record = { ownerSessionId: "s", goal: { goalId: "g", status: "active", objective: "目标", elapsedSeconds: 0, tokensUsed: 12345, tokenBudget: 80000 } } as GoalRecord;
afterEach(() => vi.useRealTimers());
it("formats minute boundaries without second labels", () => {
  expect([0, 59, 60, 779, 780, 3599, 3600, 3900].map(formatGoalMinutes)).toEqual(["<1m", "<1m", "1m", "12m", "13m", "59m", "1h 00m", "1h 05m"]);
});
it("never schedules invalid delays or keeps timers while suspended", () => {
  vi.useFakeTimers();
  let delay = Number.NaN;
  const view = new GoalPresentation({ publish: vi.fn(), expand: vi.fn(), readTiming: () => ({ elapsedSeconds: 0, nextUpdateMs: delay }) });
  view.update(record);
  expect(vi.getTimerCount()).toBe(0);
  delay = 60000;
  view.update(record);
  expect(vi.getTimerCount()).toBe(1);
  view.update(record, "Storage unavailable", true);
  expect(vi.getTimerCount()).toBe(0);
  expect(view.current!.summary).toContain("Storage unavailable");
  view.update(undefined);
  expect(view.current).toBeUndefined();
  view.dispose();
});
it("expands a content bundle once and rejects late results after goal replacement", async () => {
  vi.useFakeTimers();
  let resolve!: (text: string) => void;
  const expand = vi.fn(() => new Promise<string>(done => { resolve = done; }));
  const publish = vi.fn();
  const view = new GoalPresentation({ publish, expand, readTiming: () => ({ elapsedSeconds: 60, nextUpdateMs: 60000 }) });
  const bundled = { ...record, goal: { ...record.goal!, content: { bundleId: "bundle", digest: "digest", attachments: [] } } };
  view.update(bundled); view.update(bundled);
  expect(expand).toHaveBeenCalledTimes(1);
  expect(view.current!.objective).not.toBe(record.goal!.objective);
  view.update({ ...record, goal: { ...record.goal!, goalId: "new", objective: "新的目标" } });
  resolve("Old bundle objective");
  await Promise.resolve(); await Promise.resolve();
  expect(view.current!.objective).toBe("新的目标");
  view.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps content failures visible without retrying on minute ticks", async () => {
  vi.useFakeTimers();
  const expand = vi.fn().mockRejectedValue(new Error("Checksum mismatch"));
  const view = new GoalPresentation({ publish: vi.fn(), expand, readTiming: () => ({ elapsedSeconds: 60, nextUpdateMs: 60000 }) });
  view.update({ ...record, goal: { ...record.goal!, tokenBudget: undefined, usageIncomplete: true, content: { bundleId: "bundle", digest: "digest", attachments: [] } } });
  await Promise.resolve(); await Promise.resolve();
  expect(view.current!.objective).toBe("Goal content unavailable");
  expect(view.current!.summary).toContain("12.3k tokens · Observed usage only · Open /goal");
  vi.advanceTimersByTime(600000);
  expect(expand).toHaveBeenCalledTimes(1);
  view.dispose();
});

it("publishes once per minute without reading content or republishing unchanged events", () => {
  vi.useFakeTimers();
  const start = Date.now();
  const publish = vi.fn(); const expand = vi.fn();
  const readTiming = vi.fn(() => ({ elapsedSeconds: Math.floor((Date.now() - start) / 1000), nextUpdateMs: 60000 - (Date.now() - start) % 60000 }));
  const view = new GoalPresentation({ readTiming, expand, publish });
  view.update(record);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0]![0].summary).toContain("Active · <1m · 12.3k / 80k tokens");
  vi.advanceTimersByTime(59999);
  expect(readTiming).toHaveBeenCalledTimes(1);
  view.update(record);
  expect(publish).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(540001);
  expect(publish).toHaveBeenCalledTimes(11);
  expect(expand).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
  view.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
