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

test("refuses another process or unmanaged runtime taking over a managed binding", () => {
  const options = { sessionId: "child-a", cwd: "/repo", sessionFile: "/sessions/child-a.jsonl", now: "now", parent, launch, pid: 101, createEpoch: () => "epoch-a" };
  const existing = activateSession(undefined, options);
  assert.throws(() => activateSession(existing, { ...options, launch: { ...launch, processInstanceId: "different" } }), /managed.*instance/u);
  assert.throws(() => activateSession(existing, { ...options, parent: undefined, launch: undefined }), /owner/u);
  assert.throws(() => activateSession(existing, { ...options, pid: 202 }), /managed.*instance/u);
});

test("preserves an epoch on reactivation and creates one after a session switch", () => {
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

  const reactivated = activateSession(first, {
    sessionId: "child-a",
    cwd: "/repo",
    sessionFile: "/sessions/child-a.jsonl",
    now: "2026-08-27T02:01:00.000Z",
    parent,
    launch,
    pid: 101,
    createEpoch: () => "must-not-be-used",
  });

  assert.equal(reactivated.epoch, "epoch-a");
  assert.equal(reactivated.runtime.generation, 3);
  assert.equal(reactivated.runtime.settledGeneration, 2);
  assert.equal(reactivated.runtime.status, "running");
  assert.equal(reactivated.runtime.busy, false);
  assert.equal(reactivated.parent?.registrationToken, "registration-a");
  assert.equal(reactivated.runtime.pid, 101);

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
