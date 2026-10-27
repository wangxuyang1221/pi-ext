import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
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

const baseLocator: TmuxLocator = {
  sessionName: "pi-subagents-test",
  windowId: "@7",
  paneId: "%9",
  panePid: 1234,
};

test("waits for in-flight spawn before close-all returns", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);
  const childSessionFile = join(root, "child-a.jsonl");
  let releaseLaunch: (() => void) | undefined;
  let markLaunchStarted: (() => void) | undefined;
  let alive = true;
  let closes = 0;
  const launchStarted = new Promise<void>((resolve) => {
    markLaunchStarted = resolve;
  });

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
        markLaunchStarted?.();
        await new Promise<void>((resolve) => {
          releaseLaunch = resolve;
        });
        const parent = JSON.parse(spec.environment[PI_SUBAGENT_PARENT]) as ParentOwnership;
        const launch = JSON.parse(spec.environment[PI_SUBAGENT_LAUNCH]) as LaunchMetadata;
        await writeFile(childSessionFile, `${JSON.stringify({
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
          sessionFile: childSessionFile,
          now: "2026-08-27T02:00:01.000Z",
          parent,
          launch,
          processInstanceId: launch.processInstanceId,
          tmux: baseLocator,
        }));
        await store.update("child-a", child => ({ ...child, runtime: { ...child.runtime, promptReady: true } }));
        return baseLocator;
      },
      async sendPrompt(_locator, text) {
        await appendFile(childSessionFile, `${JSON.stringify({
          type: "message",
          id: "user-initial-task",
          parentId: null,
          timestamp: "2026-08-27T02:00:02.000Z",
          message: { role: "user", content: text },
        })}\n`, "utf8");
      },
      async capturePane() { return ""; },
      async isAlive() { return alive; },
      async close() {
        closes += 1;
        alive = false;
      },
    };
    const manager = createManager(root, store, runtime);
    const spawning = manager.spawn(
      "parent-a",
      { task: "Finish before shutdown" },
      { cwd: "/repo" },
    );
    await launchStarted;

    let closeResolved = false;
    const closing = manager.close("parent-a", "all").then((result) => {
      closeResolved = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(closeResolved, false);

    releaseLaunch?.();
    await spawning;
    await closing;

    assert.equal(closes, 1);
    assert.deepEqual((await store.load("parent-a"))?.children, []);
    assert.deepEqual((await store.load("parent-a"))?.reservations, []);
    assert.equal(await store.load("child-a"), undefined);
  } finally {
    releaseLaunch?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("replaces a reservation with a discovered registered child", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);

  try {
    const parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent.reservations = [{
      reservationId: "registration-a",
      processInstanceId: "process-a",
      createdAt: "2026-08-27T01:00:00.000Z",
      expiresAt: "2026-08-27T01:01:00.000Z",
      tmux: baseLocator,
    }];
    await store.save(parent);
    await store.save(createSessionState({
      sessionId: "child-a",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-a.jsonl",
      now: "2026-08-27T02:00:01.000Z",
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
      tmux: baseLocator,
    }));
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close() {},
    };

    const result = await createManager(root, store, runtime).list("parent-a");

    assert.deepEqual(result.agents.map((agent) => agent.agentId), ["child-a"]);
    assert.deepEqual(result.capacity, {
      active: 1,
      pending: 0,
      limit: 3,
      available: 2,
    });
    assert.deepEqual((await store.load("parent-a"))?.reservations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reclaims reservations proven not launched and retains the subsequent unknown launch",  async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);
  let launches = 0;

  try {
    const parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent.reservations = [1, 2, 3].map((index) => ({
      reservationId: `stale-${index}`,
      processInstanceId: `stale-process-${index}`,
      launchState: "reserved",
      createdAt: "2026-08-27T01:00:00.000Z",
      expiresAt: "2026-08-27T01:01:00.000Z",
    }));
    await store.save(parent);
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() {
        launches += 1;
        throw new Error("new launch attempted");
      },
      async sendPrompt() {},
      async isAlive() { return false; },
      async close() {},
    };
    const manager = createManager(root, store, runtime, {
      nowMs: () => Date.parse("2026-08-27T02:00:00.000Z"),
    });

    await assert.rejects(
      manager.spawn("parent-a", { task: "Replace stale work" }, { cwd: "/repo" }),
      /new launch attempted/u,
    );
    assert.equal(launches, 1);
    const retained = (await store.load("parent-a"))!.reservations;
    assert.equal(retained.length, 1);
    assert.equal(retained[0]!.launchState, "launching");
    assert.equal(retained.some((reservation) => reservation.reservationId.startsWith("stale-")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses persistent reservations to reject a fourth parallel spawn", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);
  const rejectLaunches: Array<(error: Error) => void> = [];
  let markReady!: () => void;
  const ready = new Promise<void>(resolve => { markReady = resolve; });
  let settling: Promise<unknown> | undefined;
  let manager: SubagentManager | undefined;

  try {
    await store.save(createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    }));
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      launch: () => new Promise((_resolve, reject) => {
        rejectLaunches.push(reject);
        if (rejectLaunches.length === 3) markReady();
      }),
      async sendPrompt() {},
      async isAlive() { return false; },
      async close() {},
    };
    manager = createManager(root, store, runtime);
    const spawns = [1, 2, 3].map((index) => manager!.spawn(
      "parent-a",
      { task: `Task ${index}` },
      { cwd: "/repo" },
    ));
    settling = Promise.allSettled(spawns);
    await ready;

    await assert.rejects(
      manager.spawn("parent-a", { task: "Task 4" }, { cwd: "/repo" }),
      /Subagent capacity reached \(3\/3\)/u,
    );
    const reservations = (await store.load("parent-a"))!.reservations;
    assert.equal(reservations.length, 3);
    assert.equal(new Set(reservations.map(entry => (entry as { displayName?: string }).displayName)).size, 3);
    assert.ok(reservations.every(entry => typeof (entry as { displayName?: string }).displayName === "string"));
    assert.deepEqual((await manager.list("parent-a")).capacity, {
      active: 0,
      pending: 3,
      limit: 3,
      available: 0,
    });

    for (const reject of rejectLaunches) reject(new Error("launch failed"));
    await settling;
    assert.equal((await store.load("parent-a"))?.reservations.length, 3);
    assert.equal((await manager.list("parent-a")).capacity.available, 0);
  } finally {
    for (const reject of rejectLaunches) reject(new Error("Test cleanup"));
    await manager?.releaseNamespace("parent-a");
    await settling;
    await rm(root, { recursive: true, force: true });
  }
});

test("counts an owned child that registers between reconciliation and reservation", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);
  let launches = 0;

  try {
    await store.save(createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    }));
    await store.save(createSessionState({
      sessionId: "child-racing",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-racing.jsonl",
      now: "2026-08-27T02:00:01.000Z",
      parent: {
        sessionId: "parent-a",
        epoch: "parent-epoch",
        registrationToken: "registration-existing",
      },
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/child-racing",
        displayName: "Racing child",
        processInstanceId: "process-existing",
      },
      processInstanceId: "process-existing",
      tmux: baseLocator,
    }));
    await store.update("parent-a", (state) => ({ ...state, reservations: [{
      reservationId: "registration-existing", processInstanceId: "process-existing",
      createdAt: "2026-08-27T02:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", tmux: baseLocator,
    }] }));
    const listStates = store.listOwned.bind(store);
    let listCalls = 0;
    store.listOwned = async (parent) => {
      listCalls += 1;
      const states = await listStates(parent);
      return listCalls === 1
        ? states.filter((state) => state.sessionId !== "child-racing")
        : states;
    };
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() {
        launches += 1;
        throw new Error("capacity check was bypassed");
      },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close() {},
    };
    const manager = createManager(root, store, runtime, { maxActive: 1 });

    await assert.rejects(
      manager.spawn("parent-a", { task: "Do not oversell" }, { cwd: "/repo" }),
      /Subagent capacity reached \(1\/1\)/u,
    );
    assert.equal(launches, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a fourth active spawn at the default capacity", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);
  let launches = 0;

  try {
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    for (let index = 1; index <= 3; index += 1) {
      const child = createSessionState({
        sessionId: `child-${index}`,
        epoch: `child-${index}-epoch`,
        cwd: "/repo",
        sessionFile: `/sessions/child-${index}.jsonl`,
        now: "2026-08-27T02:00:00.000Z",
        parent: {
          sessionId: "parent-a",
          epoch: "parent-epoch",
          registrationToken: `registration-${index}`,
        },
        launch: {
          cwd: "/repo",
          sessionDir: `/sessions/managed-${index}`,
          displayName: `Child ${index}`,
          processInstanceId: `process-${index}`,
        },
        processInstanceId: `process-${index}`,
        tmux: {
          ...baseLocator,
          windowId: `@${index}`,
          paneId: `%${index}`,
        },
      });
      parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
      await store.save(child);
    }
    await store.save(parent);

    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() {
        launches += 1;
        return baseLocator;
      },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close() {},
    };
    const manager = createManager(root, store, runtime);

    await assert.rejects(
      manager.spawn("parent-a", { task: "One too many" }, { cwd: "/repo" }),
      {
        message: "Subagent capacity reached (3/3). Reuse an existing child with subagent_prompt, or close one before spawning another.",
      },
    );
    assert.equal(launches, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closes and removes persisted pending reservations during close-all", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);
  let alive = true;
  let closes = 0;

  try {
    const parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent.reservations = [{
      reservationId: "registration-a",
      processInstanceId: "process-a",
      createdAt: "2026-08-27T02:00:00.000Z",
      expiresAt: "2026-08-27T03:00:00.000Z",
      tmux: baseLocator,
    }];
    await store.save(parent);
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return alive; },
      async close() {
        closes += 1;
        alive = false;
      },
    };
    const manager = createManager(root, store, runtime);

    const affected = await manager.close("parent-a", "all");

    assert.deepEqual(affected, []);
    assert.equal(closes, 1);
    assert.deepEqual((await store.load("parent-a"))?.reservations, []);
    assert.deepEqual((await manager.list("parent-a")).capacity, {
      active: 0,
      pending: 0,
      limit: 3,
      available: 3,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deduplicates a child that registers while close-all is reconciling reservations", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);
  let alive = true;
  let closes = 0;

  try {
    const parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent.reservations = [{
      reservationId: "registration-a",
      processInstanceId: "process-a",
      createdAt: "2026-08-27T02:00:00.000Z",
      expiresAt: "2026-08-27T03:00:00.000Z",
      tmux: baseLocator,
    }];
    await store.save(parent);
    await store.save(createSessionState({
      sessionId: "child-racing",
      epoch: "child-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/child-racing.jsonl",
      now: "2026-08-27T02:00:01.000Z",
      parent: {
        sessionId: "parent-a",
        epoch: "parent-epoch",
        registrationToken: "registration-a",
      },
      launch: {
        cwd: "/repo",
        sessionDir: "/sessions/child-racing",
        displayName: "Racing child",
        processInstanceId: "process-a",
      },
      processInstanceId: "process-a",
      tmux: baseLocator,
    }));
    const listStates = store.listOwned.bind(store);
    let listCalls = 0;
    store.listOwned = async (parent) => {
      listCalls += 1;
      const states = await listStates(parent);
      return listCalls === 1
        ? states.filter((state) => state.sessionId !== "child-racing")
        : states;
    };
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return alive; },
      async close() {
        closes += 1;
        alive = false;
      },
    };
    const manager = createManager(root, store, runtime);

    const affected = await manager.close("parent-a", "all");

    assert.deepEqual(affected.map((agent) => agent.agentId), ["child-racing"]);
    assert.equal(closes, 1);
    assert.deepEqual((await store.load("parent-a"))?.reservations, []);
    assert.deepEqual((await store.load("parent-a"))?.children, []);
    assert.equal(await store.load("child-racing"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retains pending reservation and slot when close-all cannot stop its runtime", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);

  try {
    const parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    parent.reservations = [{
      reservationId: "registration-a",
      processInstanceId: "process-a",
      createdAt: "2026-08-27T02:00:00.000Z",
      expiresAt: "2026-08-27T03:00:00.000Z",
      tmux: baseLocator,
    }];
    await store.save(parent);
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive() { return true; },
      async close() { throw new Error("tmux close failed"); },
    };
    const manager = createManager(root, store, runtime);

    await assert.rejects(manager.close("parent-a", "all"), /tmux close failed/u);

    assert.deepEqual((await store.load("parent-a"))?.reservations, parent.reservations);
    assert.deepEqual((await manager.list("parent-a")).capacity, {
      active: 0,
      pending: 1,
      limit: 3,
      available: 2,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("counts live settled processes and persists confirmed interruptions", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-capacity-test-"));
  const store = new SessionStateStore(root);

  try {
    let parent = createSessionState({
      sessionId: "parent-a",
      epoch: "parent-epoch",
      cwd: "/repo",
      sessionFile: "/sessions/parent-a.jsonl",
      now: "2026-08-27T02:00:00.000Z",
    });
    for (const [agentId, processInstanceId, windowId, status] of [
      ["child-live", "process-live", "@1", "settled"],
      ["child-dead", "process-dead", "@2", "running"],
    ] as const) {
      const child = createSessionState({
        sessionId: agentId,
        epoch: `${agentId}-epoch`,
        cwd: "/repo",
        sessionFile: `/sessions/${agentId}.jsonl`,
        now: "2026-08-27T02:00:00.000Z",
        parent: {
          sessionId: "parent-a",
          epoch: "parent-epoch",
          registrationToken: `${agentId}-registration`,
        },
        launch: {
          cwd: "/repo",
          sessionDir: `/sessions/${agentId}`,
          displayName: agentId,
          processInstanceId,
        },
        processInstanceId,
        tmux: { ...baseLocator, windowId, paneId: `%${windowId.slice(1)}` },
      });
      child.runtime.status = status;
      parent = registerDirectChild(parent, child, "2026-08-27T02:00:01.000Z");
      await store.save(child);
    }
    await store.save(parent);
    const runtime: ManagedTmuxRuntime = {
    async capturePane() { throw new Error("Unexpected pane capture in fixture"); },
      async launch() { throw new Error("not used"); },
      async sendPrompt() {},
      async isAlive(candidate) { return candidate.windowId === "@1"; },
      async close() {},
    };
    const manager = createManager(root, store, runtime, { maxActive: 2 });

    const result = await manager.list("parent-a");

    assert.deepEqual(result.agents.map(({ agentId, status }) => ({ agentId, status })), [
      { agentId: "child-live", status: "settled" },
      { agentId: "child-dead", status: "interrupted" },
    ]);
    assert.deepEqual(result.capacity, {
      active: 1,
      pending: 0,
      limit: 2,
      available: 1,
    });
    assert.equal((await store.load("child-dead"))?.runtime.status, "interrupted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function createManager(
  root: string,
  store: SessionStateStore,
  runtime: ManagedTmuxRuntime,
  options: { nowMs?: () => number; reservationTtlMs?: number; maxActive?: number } = {},
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
    registrationTimeoutMs: 0,
  });
}
