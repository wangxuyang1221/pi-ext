import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import {
  SessionStateStore,
  createSessionState,
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
