import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("removes failed spawn metadata when initial prompt delivery is unconfirmed", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const sessionFile = join(root, "failed-child.jsonl");
  let closes = 0;
  let alive = true;
  let now = 0;

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
        await writeFile(sessionFile, `${JSON.stringify({
          type: "session",
          version: 3,
          id: "child-a",
          timestamp: "2026-08-27T02:00:01.000Z",
          cwd: spec.cwd,
        })}\n`, "utf8");
        await store.save(createSessionState({
          sessionId: "child-a",
          epoch: "child-epoch",
          cwd: spec.cwd,
          sessionFile,
          now: "2026-08-27T02:00:01.000Z",
          parent,
          launch,
          pid: 222,
          processInstanceId: launch.processInstanceId,
          tmux: locator,
        }));
        await store.update("child-a", child => ({ ...child, runtime: { ...child.runtime, promptReady: true } }));
        return locator;
      },
      async sendPrompt() {},
      async capturePane() { return ""; },
      async isAlive() { return alive; },
      async close() {
        closes += 1;
        alive = false;
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
      now: () => "2026-08-27T02:00:02.000Z",
      nowMs: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });

    await assert.rejects(
      manager.spawn("parent-a", { task: "Start work" }, { cwd: "/repo" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as Error & { code?: string }).code, "delivery_unconfirmed");
        return true;
      },
    );
    assert.equal(now, 1_000);
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

test("prepares a persisted native session before delivering the initial task", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const sessionDir = join(root, "native-sessions", "parent-a", "process-a");
  const sessionFile = join(sessionDir, "session.jsonl");
  const task = "Inspect the parser; do not leak this into process arguments.";
  let launchSpec: Parameters<ManagedTmuxRuntime["launch"]>[0] | undefined;
  const prompts: Array<{ text: string; delivery: string }> = [];
  let alive = true;

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
        assert.deepEqual(spec.args.slice(0, 4), [
          "--session-dir",
          sessionDir,
          "--session",
          sessionFile,
        ]);
        assert.equal(await readFile(sessionFile, "utf8"), "");
        await writeFile(sessionFile, `${JSON.stringify({
          type: "session",
          version: 3,
          id: "child-a",
          timestamp: "2026-08-27T02:00:01.000Z",
          cwd: spec.cwd,
        })}\n`, "utf8");
        await store.save(createSessionState({
          sessionId: "child-a",
          epoch: "child-epoch",
          cwd: spec.cwd,
          sessionFile,
          now: "2026-08-27T02:00:01.000Z",
          parent,
          launch,
          pid: 222,
          processInstanceId: launch.processInstanceId,
          tmux: locator,
        }));
        await store.update("child-a", child => ({ ...child, runtime: { ...child.runtime, promptReady: true } }));
        return locator;
      },
      async sendPrompt(_locator, text, delivery) {
        prompts.push({ text, delivery });
        assert.equal((await store.load("parent-a"))?.children[0]?.agentId, "child-a");
        assert.match(
          text,
          /^\[subagent:[a-f0-9]{12}\]\nInspect the parser; do not leak this into process arguments\.$/u,
        );
        await appendFile(sessionFile, `${JSON.stringify({
          type: "message",
          id: "user-initial-task",
          parentId: null,
          timestamp: "2026-08-27T02:00:02.000Z",
          message: { role: "user", content: text },
        })}\n`, "utf8");
      },
      async capturePane() {
        return "";
      },
      async isAlive() {
        return alive;
      },
      async close() {
        alive = false;
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
      now: () => "2026-08-27T02:00:02.000Z",
    });

    const result = await manager.spawn("parent-a", {
      task,
    }, {
      cwd: "/repo",
      model: "openai/gpt-test",
      thinkingLevel: "high",
    });

    assert.equal(result.agentId, "child-a");
    assert.equal(JSON.stringify(launchSpec).includes(task), false);
    assert.equal(launchSpec?.environment.PI_SUBAGENT, "1");
    assert.equal(launchSpec?.environment.PI_SUBAGENT_ID, "process-a");
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]?.delivery, "steer");
    assert.ok(prompts[0]?.text.endsWith(`\n${task}`));
    assert.deepEqual((await store.load("parent-a"))?.children.map((child) => child.agentId), [
      "child-a",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
