import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import { readSessionView } from "../src/session-reader.js";

test("projects finalized assistant and paired tool activity while ignoring a partial tail", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "child.jsonl");

  try {
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, {
        role: "user",
        content: "Inspect the runtime",
        timestamp: 1,
      }),
      messageEntry("assistant-1", "user-1", {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect it." },
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/runtime.ts" } },
        ],
        stopReason: "toolUse",
        timestamp: 2,
      }),
      messageEntry("result-1", "assistant-1", {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "runtime contents" }],
        isError: false,
        timestamp: 3,
      }),
    ];
    await writeFile(
      sessionFile,
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n{"type":"message"`,
      "utf8",
    );

    const result = await readSessionView({
      sessionFile,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "recent_activity",
      assistantLimit: 3,
      toolLimit: 5,
    });

    assert.equal(result.position, 3);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.activity, [
      {
        kind: "assistant",
        id: "assistant-1",
        timestamp: "2026-08-27T02:00:02.000Z",
        text: "I will inspect it.",
        stopReason: "toolUse",
      },
      {
        kind: "tool",
        id: "call-1",
        timestamp: "2026-08-27T02:00:02.000Z",
        toolName: "read",
        arguments: { path: "src/runtime.ts" },
        result: "runtime contents",
        isError: false,
        complete: true,
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projects normalized activity from the selected leaf branch only", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "branched.jsonl");

  try {
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-root", null, { role: "user", content: "Start", timestamp: 1 }),
      messageEntry("assistant-old", "user-root", {
        role: "assistant",
        content: [{ type: "text", text: "Abandoned answer" }],
        stopReason: "stop",
        timestamp: 2,
      }),
      messageEntry("user-old", "assistant-old", { role: "user", content: "Old branch", timestamp: 3 }),
      messageEntry("assistant-current", "user-root", {
        role: "assistant",
        content: [{ type: "text", text: "Current answer" }],
        stopReason: "stop",
        timestamp: 4,
      }),
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const result = await readSessionView({
      sessionFile,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "recent_activity",
      leafId: "assistant-current",
      assistantLimit: 10,
      toolLimit: 10,
    });

    assert.equal(result.view, "recent_activity");
    assert.deepEqual(result.activity.map((item) => item.id), ["assistant-current"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves unknown native entries in a bounded all-entries view", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "all-entries.jsonl");

  try {
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, { role: "user", content: "Task", timestamp: 1 }),
      {
        type: "future_entry",
        id: "future-1",
        parentId: "user-1",
        timestamp: "2026-08-27T02:00:02.000Z",
        payload: { retained: true },
      },
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const result = await readSessionView({
      sessionFile,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "all_entries",
      limit: 1,
    });

    assert.equal(result.view, "all_entries");
    assert.deepEqual(result.entries, [entries[2]]);
    assert.deepEqual(result.warnings, ["Unknown Pi session entry type: future_entry"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("starts a turn at each persisted user message", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "turns.jsonl");

  try {
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, { role: "user", content: "First task", timestamp: 1 }),
      messageEntry("assistant-1", "user-1", {
        role: "assistant",
        content: [{ type: "text", text: "First answer" }],
        stopReason: "stop",
        timestamp: 2,
      }),
      messageEntry("user-2", "assistant-1", { role: "user", content: "Second task", timestamp: 3 }),
      messageEntry("assistant-2", "user-2", {
        role: "assistant",
        content: [{ type: "text", text: "Second answer" }],
        stopReason: "stop",
        timestamp: 4,
      }),
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const result = await readSessionView({
      sessionFile,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "turns",
      limit: 1,
    });

    assert.equal(result.view, "turns");
    assert.deepEqual(result.turns, [
      {
        id: "user-2",
        user: {
          id: "user-2",
          timestamp: "2026-08-27T02:00:03.000Z",
          text: "Second task",
        },
        activity: [
          {
            kind: "assistant",
            id: "assistant-2",
            timestamp: "2026-08-27T02:00:03.000Z",
            text: "Second answer",
            stopReason: "stop",
          },
        ],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function messageEntry(id: string, parentId: string | null, message: object): object {
  return {
    type: "message",
    id,
    parentId,
    timestamp: `2026-08-27T02:00:0${id === "user-1" ? 1 : id === "assistant-1" ? 2 : 3}.000Z`,
    message,
  };
}
