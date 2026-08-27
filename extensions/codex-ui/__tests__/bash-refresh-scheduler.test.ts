import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import { BashRefreshScheduler } from "../src/bash-refresh-scheduler.js";

afterEach(() => {
  vi.useRealTimers();
});

test("bash refresh scheduler finishes a tick from a callback snapshot", () => {
  vi.useFakeTimers();
  const scheduler = new BashRefreshScheduler(1000);
  const calls: string[] = [];

  scheduler.track("first", () => {
    calls.push("first");
    scheduler.untrack("second");
  });
  scheduler.track("second", () => {
    calls.push("second");
  });

  assert.equal(vi.getTimerCount(), 1);
  vi.advanceTimersByTime(1000);
  assert.deepEqual(calls, ["first", "second"]);

  scheduler.dispose();
  assert.equal(vi.getTimerCount(), 0);
});
