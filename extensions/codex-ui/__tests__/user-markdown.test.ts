import assert from "node:assert/strict";
import { test } from "vitest";
import { initTheme, UserMessageComponent, type ExtensionAPI, type MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import codexUi from "../src/index.js";

function transformer(): MarkdownTransformer {
  let transform!: MarkdownTransformer;
  codexUi({ registerTool() {}, registerCommand() {}, on() {},
    registerMarkdownTransformer(fn: MarkdownTransformer) { transform = fn; },
  } as unknown as ExtensionAPI);
  return transform;
}
const contentLines = (row: UserMessageComponent, width = 80) => row.render(width).map(stripTerminalSequences);

test("user fenced code preserves literals and does not absorb following prose", () => {
  initTheme("dark", false);
  const source = '```ts\nconst value = "*literal*";\n```\n\nFollowing **note**.';
  const baseline = contentLines(new UserMessageComponent(source));
  const row = new UserMessageComponent(source, undefined, 1, [transformer()]);
  const lines = contentLines(row);
  assert(lines.some(line => line.includes('"*literal*"')));
  assert.deepEqual(lines, baseline);
  row.invalidate();
  assert.deepEqual(contentLines(row), lines);
});

test("all leading Markdown blocks render like native user content at every width", () => {
  initTheme("dark", false);
  const transform = transformer();
  for (const source of ["# Heading", "- First\n  - Nested\n- Second", "1. First\n2. Second",
    "| A | B |\n| --- | --- |\n| x | y |", "\n\n# Leading blanks", "    indented *literal* code",
    "```ts\nconst literal = '*text*';\n```\n\n**Following prose**", "Normal **paragraph**.", "", "› Existing marker", "›\n\nOriginal paragraph", "A long paragraph that wraps across several lines in a narrow terminal."]) {
    for (const width of [16, 40, 100]) {
      const baseline = new UserMessageComponent(source);
      const row = new UserMessageComponent(source, undefined, 1, [transform]);
      assert.deepEqual(contentLines(row, width), contentLines(baseline, width));
      assert(row.render(width).every(line => visibleWidth(line) <= width));
      const context = { messageType: "user" as const, isStreaming: false, availableWidth: width };
      assert.equal(transform(source, context), source);
      assert.equal(transform(transform(source, context), context), source);
    }
  }
  const ctx = { messageType: "user" as const, isStreaming: false, availableWidth: 80 };
  assert.equal(transform("", ctx), "");
  assert.equal(transform("› Existing marker", ctx), "› Existing marker");
});

test("updating one user component does not transform unchanged history", () => {
  initTheme("dark", false);
  const transform = transformer();
  const calls: string[] = [];
  const tracked: MarkdownTransformer = (text, context) => { calls.push(text); return transform(text, context); };
  const history = Array.from({ length: 20 }, (_, index) => new UserMessageComponent(`History ${index}`, undefined, 1, [tracked]));
  history.forEach(row => row.render(80)); calls.length = 0;
  const row = new UserMessageComponent("# New message", undefined, 1, [tracked]);
  for (let i = 0; i < 3; i++) { history.forEach(item => item.render(80)); row.render(80); }
  assert.deepEqual(calls, ["# New message"]);
});
