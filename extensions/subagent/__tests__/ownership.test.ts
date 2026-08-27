import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getDirectChild,
  registerDirectChild,
} from "../src/ownership.js";
import {
  createSessionState,
  type LaunchMetadata,
  type ParentOwnership,
  type SessionState,
} from "../src/state-store.js";

const parentOwnership: ParentOwnership = {
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

test("rejects child registration from a managed parent", () => {
  const managedParent = childState("child-a");
  const nestedChild = createSessionState({
    sessionId: "grandchild-a",
    epoch: "grandchild-epoch",
    cwd: "/repo",
    sessionFile: "/sessions/grandchild-a.jsonl",
    now: "2026-08-27T02:00:00.000Z",
    parent: {
      sessionId: managedParent.sessionId,
      epoch: managedParent.epoch,
      registrationToken: "registration-b",
    },
    launch: {
      ...launch,
      processInstanceId: "process-b",
    },
  });

  assert.throws(
    () => registerDirectChild(managedParent, nestedChild, "2026-08-27T02:00:01.000Z"),
    /Managed sessions cannot register children/u,
  );
});

test("keeps a switched child session as another direct child", () => {
  let parent = createSessionState({
    sessionId: "parent-a",
    epoch: "parent-epoch",
    cwd: "/repo",
    sessionFile: "/sessions/parent-a.jsonl",
    now: "2026-08-27T02:00:00.000Z",
  });
  const oldChild = childState("child-old");
  const switchedChild = childState("child-new");

  parent = registerDirectChild(parent, oldChild, "2026-08-27T02:00:01.000Z");
  parent = registerDirectChild(parent, switchedChild, "2026-08-27T02:00:02.000Z");

  assert.deepEqual(parent.children.map((child) => child.agentId), ["child-old", "child-new"]);
  assert.equal(getDirectChild(parent, "child-new").launch.processInstanceId, "process-a");

  const withGrandchild: SessionState = {
    ...parent,
    children: [{
      ...parent.children[0],
      agentId: "child-old",
    }],
  };
  assert.throws(
    () => getDirectChild(withGrandchild, "grandchild-a"),
    /not a direct child/u,
  );
});

function childState(sessionId: string): SessionState {
  return createSessionState({
    sessionId,
    epoch: `${sessionId}-epoch`,
    cwd: "/repo",
    sessionFile: `/sessions/${sessionId}.jsonl`,
    now: "2026-08-27T02:00:00.000Z",
    parent: parentOwnership,
    launch,
    processInstanceId: launch.processInstanceId,
  });
}
