import assert from "node:assert/strict";
import { test } from "vitest";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { reasoningHistoryMarkdown } from "../src/reasoning-history.js";
import { reasoningMessage } from "./fixtures/reasoning-pipeline.js";

test("completed history keeps native Markdown block syntax at the start of a line", () => {
  for (const body of ["```ts\nconst value = 1;\n```", "# Heading\n\nBody", "- First\n- Second", "> Quote", "    const value = 1;\n    value++;", "\tindented code", "| A | B |\n| --- | --- |\n| a | b |"] ) {
    assert.equal(reasoningHistoryMarkdown(`**Status**\n\n${body}`), `•\n\n${body}`);
  }
});

test("history preserves title-only, untitled, partial and empty content", () => {
  assert.equal(reasoningHistoryMarkdown("**Title**"), "• **Title**");
  assert.equal(reasoningHistoryMarkdown("**Title**\r\n\r\nFirst\n\n**Later**\n\nLast"), "• First\n\n**Later**\n\nLast");
  assert.equal(reasoningHistoryMarkdown("First\n\nLast"), "• First\n\nLast");
  assert.equal(reasoningHistoryMarkdown("**Partial"), "• Partial");
  assert.equal(reasoningHistoryMarkdown("**"), "");
  assert.equal(reasoningHistoryMarkdown(" \n"), "");
});

test("native history caches stable Markdown and retains visibility controls and original data", () => {
  initTheme("dark", false);
  const text = "**Title**\n\n第一段内容。English words.\n\n" + "最后一段。".repeat(20);
  const message = reasoningMessage(text);
  const before = structuredClone(message);
  let transforms = 0;
  const component = new AssistantMessageComponent(message, false, undefined, "Hidden thinking", 1, [
    (markdown, ctx) => { transforms++; return ctx.isStreaming ? "" : reasoningHistoryMarkdown(markdown); },
  ]);
  component.updateContent(message, true);
  assert.equal(stripTerminalSequences(component.render(60).join("\n")).trim(), "");
  component.updateContent(message, false);
  const first = component.render(60);
  const count = transforms;
  for (let index = 0; index < 100; index++) assert.deepEqual(component.render(60), first);
  assert.equal(transforms, count);
  for (const width of [30, 60, 120]) {
    const lines = component.render(width);
    assert.match(stripTerminalSequences(lines.join("\n")), /第一段/u);
    assert.match(stripTerminalSequences(lines.join("\n")), /最后一段/u);
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
  }
  component.setHideThinkingBlock(true);
  assert.match(stripTerminalSequences(component.render(60).join("\n")), /Hidden thinking/u);
  component.setHideThinkingBlock(false);
  assert.match(stripTerminalSequences(component.render(60).join("\n")), /第一段/u);
  assert.deepEqual(message, before);
});
