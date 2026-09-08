// Exercise production registration with the real editor, assistant and tool rows.
import assert from "node:assert/strict";
import { test } from "vitest";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import inlineCodexUi from "../src/index.js";
import { reasoningPipeline } from "./fixtures/reasoning-pipeline.js";

test("inline summaries replace in place and keep the write row stationary through finalization", async () => {
  const pipeline = await reasoningPipeline(inlineCodexUi, process.cwd(), 0, false, 0);
  const summary = () => pipeline.assistant.render(120).map(stripTerminalSequences).filter(line => line.trim());
  try {
    const initial = await pipeline.begin();
    let text = "**Rewriting lifecycle tests**";
    await pipeline.update(text, text);
    assert.deepEqual(summary().map(line => line.trim()), ["• Rewriting lifecycle tests"],
      "Thinking must be visible before tool arguments are generated");
    const rowsBefore = pipeline.screen.render(120).length;
    const delta = "\n\n**Checking frame stability**";
    text += delta;
    await pipeline.update(text, delta);
    assert.deepEqual(summary().map(line => line.trim()), ["• Checking frame stability"]);
    assert.equal(pipeline.screen.render(120).length, rowsBefore, "Replacing a title must not add a row");
    assert.equal(pipeline.widgets.size, 0, "Inline preview must not reserve an editor status row");

    const message = { ...initial, content: [
      { type: "thinking" as const, thinking: text },
      { type: "toolCall" as const, id: "inline-write", name: "write", arguments: { path: "test.ts", content: "fixture\n" } },
    ] };
    const call = message.content[1]!;
    const tool = new ToolExecutionComponent("write", "inline-write", call.arguments!, { showImages: false },
      pipeline.tools.get("write"), pipeline.screen, process.cwd());
    (pipeline.screen.children[1] as Container).addChild(tool);
    const positions = () => {
      const rows = pipeline.screen.render(120).map(stripTerminalSequences);
      return { title: rows.findIndex(line => line.includes("Checking frame stability")),
        tool: rows.findIndex(line => line.includes("Write test.ts")),
        editor: rows.findIndex(line => line.includes("Ask Pi")), height: rows.length };
    };
    pipeline.assistant.updateContent(message, true);
    const before = positions();
    assert.ok(before.title >= 0 && before.tool > before.title && before.editor > before.tool);
    for (const type of ["thinking_end", "toolcall_start", "toolcall_delta", "toolcall_delta", "toolcall_end"]) {
      await pipeline.emit("message_update", { message, assistantMessageEvent: { type,
        contentIndex: type === "thinking_end" ? 0 : 1 } });
      pipeline.assistant.updateContent(message, true);
      assert.deepEqual(positions(), before);
    }
    await pipeline.emit("message_end", { message });
    pipeline.assistant.updateContent(message, false);
    tool.setArgsComplete(); tool.markExecutionStarted();
    assert.deepEqual(positions(), before, "message_end must not insert thinking above the tool");
    tool.updateResult({ content: [{ type: "text", text: "fixture" }], isError: false });
    await pipeline.emit("agent_settled");
    assert.deepEqual(positions(), before, "Tool completion and settlement must retain the same layout");
    assert.deepEqual(summary().map(line => line.trim()), ["• Checking frame stability"]);
    assert.equal(message.content[0]!.thinking, text, "Original thinking must not be changed");
  } finally { await pipeline.dispose(); }
});

test("inline summaries preserve literal titles and stay on one line at narrow widths", async () => {
  const pipeline = await reasoningPipeline(inlineCodexUi, process.cwd(), 0, false, 0);
  try {
    await pipeline.begin();
    const title = "检查 [a](url) `code` _name_ &amp; <tag> 👩🏽‍💻 é";
    const text = `**${title}**`;
    await pipeline.update(text, text);
    const visible = (width: number) => pipeline.assistant.render(width).map(stripTerminalSequences).filter(row => row.trim());
    assert.deepEqual(visible(120).map(row => row.trim()), [`• ${title}`], "Provider titles must remain literal text");
    for (const width of [1, 2, 3, 10, 30, 60, 120, 30]) {
      const rows = visible(width);
      assert.equal(rows.length, 1, "Long titles must truncate rather than wrap");
      for (const row of rows) assert.ok(visibleWidth(row) <= width);
    }
    const before = visible(60);
    await pipeline.finish();
    assert.deepEqual(visible(60), before, "Final rendering must use the same truncation rule");
    for (const literal of ["A &amp; B", "<tag> _name_ `code`", "Checking \\ paths"]) {
      await pipeline.begin();
      await pipeline.update(`**${literal}**`, "");
      assert.deepEqual(visible(120).map(row => row.trim()), [`• ${literal}`]);
    }
  } finally { await pipeline.dispose(); }
});

test("incomplete titles and later message lifecycles cannot change a settled inline summary", async () => {
  const pipeline = await reasoningPipeline(inlineCodexUi, process.cwd(), 0, false, 0);
  const visible = () => pipeline.assistant.render(120).map(stripTerminalSequences).filter(row => row.trim()).map(row => row.trim());
  try {
    await pipeline.begin();
    await pipeline.update("Untitled reasoning body", "Untitled reasoning body");
    assert.deepEqual(visible(), [], "Do not present arbitrary body text as a summary");
    await pipeline.update("**First title**\n\n**Part", "");
    assert.deepEqual(visible(), ["• First title"]);
    await pipeline.update("**First title**\n\n**Partial title**\n\nBody grows", "");
    assert.deepEqual(visible(), ["• Partial title"]);
    for (const stopReason of ["stop", "aborted", "error"] as const) {
      const message = { role: "assistant" as const, content: [
        { type: "thinking" as const, thinking: "**First title**" },
        { type: "thinking" as const, thinking: "**Partial title**\n\nBody grows" },
        { type: "toolCall" as const, id: "write-1", name: "write", arguments: {} },
      ], timestamp: 1, provider: "fixture", model: "fixture", api: "openai-responses" as const,
      stopReason, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      pipeline.assistant.updateContent(message, false);
      assert.deepEqual(visible(), ["• Partial title"], "Consecutive thinking blocks must share one summary");
      await pipeline.emit("agent_settled");
      await pipeline.emit("agent_start");
      await pipeline.emit("session_tree");
      pipeline.assistant.invalidate();
      assert.deepEqual(visible(), ["• Partial title"], "History rendering must not depend on mutable live status");
    }
  } finally { await pipeline.dispose(); }
});
