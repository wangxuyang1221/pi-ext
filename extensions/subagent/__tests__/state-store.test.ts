import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import {
  SessionStateStore,
  createSessionState,
  parseSessionState,
} from "../src/state-store.js";

test("writes each session state to its own atomic partition", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-state-test-"));

  try {
    const store = new SessionStateStore(root);
    const state = createSessionState({
      sessionId: "session-a",
      cwd: "/repo",
      sessionFile: "/sessions/session-a.jsonl",
      epoch: "epoch-a",
      now: "2026-08-27T02:20:00.000Z",
    });

    await store.save(state);

    assert.deepEqual(await store.load("session-a"), state);
    assert.deepEqual(
      await readdir(join(root, "sessions", "session-a")),
      ["state.json"],
    );
    assert.equal(await store.load("session-b"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects the previous Extension state schema", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-state-test-"));

  try {
    const store = new SessionStateStore(root);
    const path = store.statePath("session-a");
    await mkdir(join(root, "sessions", "session-a"), { recursive: true });
    await writeFile(path, `${JSON.stringify({
      schemaVersion: 1,
      sessionId: "session-a",
      epoch: "epoch-a",
      runtime: {},
      children: [],
    })}\n`, "utf8");

    await assert.rejects(store.load("session-a"), /Unsupported subagent state schema: 1/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deletes only Extension state while preserving native Pi sessions", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-state-test-"));
  const nativeSession = join(root, "native-sessions", "session-a.jsonl");

  try {
    const store = new SessionStateStore(root);
    await mkdir(join(root, "native-sessions"), { recursive: true });
    await writeFile(nativeSession, "native transcript\n", "utf8");
    await store.save(createSessionState({
      sessionId: "session-a",
      cwd: "/repo",
      sessionFile: nativeSession,
      epoch: "epoch-a",
      now: "2026-08-27T02:20:00.000Z",
    }));
    await store.save(createSessionState({
      sessionId: "session-b",
      cwd: "/repo",
      sessionFile: join(root, "native-sessions", "session-b.jsonl"),
      epoch: "epoch-b",
      now: "2026-08-27T02:20:00.000Z",
    }));

    assert.deepEqual((await store.list()).map((state) => state.sessionId), [
      "session-a",
      "session-b",
    ]);
    await store.delete("session-a");

    assert.equal(await store.load("session-a"), undefined);
    assert.equal(await readFile(nativeSession, "utf8"), "native transcript\n");
    assert.deepEqual((await store.list()).map((state) => state.sessionId), ["session-b"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects stale saves that would erase a completed generation", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-state-test-"));
  try {
    const store = new SessionStateStore(root);
    const stale = createSessionState({ sessionId: "a", epoch: "e", cwd: root, sessionFile: "/a.jsonl", now: "now" });
    await store.save(stale);
    await store.update("a", (state) => ({ ...state, runtime: { ...state.runtime, generation: 1, settledGeneration: 1 } }));
    await assert.rejects(new SessionStateStore(root).save(stale), /generation.*regress/);
    assert.equal((await store.load("a"))?.runtime.settledGeneration, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects malformed process and control authority at the storage boundary", () => {
  const state = createSessionState({ sessionId: "a", epoch: "e", cwd: "/repo", sessionFile: "/a.jsonl", now: "now" });
  for (const fields of [
    { processes: { p: { phase: "retired", registrationToken: "token" } } },
    { processes: { p: { phase: "active" } } },
    { control: { children: { child: { epoch: "e", status: "running", updatedAt: "now" } }, tombstones: {} } },
    { control: { children: {}, tombstones: { child: false } } },
    { control: { children: {}, tombstones: {}, closingAll: "false" } },
  ]) assert.throws(() => parseSessionState({ ...state, ...fields }, "a"), /Invalid subagent state/u);
});

test("rejects malformed runtime counters at the storage boundary", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-state-test-"));
  try {
    const store = new SessionStateStore(root);
    const state = createSessionState({ sessionId: "a", epoch: "e", cwd: "/repo", sessionFile: "/a.jsonl", now: "now" });
    await store.save(state);
    await writeFile(store.statePath("a"), JSON.stringify({ ...state, runtime: { ...state.runtime, generation: -1 } }));
    await assert.rejects(store.load("a"), /Invalid subagent state/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("preserves completed generations across independent stores", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-state-test-"));
  try {
    const parent = new SessionStateStore(root);
    const child = new SessionStateStore(root);
    await parent.save(createSessionState({ sessionId: "a", epoch: "e", cwd: "/repo", sessionFile: "/a.jsonl", now: "now" }));
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const closing = parent.update("a", async (state) => {
      entered();
      await barrier;
      return { ...state, runtime: { ...state.runtime, status: "closing" } };
    });
    await reading;
    const settling = child.update("a", (state) => ({ ...state, runtime: { ...state.runtime, generation: 1, settledGeneration: 1 } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([closing, settling]);
    assert.equal((await parent.load("a"))?.runtime.settledGeneration, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("serializes concurrent updates for one session", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-state-test-"));

  try {
    const store = new SessionStateStore(root);
    await store.save(createSessionState({
      sessionId: "session-a",
      cwd: "/repo",
      sessionFile: "/sessions/session-a.jsonl",
      epoch: "epoch-a",
      now: "2026-08-27T02:20:00.000Z",
    }));

    await Promise.all([
      store.update("session-a", async (state) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        state.runtime.generation += 1;
        return state;
      }),
      store.update("session-a", (state) => {
        state.runtime.generation += 1;
        return state;
      }),
    ]);

    assert.equal((await store.load("session-a"))?.runtime.generation, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
