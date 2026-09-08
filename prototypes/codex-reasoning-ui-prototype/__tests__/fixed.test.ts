// PROTOTYPE: Run the proposed display policy through real Pi components.
import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { Model } from "@earendil-works/pi-ai";
import { CALLS, MODEL, PROMPTS, PROVIDER, streamFixedFixture } from "../src/fixture.js";
import fixedCodexUi from "../src/fixed.js";
import { reasoningPipeline } from "../../../extensions/codex-ui/__tests__/fixtures/reasoning-pipeline.js";

test("fixed status retains the latest title through tool streaming and never inserts thinking into history", async () => {
  const pipeline = await reasoningPipeline(fixedCodexUi, process.cwd(), 0, false, 0);
  const rows = () => pipeline.widgets.get("codex-ui-reasoning")!.render(120).map(stripTerminalSequences);
  try {
    assert.deepEqual(rows(), ["", ""], "Idle status must reserve its row and gap");
    const message = await pipeline.begin();
    const text = "**Rewriting lifecycle tests**\n\n**Checking frame stability**";
    await pipeline.update(text, text);
    assert.deepEqual(rows(), ["• Checking frame stability", ""], "New summaries must replace the same row");
    const toolMessage = { ...message, content: [
      { type: "thinking" as const, thinking: text },
      { type: "toolCall" as const, id: "write-1", name: "write", arguments: { path: "test.ts" } },
    ] };
    for (const type of ["thinking_end", "toolcall_start", "toolcall_delta", "toolcall_delta", "toolcall_end"]) {
      await pipeline.emit("message_update", { message: toolMessage,
        assistantMessageEvent: { type, contentIndex: type === "thinking_end" ? 0 : 1 } });
      pipeline.assistant.updateContent(toolMessage, true);
      assert.deepEqual(rows(), ["• Checking frame stability", ""]);
    }
    const before = pipeline.assistant.render(120);
    assert.equal(stripTerminalSequences(before.join("\n")).trim(), "");
    await pipeline.emit("message_end", { message: toolMessage });
    pipeline.assistant.updateContent(toolMessage, false);
    assert.deepEqual(pipeline.assistant.render(120), before, "Finalization must not add history rows");
    for (const type of ["tool_execution_start", "tool_execution_update", "tool_execution_end"]) {
      await pipeline.emit(type, { toolCallId: "write-1", toolName: "write" });
      assert.deepEqual(rows(), ["• Checking frame stability", ""]);
    }
    await pipeline.emit("agent_settled");
    assert.deepEqual(rows(), ["", ""], "Settlement must clear text without changing height");
    assert.equal(toolMessage.content[0]!.type, "thinking", "Display policy must preserve the original message");
  } finally { await pipeline.dispose(); }
});

test("fixed status keeps its height across partial titles, reply output, resize and interruption", async () => {
  const pipeline = await reasoningPipeline(fixedCodexUi, process.cwd(), 0, false, 0);
  const widget = () => pipeline.widgets.get("codex-ui-reasoning")!;
  try {
    const message = await pipeline.begin();
    await pipeline.update("**First title**", "**First title**");
    await pipeline.update("**First title**\n\n**Partial", "\n\n**Partial");
    assert.match(stripTerminalSequences(widget().render(120)[0]!), /First title/u);
    await pipeline.update("**" + "检查 👩🏽‍💻 English ".repeat(30) + "**", "");
    for (const width of [0, 1, 2, 3, 20, 60, 120]) {
      const rows = widget().render(width);
      assert.equal(rows.length, 2);
      assert.equal(rows[1], "");
      for (const row of rows) assert.ok(visibleWidth(row) <= width);
    }
    await pipeline.emit("message_update", { message, assistantMessageEvent: { type: "text_start", contentIndex: 1 } });
    assert.deepEqual(widget().render(120), ["", ""]);
    for (const event of ["agent_end", "agent_settled", "session_before_compact", "session_tree"]) {
      await pipeline.begin();
      await pipeline.update("**First title**", "**First title**");
      await pipeline.emit(event);
      assert.deepEqual(widget().render(120), ["", ""]);
      await pipeline.update("**Late title**", "**Late title**");
      assert.deepEqual(widget().render(120), ["", ""], "Late events must not restore cleared status");
    }
    for (const stopReason of ["aborted", "error"] as const) {
      const current = await pipeline.begin();
      await pipeline.update("**First title**", "**First title**");
      await pipeline.emit("message_end", { message: { ...current, stopReason } });
      assert.deepEqual(widget().render(120), ["", ""]);
    }
  } finally { await pipeline.dispose(); }
});

test("fixed fixture exposes repeated summaries and progressive write arguments in the real provider stream", async () => {
  process.env.PI_REASONING_LAB_FAST = "1";
  const model = { id: MODEL, name: MODEL, api: "openai-responses", provider: PROVIDER,
    baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"], contextWindow: 128000,
    maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<"openai-responses">;
  const previous = { role: "assistant", content: [], api: model.api, provider: PROVIDER, model: MODEL,
    timestamp: 0, stopReason: "toolUse", usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0,
      cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } } } as const;
  const stream = streamFixedFixture(model, { messages: [
    { role: "user", content: PROMPTS.standard, timestamp: 0 },
    { ...previous, content: [] }, { ...previous, content: [] },
  ] });
  const events = [];
  for await (const event of stream) events.push(structuredClone(event));
  assert.ok(events.filter(event => event.type === "toolcall_delta").length >= 4, "Write arguments must arrive progressively");
  assert.ok(events.filter(event => event.type === "thinking_delta").length >= 5, "More than one title must be observable");
  assert.ok(!events.some(event => event.type === "text_start"), "Write preview must follow thinking without a reply clearing the title");
  const message = await stream.result();
  assert.deepEqual(message.content.find(block => block.type === "toolCall")?.arguments, CALLS[2].arguments);
});
