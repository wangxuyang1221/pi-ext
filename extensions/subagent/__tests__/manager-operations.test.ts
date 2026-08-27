import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import { encodeSettledCursor } from "../src/cursor.js";
import { SubagentManager, type ManagedTmuxRuntime } from "../src/manager.js";
import { registerDirectChild } from "../src/ownership.js";
import {
  SessionStateStore,
  createSessionState,
  type TmuxLocator,
} from "../src/state-store.js";

const locator: TmuxLocator = {
  sessionName: "pi-subagents-test",
  windowId: "@7",
  paneId: "%9",
  panePid: 1234,
};

test("lists switched sessions as direct children without including descendants", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);

  try {
    await store.save(createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    }));
    for (const agentId of ["child-old", "child-new"]) {
      await store.save(createSessionState({
        sessionId: agentId,
        epoch: `${agentId}-epoch`,
        cwd: "/repo",
        sessionFile: `/sessions/${agentId}.jsonl`,
        now: agentId === "child-old"
          ? "2026-08-27T02:00:01.000Z"
          : "2026-08-27T02:00:02.000Z",
        parent: {
          sessionId: "parent-a",
          epoch: "parent-epoch",
          registrationToken: "registration-a",
        },
        launch: {
          cwd: "/repo",
          sessionDir: "/sessions/managed-a",
          displayName: agentId,
          processInstanceId: "process-a",
        },
        tmux: locator,
      }));
    }
    await store.save(createSessionState({
      sessionId: "grandchild-a",
      epoch: "grandchild-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/grandchild-a.jsonl",
      now: "2026-08-27T02:00:03.000Z",
      parent: {
        sessionId: "child-new",
        epoch: "child-new-epoch",
        registrationToken: "registration-b",
      },
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/grandchild-a",
        displayName: "Grandchild",
        processInstanceId: "process-b",
      },
      tmux: { ...locator, windowId: "@8", paneId: "%10", panePid: 5678 },
    }));

    const runtime: ManagedTmuxRuntime = {
      async launch() {
        throw new Error("not used");
      },
      async sendPrompt() {},
      async isAlive() {
        return true;
      },
      async close() {},
    };
    const result = await createManager(root, store, runtime).list("parent-a");

    assert.deepEqual(result.agents.map((agent) => agent.agentId), ["child-new", "child-old"]);
    assert.deepEqual(result.capacity, {
      active: 1,
      pending: 0,
      limit: 3,
      available: 2,
    });
    assert.deepEqual((await store.load("parent-a"))?.children.map((child) => child.agentId), [
      "child-new",
      "child-old",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a managed child with nested ownership during list", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);

  try {
    const child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
      parent: {
        sessionId: "parent-a",
        epoch: "parent-epoch",
        registrationToken: "registration-a",
      },
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/child-a",
        displayName: "Lin",
        processInstanceId: "process-a",
      },
      tmux: locator,
    });
    child.children = [{
      agentId: "grandchild-a",
      epoch: "grandchild-epoch",
      name: "Grandchild",
      cwd: "/repo",
      sessionFile: "/sessions/grandchild-a.jsonl",
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/grandchild-a",
        displayName: "Grandchild",
        processInstanceId: "process-b",
      },
      createdAt: "2026-08-27T02:00:00.000Z",
      updatedAt: "2026-08-27T02:00:00.000Z",
    }];
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
    await store.save(parent);
    await store.save(child);
    const runtime: ManagedTmuxRuntime = {
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close() {},
    };

    await assert.rejects(
      createManager(root, store, runtime).list("parent-a"),
      /Subagent topology corruption: managed child has children: child-a/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads finalized in-flight activity beyond a stale lifecycle leaf", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const sessionFile = join(root, "native-child.jsonl");

  try {
    await writeFile(sessionFile, [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "child-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      }),
      JSON.stringify({
        type: "message",
        id: "user-a",
        parentId: null,
        timestamp: "2026-08-27T02:00:00.500Z",
        message: {
          role: "user",
          content: "Inspect the current run",
        },
      }),
      JSON.stringify({
        type: "message",
        id: "assistant-a",
        parentId: "user-a",
        timestamp: "2026-08-27T02:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Finished" }],
          stopReason: "stop",
        },
      }),
      "",
    ].join("\n"), "utf8");
    const child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile,
      now: "2026-08-27T02:00:00.000Z",
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
      tmux: locator,
    });
    child.runtime.busy = true;
    child.runtime.generation = 1;
    child.runtime.leafId = "user-a";
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
    await store.save(parent);
    await store.save(child);
    const runtime: ManagedTmuxRuntime = {
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close() {},
    };

    const result = await createManager(root, store, runtime).read("parent-a", "child-a", {
      view: "recent_activity",
      assistantLimit: 1,
      toolLimit: 1,
    });

    assert.equal(result.view, "recent_activity");
    assert.deepEqual(result.activity, [{
      kind: "assistant",
      id: "assistant-a",
      timestamp: "2026-08-27T02:00:01.000Z",
      text: "Finished",
      stopReason: "stop",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns bounded activity only after a newer settled generation", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const sessionFile = join(root, "settled-child.jsonl");

  try {
    await writeFile(sessionFile, [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "child-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      }),
      JSON.stringify({
        type: "message",
        id: "assistant-a",
        parentId: null,
        timestamp: "2026-08-27T02:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Settled result" }],
          stopReason: "stop",
        },
      }),
      "",
    ].join("\n"), "utf8");
    const child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile,
      now: "2026-08-27T02:00:00.000Z",
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
      tmux: locator,
    });
    child.runtime.status = "settled";
    child.runtime.generation = 2;
    child.runtime.settledGeneration = 2;
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
    await store.save(parent);
    await store.save(child);
    const runtime: ManagedTmuxRuntime = {
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close() {},
    };

    const result = await createManager(root, store, runtime).wait("parent-a", "child-a", {
      afterSettled: encodeSettledCursor({
        agentId: "child-a",
        epoch: "child-epoch",
        generation: 1,
      }),
      timeoutMs: 100,
      assistantLimit: 1,
      toolLimit: 1,
    });

    assert.equal(result.outcome, "settled");
    assert.equal(result.generation, 2);
    assert.match(result.settledCursor ?? "", /^sa1\./u);
    assert.deepEqual(result.activity, [{
      kind: "assistant",
      id: "assistant-a",
      timestamp: "2026-08-27T02:00:01.000Z",
      text: "Settled result",
      stopReason: "stop",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists an interruption observed while waiting", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);

  try {
    const child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
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
      processInstanceId: "process-a",
      tmux: locator,
    });
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
    await store.save(parent);
    await store.save(child);
    const runtime: ManagedTmuxRuntime = {
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return false; },
      async close() {},
    };
    const manager = createManager(root, store, runtime);

    const result = await manager.wait("parent-a", "child-a", {
      afterSettled: encodeSettledCursor({
        agentId: "child-a",
        epoch: "child-epoch",
        generation: 0,
      }),
      timeoutMs: 100,
    });

    assert.equal(result.outcome, "interrupted");
    assert.equal(result.agent.status, "interrupted");
    assert.equal((await store.load("child-a"))?.runtime.status, "interrupted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns closed when terminal close deletes state during wait", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  let alive = true;
  let releaseSleep: (() => void) | undefined;
  let markSleeping: (() => void) | undefined;
  const sleeping = new Promise<void>((resolve) => {
    markSleeping = resolve;
  });

  try {
    const child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
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
      processInstanceId: "process-a",
      tmux: locator,
    });
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
    await store.save(parent);
    await store.save(child);
    const runtime: ManagedTmuxRuntime = {
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return alive; },
      async close() { alive = false; },
    };
    const manager = createManager(root, store, runtime, {
      sleep: async () => {
        markSleeping?.();
        await new Promise<void>((resolve) => {
          releaseSleep = resolve;
        });
      },
    });
    const waiting = manager.wait("parent-a", "child-a", {
      afterSettled: encodeSettledCursor({
        agentId: "child-a",
        epoch: "child-epoch",
        generation: 0,
      }),
      timeoutMs: 1_000,
    });
    await sleeping;

    await manager.close("parent-a", "child-a");
    releaseSleep?.();
    const result = await waiting;

    assert.equal(result.outcome, "closed");
    assert.equal(result.agent.status, "closed");
  } finally {
    releaseSleep?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("prompts only a live direct child", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const delivered: Array<{ text: string; delivery: string }> = [];
  let alive = true;

  try {
    const child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
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
      tmux: locator,
    });
    child.runtime.status = "settled";
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
    await store.save(parent);
    await store.save(child);

    const runtime: ManagedTmuxRuntime = {
      async launch() {
        throw new Error("not used");
      },
      async sendPrompt(_locator, text, delivery) {
        delivered.push({ text, delivery });
      },
      async isAlive() {
        return alive;
      },
      async close() {
        alive = false;
      },
    };
    const manager = createManager(root, store, runtime);

    await manager.prompt("parent-a", "child-a", "Review the failure", "follow_up");
    assert.deepEqual(delivered, [{ text: "Review the failure", delivery: "follow_up" }]);

    await manager.close("parent-a", "child-a");
    await assert.rejects(
      manager.prompt("parent-a", "child-a", "Too late", "steer"),
      /not a direct child/u,
    );
    assert.equal(delivered.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function createManager(
  root: string,
  store: SessionStateStore,
  runtime: ManagedTmuxRuntime,
  options: { sleep?: (milliseconds: number) => Promise<void> } = {},
): SubagentManager {
  return new SubagentManager({
    ...options,
    store,
    runtime,
    stateRoot: root,
    nativeSessionRoot: join(root, "native-sessions"),
    extensionPath: "/package/extensions/subagent/dist/index.js",
    piPath: "/usr/local/bin/pi",
    environment: { PATH: "/usr/local/bin:/usr/bin" },
  });
}
