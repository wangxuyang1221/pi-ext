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
import {
  getDirectChild,
  markDirectChildClosed,
  registerDirectChild,
} from "../src/ownership.js";
import { activateSession } from "../src/runtime-state.js";
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

test("resumes a closed direct child without sending a prompt", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-manager-test-"));
  const store = new SessionStateStore(root);
  const prompts: string[] = [];

  try {
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    const child = createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
      parent: {
        sessionId: "parent-a",
        epoch: "parent-epoch",
        registrationToken: "old-registration",
      },
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/managed-a",
        displayName: "Lin",
        processInstanceId: "old-process",
        model: "openai/gpt-test",
        thinkingLevel: "high",
      },
    });
    child.runtime.status = "closed";
    child.runtime.generation = 3;
    child.runtime.settledGeneration = 2;
    parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
    parent = markDirectChildClosed(parent, "child-a", "2026-08-27T02:00:02.000Z");
    await store.save(parent);
    await store.save(child);

    let launchSpec: Parameters<ManagedTmuxRuntime["launch"]>[0] | undefined;
    const runtime: ManagedTmuxRuntime = {
      async launch(spec) {
        launchSpec = spec;
        const ownership = JSON.parse(spec.environment[PI_SUBAGENT_PARENT]) as ParentOwnership;
        const launch = JSON.parse(spec.environment[PI_SUBAGENT_LAUNCH]) as LaunchMetadata;
        const existing = await store.load("child-a");
        assert.ok(existing);
        await store.save(activateSession(existing, {
          sessionId: "child-a",
          cwd: "/repo",
          sessionFile: "/sessions/child-a.jsonl",
          now: "2026-08-27T02:00:03.000Z",
          parent: ownership,
          launch,
          pid: 333,
          processInstanceId: launch.processInstanceId,
          tmux: locator,
          createEpoch: () => "must-not-be-used",
        }));
        return locator;
      },
      async sendPrompt(_locator, text) {
        prompts.push(text);
      },
      async isAlive() {
        return false;
      },
      async close() {},
    };
    const ids = ["new-registration", "new-process"];
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
      environment: { PATH: "/usr/local/bin:/usr/bin" },
      createId: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-08-27T02:00:04.000Z",
    });

    const result = await manager.resume("parent-a", "child-a");

    assert.equal(result.agentId, "child-a");
    assert.equal(result.generation, 3);
    assert.equal(result.settledGeneration, 2);
    assert.deepEqual(prompts, []);
    assert.ok(launchSpec?.args.includes("--session"));
    assert.ok(launchSpec?.args.includes("/sessions/child-a.jsonl"));
    assert.equal(getDirectChild((await store.load("parent-a"))!, "child-a").closedAt, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
