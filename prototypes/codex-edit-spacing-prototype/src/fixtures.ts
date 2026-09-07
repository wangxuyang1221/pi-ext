// PROTOTYPE: Restored results only; these tool calls never execute.
import type { AssistantMessage } from "@earendil-works/pi-ai";
export const fixtures = [
  {
    id: "spacing-context", name: "read", args: { path: "README.md" },
    result: { content: [{ type: "text" as const, text: "# Edit spacing prototype\nFixture-only comparison." }], isError: false },
  },
  {
    id: "spacing-addition", name: "edit",
    args: { path: "prototypes/codex-reasoning-ui-prototype/pty-smoke.mjs", edits: [{ oldText: "    if (upgrade) {", newText: [
      '    if (variant === "production" && !upgrade) {',
      '      assert.doesNotMatch(all, /Preparing response|Running|Thinking/u,',
      '        "Production must not emit generic reasoning status");',
      '    }',
      '    if (upgrade) {',
    ].join("\n") }] },
    result: {
      content: [{ type: "text" as const, text: "Successfully replaced 1 block." }], isError: false,
      details: { patch: "", diff: [
        ' 128     assert.match(text("narrow"), /final segment/u);',
        ' 129     assert.match(text("aborted"), /aborted/u);',
        ' 130     assert.match(text("reload"), /Reload/u);',
        ' 131     assert.match(text("restored"), /final segment/u);',
        '+132     if (variant === "production" && !upgrade) {',
        '+133       assert.doesNotMatch(all, /Preparing response|Running|Thinking/u,',
        '+134         "Production must not emit generic reasoning status");',
        '+135     }',
        ' 136     if (upgrade) {',
        ' 137       assert.equal(raw("restartedQuiet").length, 0);',
        ' 138       assert.match(text("restartedLive"), /Read/u);',
        ' 139       console.log("Hot reload complete");',
        ' 140     }',
        ' 141     const restored = text("restored");',
        ' 142     assert.ok(restored.length > 0);',
        ' 143     console.log("Fixture checks passed");',
      ].join("\n") },
    },
  },
  {
    id: "spacing-replacement", name: "edit",
    args: { path: "src/renderer.ts", edits: [{ oldText: "const gap = 1;", newText: "const gap = 0;" }] },
    result: {
      content: [{ type: "text" as const, text: "Successfully replaced 1 block." }], isError: false,
      details: { patch: "", diff: ' 7 export function render() {\n-8   const gap = 1;\n+8   const gap = 0;\n 9   return layout(gap);\n 10 }' },
    },
  },
];

export const replyMarkdown = [
  "This reply preview runs inside the same Pi transcript as the edit cards above. Compare the left edge of this long paragraph, its wrapped lines and the paragraphs below. All variants use the native Markdown renderer.",
  "List mode adds one outer list item. Quote mode adds a vertical rail and uses the native quote color and italic style. Current mode keeps the original layout. Resize the terminal and compare which treatment is easier to read.",
  "## What to compare",
  "- Compare syntax highlighting and link colors.\n- Check the extra indentation of this list.\n  - This is a nested item.\n- Thinking summaries and tool cards keep their existing layout.",
  "```ts\nexport function renderReply(text: string) {\n  return renderMarkdown(text);\n}\n```",
  "Read the [Pi documentation](https://pi.dev) or compare **bold text** with `inline code`. Check whether the marker placement and paragraph spacing help separate this reply from the tool cards.",
  "Reply layout fixture complete.",
].join("\n\n");

export const assistantReply: AssistantMessage = {
  role: "assistant", timestamp: 1, api: "openai-responses", provider: "spacing-ui-fixture", model: "fixture", stopReason: "stop",
  content: [{ type: "thinking", thinking: "**Reviewing reply layout**\n\n**Checking paragraph alignment**" }, { type: "text", text: replyMarkdown }],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};
