// Exercise production registration with the real editor, assistant and tool rows.
import assert from "node:assert/strict";
import { test } from "vitest";
import { AssistantMessageComponent, ToolExecutionComponent, type MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences } from "@earendil-works/pi-tui";
import codexUi from "../src/index.js";
import { reasoningMessage, reasoningPipeline } from "./fixtures/reasoning-pipeline.js";

// Native blockquote reference, independent of production registration and its source formatting.
const quoteReference: MarkdownTransformer = (text, context) =>
  context.messageType === "assistant-thinking" && text.trim()
    ? "> **Thinking**\n>\n> " + text.replace(/\r?\n/gu, "\n> ") : text;

test("thinking grows inline and retains its contents through tool finalization", async () => {
  const pipeline = await reasoningPipeline(codexUi, process.cwd(), 0, false, 0);
  const visible = () => pipeline.assistant.render(120).map(stripTerminalSequences).join("\n");
  try {
    const initial = await pipeline.begin();
    let text = "**Rewriting lifecycle tests**\n\nFirst body.";
    await pipeline.update(text, text);
    assert.match(visible(), /Rewriting lifecycle tests/u);
    assert.match(visible(), /First body\./u);
    const rowsBefore = pipeline.screen.render(120).length;
    const delta = "\n\n**Checking frame stability**\n\nSecond body.";
    text += delta;
    await pipeline.update(text, delta);
    assert.match(visible(), /Rewriting lifecycle tests/u);
    assert.match(visible(), /First body\./u);
    assert.match(visible(), /Checking frame stability/u);
    assert.match(visible(), /Second body\./u);
    assert.ok(pipeline.screen.render(120).length > rowsBefore, "New thinking must grow instead of replacing earlier content");
    assert.deepEqual([...pipeline.widgets.keys()], ["codex-ui-working"], "Thinking remains inline; only task activity has a widget");

    const message = { ...initial, content: [
      { type: "thinking" as const, thinking: text },
      { type: "toolCall" as const, id: "inline-write", name: "write", arguments: { path: "test.ts", content: "fixture\n" } },
    ] };
    const original = structuredClone(message);
    const call = message.content[1]!;
    const tool = new ToolExecutionComponent("write", "inline-write", call.arguments!, { showImages: false },
      pipeline.tools.get("write"), pipeline.screen, process.cwd());
    (pipeline.screen.children[1] as Container).addChild(tool);
    const positions = () => {
      const rows = pipeline.screen.render(120).map(stripTerminalSequences);
      return { title: rows.findIndex(line => line.includes("Checking frame stability")),
        tool: rows.findIndex(line => /(?:Writing |Write )test\.ts/u.test(line)),
        editor: rows.findIndex(line => line.includes("Ask Pi")), height: rows.length };
    };
    pipeline.assistant.updateContent(message, true);
    const before = positions();
    const thinkingBefore = visible();
    assert.ok(before.title >= 0 && before.tool > before.title && before.editor > before.tool);
    for (const type of ["thinking_end", "toolcall_start", "toolcall_delta", "toolcall_delta", "toolcall_end"]) {
      await pipeline.emit("message_update", { message, assistantMessageEvent: { type,
        contentIndex: type === "thinking_end" ? 0 : 1, partial: message, content: text, delta: "", toolCall: call } });
      pipeline.assistant.updateContent(message, true);
      assert.deepEqual(positions(), before);
      assert.equal(visible(), thinkingBefore);
    }
    await pipeline.emit("message_end", { message });
    pipeline.assistant.updateContent(message, false);
    tool.setArgsComplete(); tool.markExecutionStarted();
    assert.deepEqual(positions(), before, "Finalization must not insert previously hidden thinking");
    tool.updateResult({ content: [{ type: "text", text: "fixture" }], isError: false });
    await pipeline.emit("agent_settled");
    assert.deepEqual(positions(), { ...before, editor: before.editor - 1, height: before.height - 1 });
    assert.equal(visible(), thinkingBefore);
    assert.deepEqual(message, original, "Rendering must not modify the original message");
  } finally { await pipeline.dispose(); }
});

