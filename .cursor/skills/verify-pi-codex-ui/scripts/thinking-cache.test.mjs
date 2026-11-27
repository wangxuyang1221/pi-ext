import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import registerCodexUi from "../../../../extensions/codex-ui/dist/index.js";

test("Pi reuses completed Thinking blocks and their code highlighting while later text streams", context => {
  initTheme("dark");
  const transformers = [];
  registerCodexUi({
    on() {},
    registerTool() {},
    registerMarkdownTransformer(transform) { transformers.push(transform); },
  });

  const markdownTheme = getMarkdownTheme();
  const highlights = context.mock.method(markdownTheme, "highlightCode");
  const renders = context.mock.method(Markdown.prototype, "renderBlock");
  const assistant = new AssistantMessageComponent(undefined, false, markdownTheme, "Thinking...", 1, transformers);
  const prefix = "First paragraph\n\n```ts\nconst before = 1;\n\nconst after = 2;\n```\n\n";
  const render = (tail, width) => {
    assistant.updateContent({
      role: "assistant", timestamp: 1, stopReason: "stop",
      content: [{ type: "thinking", thinking: prefix + tail }],
    }, true);
    return assistant.render(width).map(stripTerminalSequences).join("\n");
  };

  assert.match(render("Streaming tail", 100), /│ {3}const before = 1;[^\n]*\n\s*│[^\S\n]*\n\s*│ {3}const after = 2;/u);
  assert.equal(highlights.mock.callCount(), 1, "The completed fence is highlighted on its first render");
  renders.mock.resetCalls();

  assert.match(render("Streaming tail grows", 100), /│ Streaming tail grows/u);
  assert.deepEqual(renders.mock.calls.map(call => call.arguments[1].raw), ["> Streaming tail grows"],
    "Only the growing top-level block should be rendered again");
  assert.match(render("Streaming tail grows", 70), /│ {3}const after = 2;/u);
  assert.equal(highlights.mock.callCount(), 1, "Appending text and resizing reuse the fence's highlights");
});
