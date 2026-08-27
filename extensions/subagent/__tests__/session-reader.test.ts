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
        truncated: false,
      },
      {
        kind: "tool",
        id: "call-1",
        timestamp: "2026-08-27T02:00:02.000Z",
        toolName: "read",
        outcome: "succeeded",
        detailRef: {
          activityId: "call-1",
          sections: ["tool_arguments", "tool_result"],
        },
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("defaults to the latest non-empty assistant and lightweight tool status", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "default-summary.jsonl");

  try {
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, { role: "user", content: "Inspect", timestamp: 1 }),
      messageEntry("assistant-early", "user-1", {
        role: "assistant",
        content: [{ type: "text", text: "Earlier conclusion" }],
        stopReason: "stop",
        timestamp: 2,
      }),
      messageEntry("assistant-tool", "assistant-early", {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "secret.txt" } },
        ],
        stopReason: "toolUse",
        timestamp: 3,
      }),
      messageEntry("result-1", "assistant-tool", {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "sensitive tool output" }],
        isError: false,
        timestamp: 4,
      }),
      messageEntry("assistant-latest", "result-1", {
        role: "assistant",
        content: [{ type: "text", text: "Latest conclusion" }],
        stopReason: "stop",
        timestamp: 5,
      }),
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const result = await readSessionView({
      sessionFile,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "recent_activity",
    });

    assert.equal(result.view, "recent_activity");
    assert.deepEqual(result.activity, [
      {
        kind: "tool",
        id: "call-1",
        timestamp: "2026-08-27T02:00:03.000Z",
        toolName: "read",
        outcome: "succeeded",
        detailRef: {
          activityId: "call-1",
          sections: ["tool_arguments", "tool_result"],
        },
      },
      {
        kind: "assistant",
        id: "assistant-latest",
        timestamp: "2026-08-27T02:00:03.000Z",
        text: "Latest conclusion",
        stopReason: "stop",
        truncated: false,
      },
    ]);
    assert.equal(result.assistantCount, 1);
    assert.equal(result.toolCount, 1);
    assert.equal(result.omittedAssistant, 1);
    assert.equal(result.omittedTools, 0);
    assert.equal(result.hasMore, true);
    assert.equal(result.returnedBytes, Buffer.byteLength(JSON.stringify(result), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports pending, succeeded, and failed tool outcomes with a bounded error preview", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "tool-outcomes.jsonl");

  try {
    const longError = `${"错".repeat(300)}error-tail`;
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, { role: "user", content: "Run tools", timestamp: 1 }),
      messageEntry("assistant-tools", "user-1", {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-pending", name: "read", arguments: { path: "a" } },
          { type: "toolCall", id: "call-success", name: "bash", arguments: { command: "true" } },
          { type: "toolCall", id: "call-failed", name: "bash", arguments: { command: "false" } },
        ],
        stopReason: "toolUse",
        timestamp: 2,
      }),
      messageEntry("result-success", "assistant-tools", {
        role: "toolResult",
        toolCallId: "call-success",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
        isError: false,
        timestamp: 3,
      }),
      messageEntry("result-failed", "result-success", {
        role: "toolResult",
        toolCallId: "call-failed",
        toolName: "bash",
        content: [{ type: "text", text: longError }],
        isError: true,
        timestamp: 4,
      }),
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const result = await readSessionView({
      sessionFile,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "recent_activity",
      assistantLimit: 1,
      toolLimit: 10,
    });

    assert.equal(result.view, "recent_activity");
    const tools = result.activity.filter((item) => item.kind === "tool");
    assert.deepEqual(tools.map((tool) => tool.outcome), ["pending", "succeeded", "failed"]);
    assert.deepEqual(tools.map((tool) => tool.detailRef.sections), [
      ["tool_arguments"],
      ["tool_arguments", "tool_result"],
      ["tool_arguments", "tool_result"],
    ]);
    assert.equal(tools[0]?.errorPreview, undefined);
    assert.equal(tools[1]?.errorPreview, undefined);
    assert.ok(tools[2]?.errorPreview);
    assert.ok(Buffer.byteLength(tools[2].errorPreview, "utf8") <= 512);
    assert.notEqual(tools[2].errorPreview, longError);
    assert.doesNotMatch(tools[2].errorPreview, /error-tail/u);
    await assert.rejects(
      readSessionView({
        sessionFile,
        agentId: "agent-a",
        epoch: "epoch-a",
        view: "activity_detail",
        activityId: "call-pending",
        section: "tool_result",
      }),
      /tool_result is not available for pending tool activity/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("caps an exceptional assistant message at 64 KiB without corrupting UTF-8", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "large-assistant.jsonl");

  try {
    const originalText = `${"界".repeat(30_000)}assistant-tail`;
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, { role: "user", content: "Summarize", timestamp: 1 }),
      messageEntry("assistant-large", "user-1", {
        role: "assistant",
        content: [{ type: "text", text: originalText }],
        stopReason: "stop",
        timestamp: 2,
      }),
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const result = await readSessionView({
      sessionFile,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "recent_activity",
    });

    assert.equal(result.view, "recent_activity");
    const assistant = result.activity.find((item) => item.kind === "assistant");
    assert.ok(assistant);
    assert.equal(assistant.truncated, true);
    assert.ok(Buffer.byteLength(assistant.text, "utf8") <= 64 * 1024);
    assert.doesNotMatch(assistant.text, /\uFFFD/u);
    assert.doesNotMatch(assistant.text, /assistant-tail/u);
    assert.deepEqual(assistant.detailRef, {
      activityId: "assistant-large",
      sections: ["assistant_text"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps summary JSON within 72 KiB using the agreed record priority", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "summary-budget.jsonl");

  try {
    const largeToolMarker = "RAW_TOOL_RESULT_MUST_NOT_LEAK";
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, { role: "user", content: "Inspect", timestamp: 1 }),
      messageEntry("assistant-old", "user-1", {
        role: "assistant",
        content: [{ type: "text", text: `old:${"o".repeat(20 * 1024)}` }],
        stopReason: "stop",
        timestamp: 2,
      }),
      messageEntry("assistant-tools", "assistant-old", {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "one" } },
          { type: "toolCall", id: "call-2", name: "read", arguments: { path: "two" } },
          { type: "toolCall", id: "call-3", name: "read", arguments: { path: "three" } },
        ],
        stopReason: "toolUse",
        timestamp: 3,
      }),
      messageEntry("result-1", "assistant-tools", {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: `${largeToolMarker}:${"r".repeat(1024 * 1024)}` }],
        isError: false,
        timestamp: 4,
      }),
      messageEntry("result-2", "result-1", {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "read",
        content: [{ type: "text", text: "two" }],
        isError: false,
        timestamp: 5,
      }),
      messageEntry("result-3", "result-2", {
        role: "toolResult",
        toolCallId: "call-3",
        toolName: "read",
        content: [{ type: "text", text: "three" }],
        isError: false,
        timestamp: 6,
      }),
      messageEntry("assistant-middle", "result-3", {
        role: "assistant",
        content: [{ type: "text", text: `middle:${"m".repeat(20 * 1024)}` }],
        stopReason: "stop",
        timestamp: 7,
      }),
      messageEntry("assistant-latest", "assistant-middle", {
        role: "assistant",
        content: [{ type: "text", text: `latest:${"l".repeat(60 * 1024)}` }],
        stopReason: "stop",
        timestamp: 8,
      }),
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const result = await readSessionView({
      sessionFile,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "recent_activity",
      assistantLimit: 3,
      toolLimit: 3,
    });

    assert.equal(result.view, "recent_activity");
    const serialized = JSON.stringify(result);
    assert.ok(Buffer.byteLength(serialized, "utf8") <= 72 * 1024);
    assert.equal(result.returnedBytes, Buffer.byteLength(serialized, "utf8"));
    assert.doesNotMatch(serialized, new RegExp(largeToolMarker, "u"));
    assert.deepEqual(result.activity.map((item) => item.id), [
      "call-1",
      "call-2",
      "call-3",
      "assistant-latest",
    ]);
    assert.equal(result.assistantCount, 1);
    assert.equal(result.toolCount, 3);
    assert.equal(result.omittedAssistant, 2);
    assert.equal(result.omittedTools, 0);
    assert.equal(result.hasMore, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps parser warnings inside the final summary budget", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "warning-budget.jsonl");

  try {
    const warnings = Array.from({ length: 3_000 }, (_, index) => ({
      type: `future_entry_${index}`,
      id: `future-${index}`,
      parentId: index === 0 ? "user-1" : `future-${index - 1}`,
      timestamp: "2026-08-27T02:00:02.000Z",
    }));
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, { role: "user", content: "Inspect", timestamp: 1 }),
      ...warnings,
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const result = await readSessionView({
      sessionFile,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "recent_activity",
    });

    const serialized = JSON.stringify(result);
    assert.ok(Buffer.byteLength(serialized, "utf8") <= 72 * 1024);
    assert.equal(result.returnedBytes, Buffer.byteLength(serialized, "utf8"));
    assert.ok(result.warnings.length < warnings.length);
    assert.match(result.warnings.at(-1) ?? "", /warnings omitted/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pages assistant text detail in UTF-8-safe 16 KiB chunks", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "assistant-detail.jsonl");

  try {
    const originalText = `${"分页内容".repeat(5_000)}detail-tail`;
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, { role: "user", content: "Explain", timestamp: 1 }),
      messageEntry("assistant-detail", "user-1", {
        role: "assistant",
        content: [{ type: "text", text: originalText }],
        stopReason: "stop",
        timestamp: 2,
      }),
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const pages: string[] = [];
    let detailCursor: string | undefined;
    do {
      const result = await readSessionView({
        sessionFile,
        agentId: "agent-a",
        epoch: "epoch-a",
        view: "activity_detail",
        activityId: "assistant-detail",
        section: "assistant_text",
        ...(detailCursor ? { detailCursor } : {}),
      });

      assert.equal(result.view, "activity_detail");
      assert.equal(result.activityId, "assistant-detail");
      assert.equal(result.section, "assistant_text");
      assert.equal(result.originalBytes, Buffer.byteLength(originalText, "utf8"));
      assert.equal(result.returnedBytes, Buffer.byteLength(result.content, "utf8"));
      assert.ok(result.returnedBytes <= 16 * 1024);
      assert.doesNotMatch(result.content, /\uFFFD/u);
      assert.equal(result.hasMore, result.nextDetailCursor !== undefined);
      pages.push(result.content);
      detailCursor = result.nextDetailCursor;
    } while (detailCursor);

    assert.equal(pages.join(""), originalText);
    assert.ok(pages.length > 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads tool arguments and results only through bounded detail pages", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-reader-test-"));
  const sessionFile = join(root, "tool-detail.jsonl");

  try {
    const toolArguments = { command: `printf ${"参".repeat(8_000)}` };
    const toolResult = `${"结果".repeat(8_000)}tool-result-tail`;
    const entries = [
      {
        type: "session",
        version: 3,
        id: "agent-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        cwd: "/repo",
      },
      messageEntry("user-1", null, { role: "user", content: "Run", timestamp: 1 }),
      messageEntry("assistant-tool", "user-1", {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-detail", name: "bash", arguments: toolArguments }],
        stopReason: "toolUse",
        timestamp: 2,
      }),
      messageEntry("result-detail", "assistant-tool", {
        role: "toolResult",
        toolCallId: "call-detail",
        toolName: "bash",
        content: [{ type: "text", text: toolResult }],
        isError: false,
        timestamp: 3,
      }),
    ];
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const readAll = async (section: "tool_arguments" | "tool_result"): Promise<string> => {
      const pages: string[] = [];
      let detailCursor: string | undefined;
      do {
        const result = await readSessionView({
          sessionFile,
          agentId: "agent-a",
          epoch: "epoch-a",
          view: "activity_detail",
          activityId: "call-detail",
          section,
          ...(detailCursor ? { detailCursor } : {}),
        });
        assert.equal(result.view, "activity_detail");
        assert.ok(result.returnedBytes <= 16 * 1024);
        pages.push(result.content);
        detailCursor = result.nextDetailCursor;
      } while (detailCursor);
      return pages.join("");
    };

    assert.equal(await readAll("tool_arguments"), JSON.stringify(toolArguments));
    assert.equal(await readAll("tool_result"), toolResult);
    await assert.rejects(
      readSessionView({
        sessionFile,
        agentId: "agent-a",
        epoch: "epoch-a",
        view: "activity_detail",
        activityId: "call-detail",
        section: "assistant_text",
      }),
      /assistant_text is only available for assistant activity/u,
    );
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

test("reports unknown native entries without exposing their raw payload", async () => {
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
      view: "recent_activity",
    });

    assert.equal(result.view, "recent_activity");
    assert.deepEqual(result.activity, []);
    assert.deepEqual(result.warnings, ["Unknown Pi session entry type: future_entry"]);
    assert.equal("entries" in result, false);
    assert.doesNotMatch(JSON.stringify(result), /"retained":true/u);
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
        content: [
          { type: "text", text: "Second answer" },
          {
            type: "toolCall",
            id: "call-turn",
            name: "read",
            arguments: { path: "private.txt" },
          },
        ],
        stopReason: "toolUse",
        timestamp: 4,
      }),
      messageEntry("result-turn", "assistant-2", {
        role: "toolResult",
        toolCallId: "call-turn",
        toolName: "read",
        content: [{ type: "text", text: "private tool result" }],
        isError: false,
        timestamp: 5,
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
            stopReason: "toolUse",
            truncated: false,
          },
          {
            kind: "tool",
            id: "call-turn",
            timestamp: "2026-08-27T02:00:03.000Z",
            toolName: "read",
            outcome: "succeeded",
            detailRef: {
              activityId: "call-turn",
              sections: ["tool_arguments", "tool_result"],
            },
          },
        ],
      },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /private\.txt|private tool result/u);
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
