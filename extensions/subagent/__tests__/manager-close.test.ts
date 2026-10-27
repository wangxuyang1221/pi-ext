import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import { SubagentManager, type ManagedTmuxRuntime } from "../src/manager.js";
import { registerDirectChild } from "../src/ownership.js";
import {
  SessionStateStore,
  createSessionState,
  type ParentOwnership,
  type TmuxLocator,
} from "../src/state-store.js";

const parentOwnership: ParentOwnership = {
  sessionId: "parent-a",
  epoch: "parent-epoch",
  registrationToken: "registration-a",
};
const childLocator: TmuxLocator = {
  sessionName: "pi-subagents-test",
  windowId: "@7",
  paneId: "%9",
  panePid: 1234,
};
const grandchildLocator: TmuxLocator = {
  sessionName: "pi-subagents-test",
  windowId: "@8",
  paneId: "%10",
  panePid: 5678,
};

test("terminally removes a historical alias without killing its active sibling", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const closedWindows: string[] = [];

  try {
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    const historical = createSessionState({
      sessionId: "child-old",
      epoch: "child-old-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-old.jsonl",
      now: "2026-08-27T02:00:00.000Z",
      parent: parentOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/managed-a",
        displayName: "Old",
        processInstanceId: "process-a",
      },
      tmux: childLocator,
    });
    historical.runtime.status = "closed";
    const current = createSessionState({
      sessionId: "child-new",
      epoch: "child-new-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-new.jsonl",
      now: "2026-08-27T02:00:01.000Z",
      parent: parentOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/managed-a",
        displayName: "New",
        processInstanceId: "process-a",
      },
      tmux: childLocator,
    });
    parent = registerDirectChild(parent, historical, "2026-08-27T02:00:01.000Z");
    parent = registerDirectChild(parent, current, "2026-08-27T02:00:02.000Z");
    await store.save(parent);
    await store.save(historical);
    await store.save(current);
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close(locator) { closedWindows.push(locator.windowId); },
    };
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/bin" },
    });

    await manager.close("parent-a", "child-old");

    assert.deepEqual(closedWindows, []);
    assert.equal(await store.load("child-old"), undefined);
    assert.deepEqual((await store.load("parent-a"))?.children.map((child) => child.agentId), [
      "child-new",
    ]);
    assert.equal((await manager.list("parent-a")).agents.find(
      (agent) => agent.agentId === "child-new",
    )?.status, "running");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not kill a newer active alias when historical status is stale", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const closedWindows: string[] = [];
  let alive = true;

  try {
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    const historical = createSessionState({
      sessionId: "child-old",
      epoch: "child-old-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-old.jsonl",
      now: "2026-08-27T02:00:00.000Z",
      parent: parentOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/managed-a",
        displayName: "Old",
        processInstanceId: "process-a",
      },
      processInstanceId: "process-a",
      tmux: childLocator,
    });
    const current = createSessionState({
      sessionId: "child-new",
      epoch: "child-new-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-new.jsonl",
      now: "2026-08-27T02:00:01.000Z",
      parent: parentOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/managed-a",
        displayName: "New",
        processInstanceId: "process-a",
      },
      processInstanceId: "process-a",
      tmux: childLocator,
    });
    parent = registerDirectChild(parent, historical, "2026-08-27T02:00:01.000Z");
    parent = registerDirectChild(parent, current, "2026-08-27T02:00:02.000Z");
    await store.save(parent);
    await store.save(historical);
    await store.save(current);
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return alive; },
      async close(locator) {
        closedWindows.push(locator.windowId);
        alive = false;
      },
    };
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/bin" },
    });

    await manager.close("parent-a", "child-old");

    assert.deepEqual(closedWindows, []);
    assert.equal(await store.load("child-old"), undefined);
    assert.equal((await manager.list("parent-a")).agents[0]?.status, "running");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops a live switched process during close-all even when its linked alias is closed", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const closedWindows: string[] = [];
  let alive = true;

  try {
    const historical = createSessionState({
      sessionId: "child-old",
      epoch: "child-old-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-old.jsonl",
      now: "2026-08-27T02:00:00.000Z",
      parent: parentOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/managed-a",
        displayName: "Old",
        processInstanceId: "process-a",
      },
      processInstanceId: "process-a",
      tmux: childLocator,
    });
    historical.runtime.status = "closed";
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent = registerDirectChild(parent, historical, "2026-08-27T02:00:01.000Z");
    await store.save(parent);
    await store.save(historical);
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return alive; },
      async close(candidate) {
        closedWindows.push(candidate.windowId);
        alive = false;
      },
    };
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/bin" },
    });

    await manager.close("parent-a", "all");

    assert.deepEqual(closedWindows, ["@7"]);
    assert.deepEqual((await store.load("parent-a"))?.children, []);
    assert.equal(await store.load("child-old"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closes shared-process aliases once and removes every direct alias", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const closedWindows: string[] = [];
  let alive = true;

  try {
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    for (const [agentId, updatedAt] of [
      ["child-old", "2026-08-27T02:00:00.000Z"],
      ["child-new", "2026-08-27T02:00:01.000Z"],
    ] as const) {
      const child = createSessionState({
        sessionId: agentId,
        epoch: `${agentId}-epoch`,
        cwd: "/repo",
        sessionFile: `/sessions/${agentId}.jsonl`,
        now: updatedAt,
        parent: parentOwnership,
        launch: {
          cwd: "/repo",
          sessionDir: "/sessions/managed-a",
          displayName: agentId,
          processInstanceId: "process-a",
        },
        processInstanceId: "process-a",
        tmux: childLocator,
      });
      parent = registerDirectChild(parent, child, updatedAt);
      await store.save(child);
    }
    await store.save(parent);
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return alive; },
      async close(candidate) {
        closedWindows.push(candidate.windowId);
        alive = false;
      },
    };
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/bin" },
    });

    const affected = await manager.close("parent-a", "all");

    assert.deepEqual(affected.map((agent) => agent.agentId), ["child-old", "child-new"]);
    assert.deepEqual(closedWindows, ["@7"]);
    assert.deepEqual((await store.load("parent-a"))?.children, []);
    assert.equal(await store.load("child-old"), undefined);
    assert.equal(await store.load("child-new"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports topology corruption instead of traversing descendants", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const closedWindows: string[] = [];

  try {
    const descendantOwnership: ParentOwnership = {
      sessionId: "child-a",
      epoch: "child-epoch",
      registrationToken: "registration-b",
    };
    const historical = createSessionState({
      sessionId: "grandchild-old",
      epoch: "grandchild-old-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/grandchild-old.jsonl",
      now: "2026-08-27T02:00:00.000Z",
      parent: descendantOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/grandchild-a",
        displayName: "Grandchild old",
        processInstanceId: "process-b",
      },
      tmux: grandchildLocator,
    });
    historical.runtime.status = "closed";
    const current = createSessionState({
      sessionId: "grandchild-new",
      epoch: "grandchild-new-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/grandchild-new.jsonl",
      now: "2026-08-27T02:00:01.000Z",
      parent: descendantOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/grandchild-a",
        displayName: "Grandchild new",
        processInstanceId: "process-b",
      },
      tmux: grandchildLocator,
    });
    let child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
      parent: parentOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/child-a",
        displayName: "Child",
        processInstanceId: "process-a",
      },
      tmux: childLocator,
    });
    child.children = [{
      agentId: historical.sessionId,
      epoch: historical.epoch,
      name: historical.launch!.displayName,
      cwd: historical.runtime.cwd,
      sessionFile: historical.runtime.sessionFile,
      launch: historical.launch!,
      createdAt: "2026-08-27T02:00:01.000Z",
      updatedAt: "2026-08-27T02:00:01.000Z",
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
    await store.save(historical);
    await store.save(current);

    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return false; },
      async close(locator) { closedWindows.push(locator.windowId); },
    };
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/bin" },
    });

    await assert.rejects(
      manager.close("parent-a", "all"),
      /Subagent topology corruption: managed child has children: child-a/u,
    );

    assert.deepEqual(closedWindows, []);
    assert.deepEqual((await store.load("parent-a"))?.children.map((link) => link.agentId), [
      "child-a",
    ]);
    assert.deepEqual((await store.load("child-a"))?.children.map((link) => link.agentId), [
      "grandchild-old",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retains relationship, state, and slot when process close fails", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);

  try {
    const child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
      parent: parentOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/child-a",
        displayName: "Lin",
        processInstanceId: "process-a",
      },
      processInstanceId: "process-a",
      tmux: childLocator,
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
      async isAlive() { return true; },
      async close() { throw new Error("tmux close failed"); },
    };
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/bin" },
    });

    await assert.rejects(manager.close("parent-a", "child-a"), /tmux close failed/u);

    assert.deepEqual((await store.load("parent-a"))?.children.map((link) => link.agentId), [
      "child-a",
    ]);
    assert.equal((await store.load("child-a"))?.runtime.status, "closing");
    const rawChild = JSON.parse(await readFile(store.statePath("child-a"), "utf8"));
    assert.equal(rawChild.runtime.status, "running", "parent close intent must not overwrite child runtime");
    assert.deepEqual((await manager.list("parent-a")).capacity, {
      active: 1,
      pending: 0,
      limit: 3,
      available: 2,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("terminal close removes only direct Extension state and preserves native sessions", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const childSession = join(root, "native-child.jsonl");
  const grandchildSession = join(root, "native-grandchild.jsonl");
  const closedWindows: string[] = [];

  try {
    await writeFile(childSession, "child native session\n", "utf8");
    await writeFile(grandchildSession, "grandchild native session\n", "utf8");
    const grandchild = createSessionState({
      sessionId: "grandchild-a",
      epoch: "grandchild-epoch",
      cwd: "/repo",
      sessionFile: grandchildSession,
      now: "2026-08-27T02:00:00.000Z",
      parent: {
        sessionId: "child-a",
        epoch: "child-epoch",
        registrationToken: "registration-b",
      },
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/grandchild-a",
        displayName: "Bob",
        processInstanceId: "process-b",
      },
      tmux: grandchildLocator,
    });
    let child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: childSession,
      now: "2026-08-27T02:00:00.000Z",
      parent: parentOwnership,
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/child-a",
        displayName: "Lin",
        processInstanceId: "process-a",
      },
      tmux: childLocator,
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
    await store.save(grandchild);

    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return false; },
      async close(locator) {
        closedWindows.push(locator.windowId);
      },
    };
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/local/bin:/usr/bin" },
    });

    const affected = await manager.close("parent-a", "child-a");

    assert.deepEqual(affected.map((agent) => agent.agentId), ["child-a"]);
    assert.deepEqual(closedWindows, ["@7"]);
    assert.equal(await store.load("child-a"), undefined);
    assert.notEqual(await store.load("grandchild-a"), undefined);
    assert.deepEqual((await store.load("parent-a"))?.children, []);
    assert.equal(await readFile(childSession, "utf8"), "child native session\n");
    assert.equal(await readFile(grandchildSession, "utf8"), "grandchild native session\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
