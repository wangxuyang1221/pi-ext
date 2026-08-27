import assert from "node:assert/strict";
import { test } from "vitest";

import { activateSession } from "../src/runtime-state.js";
import type { LaunchMetadata, ParentOwnership } from "../src/state-store.js";

const parent: ParentOwnership = {
  sessionId: "parent-a",
  epoch: "parent-epoch",
  registrationToken: "registration-a",
};
const launch: LaunchMetadata = {
  cwd: "/repo",
  sessionDir: "/sessions/managed-a",
  displayName: "Lin",
  processInstanceId: "process-a",
};

test("preserves an epoch on resume and creates one after a session switch", () => {
  const first = activateSession(undefined, {
    sessionId: "child-a",
    cwd: "/repo",
    sessionFile: "/sessions/child-a.jsonl",
    now: "2026-08-27T02:00:00.000Z",
    parent,
    launch,
    pid: 101,
    createEpoch: () => "epoch-a",
  });
  first.runtime.generation = 3;
  first.runtime.settledGeneration = 2;

  const resumed = activateSession(first, {
    sessionId: "child-a",
    cwd: "/repo",
    sessionFile: "/sessions/child-a.jsonl",
    now: "2026-08-27T02:01:00.000Z",
    parent: { ...parent, registrationToken: "registration-b" },
    launch: { ...launch, processInstanceId: "process-b" },
    pid: 202,
    createEpoch: () => "must-not-be-used",
  });

  assert.equal(resumed.epoch, "epoch-a");
  assert.equal(resumed.runtime.generation, 3);
  assert.equal(resumed.runtime.settledGeneration, 2);
  assert.equal(resumed.runtime.status, "running");
  assert.equal(resumed.runtime.busy, false);
  assert.equal(resumed.parent?.registrationToken, "registration-b");
  assert.equal(resumed.runtime.pid, 202);

  const switched = activateSession(undefined, {
    sessionId: "child-b",
    cwd: "/repo",
    sessionFile: "/sessions/child-b.jsonl",
    now: "2026-08-27T02:02:00.000Z",
    parent,
    launch,
    pid: 202,
    createEpoch: () => "epoch-b",
  });
  assert.equal(switched.epoch, "epoch-b");
  assert.equal(switched.parent?.sessionId, "parent-a");
});
