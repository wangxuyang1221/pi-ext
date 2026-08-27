import assert from "node:assert/strict";
import { test } from "vitest";

import {
  markAgentSettled,
  markAgentStarted,
  markRuntimeStopped,
} from "../src/lifecycle.js";
import { createSessionState } from "../src/state-store.js";

test("counts one generation for a complete busy period", () => {
  const initial = createSessionState({
    sessionId: "agent-a",
    epoch: "epoch-a",
    cwd: "/repo",
    sessionFile: "/sessions/agent-a.jsonl",
    now: "2026-08-27T02:00:00.000Z",
  });

  const firstStart = markAgentStarted(initial, "2026-08-27T02:00:01.000Z");
  assert.equal(firstStart.runtime.generation, 1);
  assert.equal(firstStart.runtime.busy, true);
  assert.equal(firstStart.runtime.status, "running");

  const retryStart = markAgentStarted(firstStart, "2026-08-27T02:00:02.000Z");
  assert.equal(retryStart.runtime.generation, 1);

  const firstSettled = markAgentSettled(
    retryStart,
    "2026-08-27T02:00:03.000Z",
    "assistant-1",
  );
  assert.equal(firstSettled.runtime.busy, false);
  assert.equal(firstSettled.runtime.status, "settled");
  assert.equal(firstSettled.runtime.settledGeneration, 1);
  assert.equal(firstSettled.runtime.settledEntryId, "assistant-1");

  const secondStart = markAgentStarted(firstSettled, "2026-08-27T02:00:04.000Z");
  const followUpStart = markAgentStarted(secondStart, "2026-08-27T02:00:05.000Z");
  assert.equal(followUpStart.runtime.generation, 2);
  assert.equal(followUpStart.runtime.settledGeneration, 1);
});

test("does not settle a generation when the runtime stops", () => {
  const initial = createSessionState({
    sessionId: "agent-a",
    epoch: "epoch-a",
    cwd: "/repo",
    sessionFile: "/sessions/agent-a.jsonl",
    now: "2026-08-27T02:00:00.000Z",
  });
  const busy = markAgentStarted(initial, "2026-08-27T02:00:01.000Z");

  const closed = markRuntimeStopped(busy, "closed", "2026-08-27T02:00:02.000Z");

  assert.equal(closed.runtime.status, "closed");
  assert.equal(closed.runtime.busy, false);
  assert.equal(closed.runtime.generation, 1);
  assert.equal(closed.runtime.settledGeneration, 0);
});
