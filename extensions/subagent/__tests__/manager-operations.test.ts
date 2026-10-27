import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    await store.update("parent-a", (state) => ({ ...state, reservations: [{
      reservationId: "registration-a", processInstanceId: "process-a",
      createdAt: "2026-08-27T02:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", tmux: locator,
    }] }));
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
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
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
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
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
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
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
      truncated: false,
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
    const assistantText = "A".repeat(64 * 1024);
    const toolCalls = Array.from({ length: 12 }, (_, index) => ({
      type: "toolCall",
      id: `call-${index}`,
      name: "bash",
      arguments: { command: `command-${index}` },
    }));
    const toolResults = toolCalls.map((toolCall, index) => ({
      type: "message",
      id: `result-${index}`,
      parentId: index === 0 ? "assistant-tools" : `result-${index - 1}`,
      timestamp: "2026-08-27T02:00:02.000Z",
      message: {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: "E".repeat(1024) }],
        isError: true,
      },
    }));
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
        message: { role: "user", content: "Run diagnostics" },
      }),
      JSON.stringify({
        type: "message",
        id: "assistant-tools",
        parentId: "user-a",
        timestamp: "2026-08-27T02:00:01.000Z",
        message: {
          role: "assistant",
          content: toolCalls,
          stopReason: "toolUse",
        },
      }),
      ...toolResults.map((entry) => JSON.stringify(entry)),
      JSON.stringify({
        type: "message",
        id: "assistant-a",
        parentId: `result-${toolResults.length - 1}`,
        timestamp: "2026-08-27T02:00:03.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: assistantText }],
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
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close() {},
    };

    const manager = createManager(root, store, runtime);
    const result = await manager.wait("parent-a", "child-a", {
      afterSettled: encodeSettledCursor({
        agentId: "child-a",
        epoch: "child-epoch",
        generation: 1,
      }),
      timeoutMs: 100,
      assistantLimit: 1,
      toolLimit: 20,
    });

    assert.equal(result.outcome, "settled");
    assert.equal(result.generation, 2);
    assert.match(result.settledCursor ?? "", /^sa1\./u);
    const assistant = result.activity.find((activity) => activity.kind === "assistant");
    assert.ok(assistant);
    assert.equal(assistant.text, assistantText);
    assert.equal(assistant.truncated, false);
    assert.equal(result.assistantCount, 1);
    assert.ok(result.toolCount > 0);
    assert.equal(result.omittedAssistant, 0);
    assert.equal(result.omittedTools, toolCalls.length - result.toolCount);
    assert.equal(result.hasMore, true);
    assert.equal(result.returnedBytes, Buffer.byteLength(JSON.stringify(result), "utf8"));
    assert.ok(result.returnedBytes <= 72 * 1024);

    const recent = await manager.read("parent-a", "child-a", {
      view: "recent_activity",
      assistantLimit: 1,
      toolLimit: 20,
    });
    assert.equal(recent.view, "recent_activity");
    assert.ok(recent.toolCount > result.toolCount);
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
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
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
      timeoutMs: 1_000,
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
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
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

test("confirms an enveloped literal prompt from a persisted user turn", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const sessionFile = join(root, "child-a.jsonl");
  const delivered: Array<{ text: string; delivery: string }> = [];
  const confirmationSleeps: number[] = [];
  let alive = true;
  let now = 0;

  try {
    await writeFile(sessionFile, `${JSON.stringify({
      type: "session",
      version: 3,
      id: "child-a",
      timestamp: "2026-08-27T02:00:00.000Z",
      cwd: "/repo",
    })}\n`, "utf8");
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

    let assigned = 0;
    const runtime: ManagedTmuxRuntime = {
      async launch() {
        throw new Error("not used");
      },
      async sendPrompt(_locator, text, delivery) {
        assert.equal(assigned, delivered.length + 1);
        delivered.push({ text, delivery });
        if (delivered.length === 1) {
          assert.match(
            text,
            /^\[subagent:[a-f0-9]{12}\]\n\/quit\nnext {4}line$/u,
          );
          await appendFile(sessionFile, `${JSON.stringify({
            type: "message",
            id: "user-delivery",
            parentId: null,
            timestamp: "2026-08-27T02:00:02.000Z",
            message: { role: "user", content: text },
          })}\n`, "utf8");
          return;
        }
        if (delivered.length === 2) {
          assert.match(text, /^\[subagent:[a-f0-9]{12}\]\n!command\\$/u);
          return;
        }
        if (delivered.length === 3) {
          assert.match(text, /^\[subagent:[a-f0-9]{12}\]\nsteer-queued$/u);
          return;
        }
        assert.match(text, /^\[subagent:[a-f0-9]{12}\]\neditor-only$/u);
      },
      async capturePane() {
        const latest = delivered.at(-1)?.text;
        if (latest?.endsWith("!command\\")) {
          return `Follow-up: ${latest.split("\n")[0]}\n`;
        }
        if (latest?.endsWith("steer-queued")) {
          return `Steering: ${latest.split("\n")[0]}\n`;
        }
        return latest?.endsWith("editor-only") ? latest.split("\n")[0] ?? "" : "";
      },
      async isAlive() {
        return alive;
      },
      async close() {
        alive = false;
      },
    };
    const manager = createManager(root, store, runtime, {
      beforePrompt: async (parentSessionId, assignedChild) => {
        assert.equal(parentSessionId, "parent-a");
        assert.equal(assignedChild.sessionId, "child-a");
        assigned++;
      },
      nowMs: () => now,
      sleep: async (milliseconds) => {
        confirmationSleeps.push(milliseconds);
        now += milliseconds;
      },
    });

    const result = await manager.prompt(
      "parent-a",
      "child-a",
      " \r\n/quit\rnext\tline \t",
      "follow_up",
    );
    assert.equal(result.agent.agentId, "child-a");
    assert.match(result.deliveryId, /^[a-f0-9]{12}$/u);
    assert.equal(result.confirmation, "session");
    assert.deepEqual(delivered, [{
      text: `[subagent:${result.deliveryId}]\n/quit\nnext    line`,
      delivery: "follow_up",
    }]);

    await assert.rejects(
      manager.prompt("parent-a", "child-a", " \t\r\n ", "steer"),
      /empty subagent prompt/u,
    );
    for (const unsafe of [
      "\u0000unsafe",
      "\u000bunsafe",
      "unsafe\u001b[201~",
      "unsafe\u007f",
    ]) {
      await assert.rejects(
        manager.prompt("parent-a", "child-a", unsafe, "steer"),
        /unsafe control character/u,
      );
    }
    assert.equal(delivered.length, 1);

    const queued = await manager.prompt(
      "parent-a",
      "child-a",
      "!command\\",
      "follow_up",
    );
    assert.equal(queued.confirmation, "follow_up_queue");
    assert.match(queued.deliveryId, /^[a-f0-9]{12}$/u);
    assert.equal(delivered.length, 2);

    const steering = await manager.prompt(
      "parent-a",
      "child-a",
      "steer-queued",
      "steer",
    );
    assert.equal(steering.confirmation, "steering_queue");
    assert.match(steering.deliveryId, /^[a-f0-9]{12}$/u);
    assert.equal(delivered.length, 3);

    await assert.rejects(
      manager.prompt("parent-a", "child-a", "editor-only", "steer"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as Error & { code?: string }).code, "delivery_unconfirmed");
        assert.match(
          error.message,
          /delivery_unconfirmed: Child Pi may already have accepted the prompt/u,
        );
        return true;
      },
    );
    assert.equal(now, 1_000);
    assert.deepEqual(confirmationSleeps, Array.from({ length: 20 }, () => 50));
    assert.equal(delivered.length, 4);

    await manager.close("parent-a", "child-a");
    await assert.rejects(
      manager.prompt("parent-a", "child-a", "Too late", "steer"),
      /not a direct child/u,
    );
    assert.equal(delivered.length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes concurrent prompts for the same agent", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const sessionFile = join(root, "child-concurrent.jsonl");
  const sends: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolveGate) => {
    releaseFirst = resolveGate;
  });
  let signalSecond: (() => void) | undefined;
  const secondStarted = new Promise<void>((resolveSecond) => {
    signalSecond = resolveSecond;
  });

  try {
    await writeFile(sessionFile, `${JSON.stringify({
      type: "session",
      version: 3,
      id: "child-concurrent",
      timestamp: "2026-08-27T02:00:00.000Z",
      cwd: "/repo",
    })}\n`, "utf8");
    const child = createSessionState({
      sessionId: "child-concurrent",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile,
      now: "2026-08-27T02:00:00.000Z",
      parent: {
        sessionId: "parent-concurrent",
        epoch: "parent-epoch",
        registrationToken: "registration-a",
      },
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/managed-a",
        displayName: "Concurrent",
        processInstanceId: "process-a",
      },
      tmux: locator,
    });
    child.runtime.status = "settled";
    let parent = createSessionState({
      sessionId: "parent-concurrent",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-concurrent.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
    await store.save(parent);
    await store.save(child);

    const runtime: ManagedTmuxRuntime = {
      async launch() { throw new Error("not used"); },
      async sendPrompt(_locator, text) {
        sends.push(text);
        const sendIndex = sends.length;
        if (sendIndex === 1) await firstGate;
        if (sendIndex === 2) signalSecond?.();
        await appendFile(sessionFile, `${JSON.stringify({
          type: "message",
          id: `user-${sendIndex}`,
          parentId: null,
          timestamp: `2026-08-27T02:00:0${sendIndex + 1}.000Z`,
          message: { role: "user", content: text },
        })}\n`, "utf8");
      },
      async capturePane() { return ""; },
      async isAlive() { return true; },
      async close() {},
    };
    const manager = createManager(root, store, runtime);

    const first = manager.prompt("parent-concurrent", "child-concurrent", "First", "steer");
    while (sends.length === 0) await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
    const second = manager.prompt("parent-concurrent", "child-concurrent", "Second", "steer");
    const secondStartedBeforeRelease = await Promise.race([
      secondStarted.then(() => true),
      new Promise<boolean>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 50)),
    ]);
    releaseFirst?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(secondStartedBeforeRelease, false);
    assert.equal(sends.length, 2);
    assert.notEqual(firstResult.deliveryId, secondResult.deliveryId);
    assert.deepEqual(
      sends.map((text) => text.split("\n").at(-1)),
      ["First", "Second"],
    );
  } finally {
    releaseFirst?.();
    await rm(root, { recursive: true, force: true });
  }
});

function createManager(
  root: string,
  store: SessionStateStore,
  runtime: ManagedTmuxRuntime,
  options: {
    sleep?: (milliseconds: number) => Promise<void>;
    nowMs?: () => number;
    beforePrompt?: NonNullable<ConstructorParameters<typeof SubagentManager>[0]["beforePrompt"]>;
  } = {},
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
