import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test, vi } from "vitest";

import subagentExtension from "../src/index.js";
import type { ManagedTmuxRuntime } from "../src/manager.js";
import { SessionStateStore } from "../src/state-store.js";

const eventNames = [
  "session_start",
  "session_shutdown",
  "agent_start",
  "agent_settled",
  "session_tree",
];

test("wires the public tools to Pi session lifecycle events", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  const store = new SessionStateStore(root);
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const tools: Array<{ name: string }> = [];
  const runtime: ManagedTmuxRuntime = {
    async launch() { throw new Error("not used"); },
    async sendPrompt() {},
    async isAlive() { return true; },
    async close() {},
  };
  const pi = {
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      handlers.set(event, handler);
    }),
    registerTool: vi.fn((tool: { name: string }) => {
      tools.push(tool);
    }),
    exec: vi.fn(),
  };
  let leafId = "user-a";
  const ctx = {
    cwd: "/repo",
    sessionManager: {
      getSessionId: () => "parent-a",
      getSessionFile: () => "/sessions/parent-a.jsonl",
      getLeafId: () => leafId,
    },
  };

  try {
    subagentExtension(pi as never, {
      env: { PATH: "/usr/bin" },
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      store,
      runtime,
      createId: () => "parent-epoch",
      now: () => "2026-08-27T02:00:00.000Z",
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
    });

    assert.equal(tools.length, 6);
    assert.deepEqual(eventNames.filter((name) => handlers.has(name)), eventNames);

    await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    await handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    await handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    leafId = "assistant-a";
    await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);

    const state = await store.load("parent-a");
    assert.equal(state?.epoch, "parent-epoch");
    assert.equal(state?.runtime.generation, 1);
    assert.equal(state?.runtime.settledGeneration, 1);
    assert.equal(state?.runtime.settledEntryId, "assistant-a");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails fast when PI_SUBAGENT_MAX_ACTIVE is not a positive integer", () => {
  const pi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    exec: vi.fn(),
  };
  const runtime: ManagedTmuxRuntime = {
    async launch() { throw new Error("not used"); },
    async sendPrompt() {},
    async isAlive() { return true; },
    async close() {},
  };

  assert.throws(
    () => subagentExtension(pi as never, {
      env: { PATH: "/usr/bin", PI_SUBAGENT_MAX_ACTIVE: "0" },
      stateRoot: "/tmp/subagent-invalid-max-active",
      nativeSessionRoot: "/tmp/subagent-invalid-max-active-native",
      runtime,
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
    }),
    /Invalid PI_SUBAGENT_MAX_ACTIVE: expected a positive integer/u,
  );
});

test("keeps managed-child lifecycle hooks without registering orchestration tools", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  const store = new SessionStateStore(root);
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const tools: Array<{ name: string }> = [];
  const runtime = {
    async launch() { throw new Error("not used"); },
    async sendPrompt() {},
    async isAlive() { return true; },
    async close() {},
    async locatePane(paneId: string) {
      assert.equal(paneId, "%9");
      return {
        sessionName: "pi-subagents-test",
        windowId: "@7",
        paneId,
        panePid: 1234,
      };
    },
  };
  const pi = {
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      handlers.set(event, handler);
    }),
    registerTool: vi.fn((tool: { name: string }) => {
      tools.push(tool);
    }),
    exec: vi.fn(),
  };
  const ctx = {
    cwd: "/repo",
    sessionManager: {
      getSessionId: () => "child-a",
      getSessionFile: () => "/sessions/child-a.jsonl",
      getLeafId: () => "assistant-a",
    },
  };

  try {
    subagentExtension(pi as never, {
      env: {
        PATH: "/usr/bin",
        TMUX_PANE: "%9",
        PI_SUBAGENT_PARENT: JSON.stringify({
          sessionId: "parent-a",
          epoch: "parent-epoch",
          registrationToken: "registration-a",
        }),
        PI_SUBAGENT_LAUNCH: JSON.stringify({
          cwd: "/repo",
          sessionDir: "/sessions/managed-a",
          displayName: "Lin",
          processInstanceId: "process-a",
        }),
      },
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      store,
      runtime,
      createId: () => "child-epoch",
      now: () => "2026-08-27T02:00:00.000Z",
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
    });

    assert.deepEqual(tools, []);
    assert.deepEqual(eventNames.filter((name) => handlers.has(name)), eventNames);

    await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    await handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);

    const state = await store.load("child-a");
    assert.equal(state?.parent?.sessionId, "parent-a");
    assert.equal(state?.runtime.processInstanceId, "process-a");
    assert.equal(state?.runtime.generation, 1);
    assert.equal(state?.runtime.settledGeneration, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