test("thinking uses native blockquote wrapping, padding and visibility for all providers", async () => {
  for (const outputPad of [0, 1] as const) {
    const pipeline = await reasoningPipeline(codexUi, process.cwd(), 0, false, outputPad);
    try {
      await pipeline.begin();
      for (const provider of ["openai-codex", "deepseek"]) {
        for (const text of [
          "**First title**\n\nFirst body.\n\n**Last title**\n\nLast body.",
          "Untitled reasoning body with enough words to wrap across several narrow terminal lines.",
          "检查 [link](https://example.com) `code` _name_ &amp; <tag> 👩🏽‍💻 é\n\n- item\n\n```ts\nconst n = 1;\n```",
          "> Nested quote\n\n| Key | Value |\n| --- | --- |\n| a | b |",
          "First\r\n\r\nLast", "", " \n\t ",
        ]) {
          const message = { ...reasoningMessage(text), provider };
          const original = structuredClone(message);
          const native = new AssistantMessageComponent(message, false, undefined, "Thinking...", outputPad, [quoteReference]);
          for (const isStreaming of [true, false]) {
            pipeline.assistant.updateContent(message, isStreaming);
            native.updateContent(message, isStreaming);
            for (const hidden of [false, true, false]) {
              pipeline.assistant.setHideThinkingBlock(hidden);
              native.setHideThinkingBlock(hidden);
              for (const width of [1, 2, 4, 10, 30, 60, 120, 30]) {
                assert.deepEqual(pipeline.assistant.render(width), native.render(width),
                  `Native blockquote layout must match for ${provider}, padding ${outputPad}, width ${width}`);
              }
              if (text.startsWith("Untitled")) {
                const lines = pipeline.assistant.render(30).map(stripTerminalSequences).filter(line => line.trim());
                if (hidden) {
                  assert.equal(lines.length, 1);
                  assert.match(lines[0]!, /Thinking\.\.\./u);
                  assert.ok(!lines.join("").includes("Untitled"));
                } else {
                  assert.ok(lines.length > 1, "Long reasoning must wrap instead of truncating to one line");
                  assert.match(lines[0]!, /│ Thinking/u);
                  assert.equal(lines.slice(1).map(line => line.trim().replace(/^│\s?/u, "")).filter(Boolean).join(" "), text);
                }
              }
            }
          }
          assert.deepEqual(message, original);
        }
      }
    } finally { await pipeline.dispose(); }
  }
});

test("partial Markdown, completion and history replay preserve every thinking block", async () => {
  const pipeline = await reasoningPipeline(codexUi, process.cwd(), 0, false, 0);
  try {
    await pipeline.begin();
    const text = "Untitled body\n\n**First title**\n\nFirst body\n\n**Next title**\n\nLast body";
    const native = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 0, [quoteReference]);
    for (const source of [text, "- Item\n\n```ts\nconst n = 1;\n```\n\n> Nested quote\n\n| Key | Value |\n| --- | --- |\n| a | b |"]) {
      await pipeline.begin();
      for (let length = 1; length <= source.length; length++) {
        const partial = source.slice(0, length);
        await pipeline.update(partial, source[length - 1]!);
        native.updateContent(reasoningMessage(partial), true);
        assert.deepEqual(pipeline.assistant.render(60), native.render(60));
      }
    }
    const streamed = pipeline.assistant.render(60);
    await pipeline.finish();
    assert.deepEqual(pipeline.assistant.render(60), streamed);

    for (const stopReason of ["stop", "aborted", "error"] as const) {
      const message = { ...reasoningMessage(), content: [
        { type: "thinking" as const, thinking: "**First title**\n\nFirst body" },
        { type: "thinking" as const, thinking: "**Next title**\n\nLast body" },
      ], stopReason };
      const original = structuredClone(message);
      native.updateContent(message, false);
      pipeline.assistant.updateContent(message, false);
      const expected = native.render(60);
      assert.deepEqual(pipeline.assistant.render(60), expected);
      const visible = expected.map(stripTerminalSequences).join("\n");
      assert.match(visible, /First body/u);
      assert.match(visible, /Last body/u);
      assert.equal(visible.match(/│ Thinking/gu)?.length, 1, "Consecutive thinking blocks share one quote title");
      if (stopReason === "aborted") assert.match(visible, /Operation aborted/u);
      if (stopReason === "error") assert.match(visible, /Error:/u);
      for (const event of ["agent_settled", "agent_start", "session_tree"]) {
        await pipeline.emit(event);
        pipeline.assistant.invalidate();
        assert.deepEqual(pipeline.assistant.render(60), expected);
      }
      const replay = await reasoningPipeline(codexUi, process.cwd(), 0, false, 0);
      try {
        replay.assistant.updateContent(message, false);
        assert.deepEqual(replay.assistant.render(60), expected, "A fresh extension must not require live summary state");
      } finally { await replay.dispose(); }
      assert.deepEqual(message, original);
    }
  } finally { await pipeline.dispose(); }
});
