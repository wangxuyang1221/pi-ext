import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import { SessionRuntimeHost } from "../src/runtime-host.js";
import { SessionStateStore } from "../src/state-store.js";

const locator = {
  sessionName: "pi-subagents-test",
  windowId: "@7",
  paneId: "%9",
  panePid: 1234,
};

test("persists Pi lifecycle events in the active session partition", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-runtime-test-"));
  const store = new SessionStateStore(root);

  try {
    const host = new SessionRuntimeHost({
      store,
      parent: {
        sessionId: "parent-a",
        epoch: "parent-epoch",
        registrationToken: "registration-a",
      },
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/managed-a",
        displayName: "Lin",
        processInstanceId: "process-a",
      },
      createEpoch: () => "child-epoch",
      now: (() => {
        let tick = 0;
        return () => `2026-08-27T02:00:0${tick++}.000Z`;
      })(),
    });

    await host.startSession({
      sessionId: "child-a",
      cwd: "/repo",
      sessionFile: "/sessions/child-a.jsonl",
      leafId: "user-a",
      pid: 222,
      tmux: locator,
    });
    await host.agentStarted();
    await host.agentStarted();
    await host.leafChanged("assistant-a");
    await host.agentSettled();

    const settled = await store.load("child-a");
    assert.equal(settled?.epoch, "child-epoch");
    assert.equal(settled?.runtime.generation, 1);
    assert.equal(settled?.runtime.settledGeneration, 1);
    assert.equal(settled?.runtime.settledEntryId, "assistant-a");
    assert.equal(settled?.runtime.leafId, "assistant-a");

    await host.shutdown();
    const closed = await store.load("child-a");
    assert.equal(closed?.runtime.status, "closed");
    assert.equal(closed?.runtime.settledGeneration, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
