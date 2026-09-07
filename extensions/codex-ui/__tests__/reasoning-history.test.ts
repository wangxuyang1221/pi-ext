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

test("history preserves every summary in a title-only sequence with its own marker", () => {
  const titles = ["Preserving indented rail styling", "Refining rail rendering tests", "Preparing diff fixtures"];
  const input = titles.map(title => `**${title}**`).join("\n\n");
  assert.equal(reasoningHistoryMarkdown(input), titles.map(title => `• **${title}**`).join("\n\n"));
});

test("title-only detection accepts line endings but leaves prose and code unchanged", () => {
  for (const separator of ["\n", "\n\n", "\r\n\r\n", "\n \t\n\n"]) {
    assert.equal(reasoningHistoryMarkdown(`\n**First**  ${separator}**Second**\n`), "• **First**\n\n• **Second**");
  }
  assert.equal(reasoningHistoryMarkdown("**First**\n\n**Second**\n\nBody"), "• **Second**\n\nBody");
  assert.equal(reasoningHistoryMarkdown("**Title**\n\n**Bold** prose"), "• **Bold** prose");
  assert.equal(reasoningHistoryMarkdown("**Title**\n\n    **Code**"), "•\n\n    **Code**");
  assert.equal(reasoningHistoryMarkdown("**Title**\n\n```\n**Code**\n```"), "•\n\n```\n**Code**\n```");
});

test("native history aligns title-only summaries across combined and adjacent thinking blocks", () => {
  initTheme("dark", false);
  const titles = ["Preserving indented rail styling", "Refining rail rendering tests", "Preparing diff fixtures"];
  for (const combined of [true, false]) {
    const message = reasoningMessage();
    message.content = (combined ? [titles.map(title => `**${title}**`).join("\n\n")] : titles.map(title => `**${title}**`))
      .map(thinking => ({ type: "thinking", thinking }));
    const before = structuredClone(message);
    const component = new AssistantMessageComponent(message, false, undefined, "Hidden thinking", 0, [
      (markdown, ctx) => ctx.isStreaming ? "" : reasoningHistoryMarkdown(markdown),
    ]);
    component.updateContent(message, true);
    assert.equal(stripTerminalSequences(component.render(80).join("\n")).trim(), "");
    component.updateContent(message, false);
    const rendered = component.render(80);
    const plain = rendered.map(line => stripTerminalSequences(line).trimEnd()).filter(Boolean);
    assert.deepEqual(plain, titles.map(title => `• ${title}`));
    component.invalidate();
    assert.deepEqual(component.render(80), rendered);
    for (const width of [1, 12, 40, 80]) {
      assert.ok(component.render(width).every(line => visibleWidth(line) <= width));
    }
    component.setHideThinkingBlock(true);
    assert.match(stripTerminalSequences(component.render(80).join("\n")), /Hidden thinking/u);
    component.setHideThinkingBlock(false);
    assert.deepEqual(component.render(80), rendered);
    assert.deepEqual(message, before);
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
