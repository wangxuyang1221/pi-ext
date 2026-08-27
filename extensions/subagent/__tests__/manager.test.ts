import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import {
  PI_SUBAGENT_LAUNCH,
  PI_SUBAGENT_PARENT,
  SubagentManager,
  type ManagedTmuxRuntime,
} from "../src/manager.js";
import { registerDirectChild } from "../src/ownership.js";
import {
  SessionStateStore,
  createSessionState,
  type LaunchMetadata,
  type ParentOwnership,
  type TmuxLocator,
} from "../src/state-store.js";

const locator: TmuxLocator = {
  sessionName: "pi-subagents-test",
  windowId: "@7",
  paneId: "%9",
  panePid: 1234,
};

test("rejects spawn from a managed session before launching a runtime", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  let launched = false;

  try {
    await store.save(createSessionState({
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
    }));
    const runtime: ManagedTmuxRuntime = {
      async launch() {
        launched = true;
        return locator;
      },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close() {},
    };
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/local/bin:/usr/bin" },
      registrationTimeoutMs: 0,
    });

    await assert.rejects(
      manager.spawn("child-a", { task: "Create a nested child" }, { cwd: "/repo" }),
      /Managed sessions cannot spawn subagents/u,
    );
    assert.equal(launched, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes failed spawn metadata when initial prompt delivery fails", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  let closes = 0;

  try {
    await store.save(createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    }));
    const runtime: ManagedTmuxRuntime = {
      async launch(spec) {
        const parent = JSON.parse(spec.environment[PI_SUBAGENT_PARENT]) as ParentOwnership;
        const launch = JSON.parse(spec.environment[PI_SUBAGENT_LAUNCH]) as LaunchMetadata;
        await store.save(createSessionState({
          sessionId: "child-a",
          epoch: "child-epoch",
          cwd: spec.cwd,
          sessionFile: "/sessions/child-a.jsonl",
          now: "2026-08-27T02:00:01.000Z",
          parent,
          launch,
          pid: 222,
          processInstanceId: launch.processInstanceId,
          tmux: locator,
        }));
        return locator;
      },
      async sendPrompt() { throw new Error("prompt delivery failed"); },
      async isAlive() { return false; },
      async close() { closes += 1; },
    };
    const ids = ["registration-a", "process-a"];
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/local/bin:/usr/bin" },
      createId: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-08-27T02:00:02.000Z",
    });

    await assert.rejects(
      manager.spawn("parent-a", { task: "Start work" }, { cwd: "/repo" }),
      /prompt delivery failed/u,
    );
    assert.equal(closes, 1);
    assert.deepEqual((await store.load("parent-a"))?.children, []);
    assert.deepEqual((await store.load("parent-a"))?.reservations, []);
    assert.equal(await store.load("child-a"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes a child that registers while timed-out spawn cleanup is closing it", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  let capturedParent: ParentOwnership | undefined;
  let capturedLaunch: LaunchMetadata | undefined;

  try {
    await store.save(createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    }));
    const runtime: ManagedTmuxRuntime = {
      async launch(spec) {
        capturedParent = JSON.parse(spec.environment[PI_SUBAGENT_PARENT]) as ParentOwnership;
        capturedLaunch = JSON.parse(spec.environment[PI_SUBAGENT_LAUNCH]) as LaunchMetadata;
        return locator;
      },
      async sendPrompt() {},
      async isAlive() { return false; },
      async close() {
        assert.ok(capturedParent);
        assert.ok(capturedLaunch);
        await store.save(createSessionState({
          sessionId: "child-late",
          epoch: "child-epoch",
          cwd: "/repo",
          sessionFile: "/sessions/child-late.jsonl",
          now: "2026-08-27T02:00:01.000Z",
          parent: capturedParent,
          launch: capturedLaunch,
          processInstanceId: capturedLaunch.processInstanceId,
          tmux: locator,
        }));
      },
    };
    const ids = ["registration-a", "process-a"];
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/local/bin:/usr/bin" },
      createId: () => ids.shift() ?? "unexpected-id",
      registrationTimeoutMs: 0,
    });

    await assert.rejects(
      manager.spawn("parent-a", { task: "Start work" }, { cwd: "/repo" }),
      /Timed out waiting for child runtime registration/u,
    );

    assert.equal(await store.load("child-late"), undefined);
    assert.deepEqual((await store.load("parent-a"))?.children, []);
    assert.deepEqual((await store.load("parent-a"))?.reservations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registers a spawned child before delivering its initial task", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const task = "Inspect the parser; do not leak this into process arguments.";
  let launchSpec: Parameters<ManagedTmuxRuntime["launch"]>[0] | undefined;
  const prompts: Array<{ text: string; delivery: string }> = [];

  try {
    await store.save(createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    }));

    const runtime: ManagedTmuxRuntime = {
      async launch(spec) {
        launchSpec = spec;
        const parent = JSON.parse(spec.environment[PI_SUBAGENT_PARENT]) as ParentOwnership;
        const launch = JSON.parse(spec.environment[PI_SUBAGENT_LAUNCH]) as LaunchMetadata;
        await store.save(createSessionState({
          sessionId: "child-a",
          epoch: "child-epoch",
          cwd: spec.cwd,
          sessionFile: "/sessions/child-a.jsonl",
          now: "2026-08-27T02:00:01.000Z",
          parent,
          launch,
          pid: 222,
          processInstanceId: launch.processInstanceId,
          tmux: locator,
        }));
        return locator;
      },
      async sendPrompt(_locator, text, delivery) {
        prompts.push({ text, delivery });
      },
      async isAlive() {
        return true;
      },
      async close() {},
    };
    const ids = ["registration-a", "process-a"];
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/local/bin:/usr/bin" },
      createId: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-08-27T02:00:02.000Z",
    });

    const result = await manager.spawn("parent-a", {
      task,
      name: "Lin",
    }, {
      cwd: "/repo",
      model: "openai/gpt-test",
      thinkingLevel: "high",
    });

    assert.equal(result.agentId, "child-a");
    assert.equal(JSON.stringify(launchSpec).includes(task), false);
    assert.equal(launchSpec?.environment.PI_SUBAGENT, "1");
    assert.equal(launchSpec?.environment.PI_SUBAGENT_ID, "process-a");
    assert.deepEqual(prompts, [{ text: task, delivery: "steer" }]);
    assert.deepEqual((await store.load("parent-a"))?.children.map((child) => child.agentId), [
      "child-a",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
