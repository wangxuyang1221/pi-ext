import assert from "node:assert/strict";
import { test } from "vitest";

import { encodeSettledCursor } from "../src/cursor.js";
import { waitForSettled } from "../src/wait.js";
import type { SessionState } from "../src/state-store.js";

const baseState: SessionState = {
  schemaVersion: 3,
  sessionId: "agent-a",
  epoch: "epoch-a",
  runtime: {
    status: "settled",
    busy: false,
    generation: 1,
    settledGeneration: 1,
    cwd: "/repo",
    sessionFile: "/sessions/agent-a.jsonl",
    updatedAt: "2026-08-27T02:00:00.000Z",
  },
  children: [],
  reservations: [],
};

test("times out a hanging query and propagates cancellation to it", async () => {
  let querySignal: AbortSignal | undefined;
  const waiting = waitForSettled({
    agentId: "agent-a", afterSettled: encodeSettledCursor({ agentId: "agent-a", epoch: "epoch-a", generation: 1 }),
    timeoutMs: 10, readState: async () => baseState,
    isAlive: async (_state, signal?: AbortSignal) => { querySignal = signal; return new Promise<boolean>(() => {}); },
  });
  let timer: ReturnType<typeof setTimeout>;
  const result = await Promise.race([waiting, new Promise<undefined>(resolve => { timer = setTimeout(resolve, 100); })]);
  clearTimeout(timer!);
  assert.equal(result?.outcome, "timeout");
  assert.equal(querySignal?.aborted, true);
});

test("waits for a newer settled generation", async () => {
  const snapshots: SessionState[] = [
    baseState,
    {
      ...baseState,
      runtime: {
        ...baseState.runtime,
        status: "running",
        busy: true,
        generation: 2,
      },
    },
    {
      ...baseState,
      runtime: {
        ...baseState.runtime,
        generation: 2,
        settledGeneration: 2,
      },
    },
  ];
  let clock = 1_000;

  const result = await waitForSettled({
    agentId: "agent-a",
    afterSettled: encodeSettledCursor({
      agentId: "agent-a",
      epoch: "epoch-a",
      generation: 1,
    }),
    timeoutMs: 1_000,
    pollIntervalMs: 10,
    readState: async () => snapshots.shift() ?? baseState,
    isAlive: async () => true,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  });

  assert.equal(result.outcome, "settled");
  assert.equal(result.generation, 2);
  assert.equal(result.durationMs, 20);
  assert.match(result.settledCursor, /^sa1\./u);
});

test("waits through closing until terminal state deletion is visible", async () => {
  const snapshots: Array<SessionState | undefined> = [{
    ...baseState,
    runtime: {
      ...baseState.runtime,
      status: "closing",
      generation: 2,
    },
  }, undefined];
  let closed = false;
  let clock = 1_000;

  const result = await waitForSettled({
    agentId: "agent-a",
    afterSettled: encodeSettledCursor({
      agentId: "agent-a",
      epoch: "epoch-a",
      generation: 1,
    }),
    timeoutMs: 1_000,
    pollIntervalMs: 10,
    readState: async () => snapshots.shift(),
    wasClosed: async () => closed,
    isAlive: async () => false,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
      closed = true;
    },
  });

  assert.equal(result.outcome, "closed");
  assert.equal(result.generation, 2);
});

test("reports an explicit parent close even when child state is stale", async () => {
  const staleBusy: SessionState = {
    ...baseState,
    runtime: {
      ...baseState.runtime,
      status: "running",
      busy: true,
      generation: 2,
    },
  };

  const result = await waitForSettled({
    agentId: "agent-a",
    afterSettled: encodeSettledCursor({
      agentId: "agent-a",
      epoch: "epoch-a",
      generation: 1,
    }),
    timeoutMs: 1_000,
    readState: async () => staleBusy,
    wasClosed: async () => true,
    isAlive: async () => false,
  });

  assert.equal(result.outcome, "closed");
  assert.equal(result.generation, 2);
});
