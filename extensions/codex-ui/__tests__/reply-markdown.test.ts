import assert from "node:assert/strict";
import { test } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AgentSession, AssistantMessageComponent, convertToLlm, initTheme, SessionManager,
  type ExtensionAPI, type MarkdownTransformer,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import codexUi from "../src/index.js";

function transformers(): MarkdownTransformer[] {
  const registered: MarkdownTransformer[] = [];
  codexUi({ registerTool() {}, registerCommand() {}, on() {},
    registerMarkdownTransformer: (transform: MarkdownTransformer) => registered.push(transform),
  } as unknown as ExtensionAPI);
  return registered;
}

function message(text: string): AssistantMessage {
  return {
    role: "assistant", content: [{ type: "text", text }], timestamp: 1,
    api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

const fixture = [
  "This long reply wraps naturally in a narrow terminal without moving its continuation back to the left edge.",
  "## Heading",
  "Another paragraph with **bold text**, `inline code` and a [link](https://pi.dev).",
  "- Existing item\n  - Nested item",
  "```ts\nconst ready = true;\n```",
  "| Key | Value |\n| --- | --- |\n| a | b |",
].join("\n\n");

const plain = (row: AssistantMessageComponent, width = 60) => row.render(width).map(stripTerminalSequences);

test("assistant transform adds one outer list without dropping whitespace or existing lists", () => {
  const transform = transformers()[0]!;
  for (const isStreaming of [false, true]) {
    const context = { messageType: "assistant" as const, isStreaming, availableWidth: 60 };
    for (const empty of ["", " ", "\n\t\r\n"]) assert.equal(transform(empty, context), empty);
    for (const source of [fixture, "## First heading\n\nBody", "- Existing list", "\n\nLeading blanks\n", "First\r\n\r\nNext"]) {
      const expected = "- " + source.split(/\r?\n/u).join("\n  ");
      assert.equal(transform(source, context), expected);
      assert.equal(transform(source, context), expected, "Repeated rendering starts from input, not prior output");
    }
  }
});

test("native assistant layout wraps and indents blocks without changing output padding", () => {
  initTheme("dark", false);
  for (const outputPad of [0, 1]) {
    const row = new AssistantMessageComponent(message(fixture), false, undefined, "Thinking...", outputPad, transformers());
    for (const width of [24, 60, 100]) {
      const rendered = row.render(width);
      assert(rendered.every(line => visibleWidth(line) <= width));
      const lines = rendered.map(stripTerminalSequences).filter(line => line.trim());
      assert(lines[0]!.startsWith(" ".repeat(outputPad) + "- This long reply"));
      assert(lines.slice(1).every(line => line.startsWith(" ".repeat(outputPad + 2))));
      assert(lines.some(line => line.trim() === "Heading"));
      assert(lines.some(line => line.includes("Existing item")));
      assert(lines.some(line => line.includes("Nested item")));
      assert(lines.join("").replace(/\s/gu, "").includes("constready=true;"), "Code content survives native wrapping");
      assert(lines.some(line => line.includes("Key")));
      assert.equal(lines.filter(line => line.startsWith(" ".repeat(outputPad) + "- ")).length, 1);
    }
  }
});

test("streamed partial Markdown and restored messages produce the same list layout", () => {
  initTheme("dark", false);
  const transforms = transformers();
  const row = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 0, transforms);
  for (const text of ["", " ", "First", "中文与 English 自动换行。 ".repeat(12), "## Heading", "- Item\n  - Nested", "```ts\nconst ready =", "```ts\nconst ready = true;\n```", fixture]) {
    const snapshot = message(text);
    const before = JSON.stringify(snapshot);
    row.updateContent(snapshot, true);
    const streamed = plain(row);
    row.updateContent(snapshot, false);
    assert.deepEqual(plain(row), streamed);
    const restored = new AssistantMessageComponent(snapshot, false, undefined, "Thinking...", 0, transformers());
    assert.deepEqual(plain(restored), streamed);
    row.invalidate();
    assert.deepEqual(plain(row), streamed);
    assert.equal(JSON.stringify(snapshot), before);
  }
});

test("reply markers, thinking quotes and native failure labels stay separate", () => {
  initTheme("dark", false);
  for (const stopReason of ["stop", "aborted", "error", "length"] as const) {
    const snapshot = { ...message("First block"), stopReason, errorMessage: "Fixture error" };
    snapshot.content.unshift({ type: "thinking", thinking: "**Reviewing layout**\n\nKeep the reasoning body." });
    snapshot.content.push({ type: "text", text: "Second block" });
    const before = structuredClone(snapshot);
    const row = new AssistantMessageComponent(snapshot, false, undefined, "Thinking...", 0, transformers());
    const lines = plain(row).filter(line => line.trim());
    assert.equal(lines[0]!.trimEnd(), "│ Thinking");
    assert.ok(lines.some(line => line.trimEnd() === "│ Reviewing layout"));
    assert.ok(lines.some(line => line.trimEnd() === "│ Keep the reasoning body."));
    assert.equal(lines.filter(line => line.startsWith("- ")).length, 2);
    assert(lines.some(line => line.trimEnd() === "- First block"));
    assert(lines.some(line => line.trimEnd() === "- Second block"));
    if (stopReason === "aborted") assert(lines.some(line => line.startsWith("Fixture error")));
    if (stopReason === "error") assert(lines.some(line => line.startsWith("Error: Fixture error")));
    if (stopReason === "length") assert(lines.some(line => line.startsWith("Response was truncated")));
    assert.deepEqual(snapshot, before);
  }
  for (const stopReason of ["aborted", "error"] as const) {
    const empty = { ...message(""), stopReason };
    assert(!plain(new AssistantMessageComponent(empty, false, undefined, "Thinking...", 0, transformers())).some(line => line.startsWith("- ")));
  }
});

test("rendering leaves session and model text untouched and raw copy excludes the display marker", () => {
  initTheme("dark", false);
  const snapshot = message(fixture);
  snapshot.content.unshift({ type: "thinking", thinking: "**First title**\n\nFirst body.\n\n**Last title**\n\nLast body." });
  const manager = SessionManager.inMemory(process.cwd());
  manager.appendMessage(snapshot);
  const before = JSON.stringify(manager.getEntries());
  const contextBefore = convertToLlm(manager.buildSessionContext().messages);
  const row = new AssistantMessageComponent(snapshot, false, undefined, "Thinking...", 0, transformers());
  assert(plain(row).some(line => line.startsWith("- This long reply")), "Screen selection includes rendered list markers");
  assert.equal(JSON.stringify(manager.getEntries()), before);
  assert.deepEqual(convertToLlm(manager.buildSessionContext().messages), contextBefore);
  // This is the host's /copy text source, without invoking the OS clipboard.
  assert.equal(AgentSession.prototype.getLastAssistantText.call({ messages: [snapshot] } as AgentSession), fixture);
});

test("unrelated history is not re-transformed when the active reply updates", () => {
  initTheme("dark", false);
  const registered = transformers();
  const inputs: string[] = [];
  const transform: MarkdownTransformer = (source, context) => {
    inputs.push(source);
    return registered[0]!(source, context);
  };
  const history = Array.from({ length: 20 }, (_, index) => new AssistantMessageComponent(message(`History ${index}`), false, undefined, "Thinking...", 0, [transform]));
  for (const row of history) row.render(80);
  inputs.length = 0;
  const active = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 0, [transform]);
  for (const text of ["New", "New reply", "New reply complete"]) {
    active.updateContent(message(text), true);
    for (const row of history) row.render(80);
    active.render(80);
    active.render(80);
  }
  assert.deepEqual(inputs, ["New", "New reply", "New reply complete"]);
});
