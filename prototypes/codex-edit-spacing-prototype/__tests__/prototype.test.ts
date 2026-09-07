import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AssistantMessageComponent, ToolExecutionComponent, type ExtensionAPI, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../../../extensions/codex-ui/src/tools.js";
import { assistantReply, fixtures, replyMarkdown } from "../src/fixtures.js";
import { installReplyLayout, type ReplyStyle } from "../src/reply-layout.js";
import { registerReplyLab } from "../src/reply-controls.js";
import composed, { registerSpacingLab } from "../src/index.js";
import { wrapEditTool, type LabState } from "../src/renderers.js";

const repository = process.env.PI_SPACING_LAB_REPOSITORY!;
const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const themeModule = await import(pathToFileURL(join(dirname(entry), "modes/interactive/theme/theme.js")).href);
const theme: Theme = themeModule.loadThemeFromPath(join(repository, "themes/codex-pi.json"), "truecolor");
themeModule.setThemeInstance(theme);

function harness(fixtureIndex = 1) {
  const tools = new Map<string, ToolDefinition>();
  registerCodexTools({ registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); }, on() {} } as unknown as ExtensionAPI);
  const lab: LabState = { variant: 1, invalidators: new Map() };
  const tool = wrapEditTool(tools.get("edit")!, lab);
  const fixture = fixtures[fixtureIndex]!;
  const row = new ToolExecutionComponent("edit", fixture.id, fixture.args, { showImages: false }, tool, { requestRender() {} } as TUI, repository);
  row.updateResult(fixture.result);
  const switchTo = (variant: 1 | 2 | 3) => {
    lab.variant = variant;
    for (const invalidate of lab.invalidators.values()) invalidate();
  };
  return { row, switchTo, tool, lab };
}

test("all three styles separate the title without consuming a blank terminal row", () => {
  const h = harness();
  const outputs: string[][] = [];
  for (const variant of [1, 2, 3] as const) {
    h.switchTo(variant);
    const lines = h.row.render(120);
    const plain = lines.map(stripTerminalSequences);
    const title = plain.findIndex(line => line.includes("Edited "));
    assert(title >= 0);
    assert.match(plain[title + 1]!, /128.*assert\.match/u);
    assert.equal(plain.filter(line => line.includes("Edited ")).length, 1);
    if (variant === 1) assert(lines[title]!.includes(theme.getBgAnsi("customMessageBg")));
    if (variant === 2) assert(lines[title]!.includes("\x1b[4m"));
    else assert(!lines[title]!.includes("\x1b[4m"));
    if (variant === 3) assert.match(plain[title + 1]!, /^  │ /u);
    outputs.push(plain);
  }
  assert.equal(outputs[0]!.length, outputs[1]!.length);
  assert.equal(outputs[1]!.length, outputs[2]!.length);
});

test("commands and shortcuts switch styles, reject invalid input, and release invalidators", async () => {
  const h = harness();
  const commands = new Map<string, any>();
  const shortcuts = new Map<string, any>();
  const events = new Map<string, any>();
  registerSpacingLab({
    registerCommand(name: string, value: any) { commands.set(name, value); },
    registerShortcut(key: string, value: any) { shortcuts.set(key, value); },
    on(name: string, value: any) { events.set(name, value); },
  } as unknown as ExtensionAPI, h.lab);
  assert(commands.has("edit-style"));
  for (const variant of [1, 2, 3] as const) {
    await commands.get("edit-style").handler(String(variant), {});
    assert.equal(h.lab.variant, variant);
    await shortcuts.get(`alt+${variant}`).handler();
    assert.equal(h.lab.variant, variant);
  }
  await commands.get("edit-style").handler("4", { ui: { notify() {} } });
  assert.equal(h.lab.variant, 3);
  assert.equal(events.get("input")({}, { ui: { notify() {} } }).action, "handled");
  assert.equal(events.get("tool_call")().block, true);
  assert.equal(events.get("user_bash")().result.exitCode, 1);
  events.get("session_shutdown")();
  assert.equal(h.lab.invalidators.size, 0);
});

test("expansion, repaint, syntax colors, and the footer gap survive all styles", () => {
  const h = harness();
  for (const variant of [1, 2, 3] as const) {
    h.switchTo(variant);
    h.row.setExpanded(false);
    let lines = h.row.render(120);
    const footer = lines.findIndex(line => stripTerminalSequences(line).includes("4 lines hidden"));
    assert(footer > 0);
    assert.equal(stripTerminalSequences(lines[footer - 1]!).trim(), "");
    assert(lines.some(line => line.includes(theme.getBgAnsi("toolSuccessBg"))));
    h.row.setExpanded(true);
    const expanded = h.row.render(120);
    assert(expanded.some(line => stripTerminalSequences(line).includes("Fixture checks passed")));
    assert(!expanded.some(line => stripTerminalSequences(line).includes("lines hidden")));
    h.row.invalidate();
    assert.deepEqual(h.row.render(120), expanded);
    for (const width of [0, 1, 2, 3, 4, 10, 40, 60, 120, 200]) {
      lines = h.row.render(width);
      assert(lines.every(line => visibleWidth(line) <= width), `${variant}/${width}`);
    }
  }
});

test("replacement diffs retain red and green rows and source column alignment", () => {
  const h = harness(2);
  const bodies: string[][] = [];
  for (const variant of [1, 2, 3] as const) {
    h.switchTo(variant);
    const lines = h.row.render(120);
    assert(lines.some(line => line.includes(theme.getBgAnsi("toolErrorBg"))));
    assert(lines.some(line => line.includes(theme.getBgAnsi("toolSuccessBg"))));
    bodies.push(lines.map(stripTerminalSequences).filter(line => /\d+ [ +\-] /u.test(line)).map(line => line.slice(4)));
  }
  assert.equal(bodies[0]!.length, 5);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[1], bodies[2]);
});

test("errors, partial results, and absent diffs keep their production presentation", async () => {
  const h = harness();
  for (const variant of [1, 2, 3] as const) {
    h.switchTo(variant);
    for (const [text, isError, partial, expected] of [
      ["permission denied", true, false, /permission denied/u],
      ["", false, true, /Editing/u],
      ["Applied", false, false, /Applied/u],
    ] as const) {
      h.row.updateResult({ content: [{ type: "text", text }], isError }, partial);
      const lines = h.row.render(120);
      const plain = stripTerminalSequences(lines.join("\n"));
      assert.match(plain, expected);
      assert.doesNotMatch(plain, /│/u);
      assert(!lines.some(line => line.includes(theme.getBgAnsi("customMessageBg"))));
      assert(!lines.some(line => line.includes("\x1b[4m")));
    }
  }
  await assert.rejects(h.tool.execute("fixture", {}, undefined, undefined, {} as never), /disabled/u);
});

test("reply layout adds one marker and a shared body column without rewriting Markdown", () => {
  let style: ReplyStyle = "indented";
  const patch = installReplyLayout(() => style, () => theme);
  const message = { ...assistantReply, content: [{ type: "text" as const, text: replyMarkdown }] };
  const before = structuredClone(message);
  const native = new AssistantMessageComponent({ ...message, provider: "unrelated-fixture" }, false, undefined, "Hidden thinking", 0);
  try {
    const row = new AssistantMessageComponent(message, false, undefined, "Hidden thinking", 0);
    const baseline = native.render(68).map(stripTerminalSequences).filter(line => line.trim());
    const proposed = row.render(70).map(stripTerminalSequences).filter(line => line.trim());
    assert.match(proposed[0]!, /^• This reply preview/u);
    assert.equal(proposed.filter(line => line.startsWith("• ")).length, 1);
    assert(proposed.slice(1).every(line => line.startsWith("  ")));
    assert.deepEqual(proposed.map(line => line.slice(2)), baseline);
    style = "current";
    patch.refresh();
    assert.deepEqual(row.render(70), native.render(70));
    assert.deepEqual(message, before);
  } finally { patch.dispose(); }
});

test("reply layout preserves thinking, streaming, multiple text blocks, and narrow widths", () => {
  const original = AssistantMessageComponent.prototype.updateContent;
  const patch = installReplyLayout(() => "indented", () => theme);
  const message = structuredClone(assistantReply);
  message.content.push({ type: "text", text: "A second text block must not add another marker." });
  const before = structuredClone(message);
  try {
    const row = new AssistantMessageComponent(message, false, undefined, "Hidden thinking", 0);
    const lines = row.render(100).map(stripTerminalSequences).filter(line => line.trim());
    assert(lines.some(line => line.startsWith("Reviewing reply layout")));
    assert(lines.some(line => line.startsWith("Checking paragraph alignment")));
    assert.equal(lines.filter(line => line.startsWith("• ")).length, 1);
    assert(lines.some(line => line.startsWith("  A second text block")));
    const replyOnly = new AssistantMessageComponent({ ...message, content: message.content.filter(block => block.type === "text") }, false, undefined, "Hidden thinking", 0);
    for (const width of [0, 1, 2, 3, 8, 24, 60, 100, 180]) {
      assert(replyOnly.render(width).every(line => visibleWidth(line) <= width), `reply width ${width}`);
    }
    for (const text of ["", "First", "First line wraps naturally. ".repeat(8), "## Heading first\n\nBody after heading", "| Key | Value |\n| --- | --- |\n| width | forty columns |"] ) {
      const partial = { ...message, content: [{ type: "text" as const, text }] };
      row.updateContent(partial, true);
      const rendered = row.render(40).map(stripTerminalSequences).filter(line => line.trim());
      assert.equal(rendered.filter(line => line.startsWith("• ")).length, text ? 1 : 0);
      assert(rendered.every(line => visibleWidth(line) <= 40));
      row.updateContent(partial, false);
      assert.deepEqual(row.render(40).map(stripTerminalSequences).filter(line => line.trim()), rendered);
    }
    assert.deepEqual(message, before);
  } finally { patch.dispose(); patch.dispose(); }
  assert.equal(AssistantMessageComponent.prototype.updateContent, original);
});

test("prototype comparisons bypass only the production assistant transform", async () => {
  const transforms: any[] = [];
  const commands = new Map<string, any>();
  composed({
    registerTool() {}, registerShortcut() {}, registerProvider() {}, on() {},
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerMarkdownTransformer(transform: any) { transforms.push(transform); },
  } as unknown as ExtensionAPI);
  const transform = (source: string, messageType: string) => transforms.reduce((value, next) => next(value, { messageType, isStreaming: false, availableWidth: 80 }), source);
  const context = { ui: { notify() {} } };
  await commands.get("reply-style").handler("list", context);
  assert.equal(transform("Reply fixture", "assistant"), "- Reply fixture");
  await commands.get("reply-style").handler("current", context);
  assert.equal(transform("Reply fixture", "assistant"), "Reply fixture");
  assert.equal(transform("Hello", "user"), "› Hello");
  assert.equal(transform("**Reviewing layout**", "assistant-thinking"), "• **Reviewing layout**");
});

test("public reply styles repaint native Markdown without patching the host", async () => {
  const original = AssistantMessageComponent.prototype.updateContent;
  const commands = new Map<string, any>();
  const shortcuts = new Map<string, any>();
  const events = new Map<string, any>();
  const transformers: any[] = [];
  registerReplyLab({
    registerCommand(name: string, value: any) { commands.set(name, value); },
    registerShortcut(key: string, value: any) { shortcuts.set(key, value); },
    registerMarkdownTransformer(value: any) { transformers.push(value); },
    on(name: string, value: any) { events.set(name, value); },
  } as unknown as ExtensionAPI);
  assert.equal(transformers.length, 1);
  const before = structuredClone(assistantReply);
  const row = new AssistantMessageComponent(assistantReply, false, undefined, "Hidden thinking", 0, transformers);
  let invalidations = 0;
  const tui = { invalidate() { invalidations++; row.invalidate(); }, requestRender() {} };
  const context = { mode: "tui", ui: { theme, setWidget(_name: string, factory: any) { factory?.(tui, theme); }, notify() {} } };
  const plain = () => row.render(70).map(stripTerminalSequences).join("\n");
  try {
    events.get("session_start")({}, context);
    assert.match(plain(), /^- This reply preview/mu);
    assert.match(plain(), /^  What to compare/mu);
    assert.match(plain(), /^Reviewing reply layout/mu);
    assert.equal(AssistantMessageComponent.prototype.updateContent, original);
    await commands.get("reply-style").handler("quote", context);
    assert.match(plain(), /^│ This reply preview/mu);
    assert.match(plain(), /^│ What to compare/mu);
    await commands.get("reply-style").handler("current", context);
    assert.match(plain(), /^This reply preview/mu);
    await shortcuts.get("alt+r").handler();
    assert.match(plain(), /^- This reply preview/mu);
    await commands.get("reply-style").handler("invalid", context);
    assert.match(plain(), /^- This reply preview/mu);
    await commands.get("reply-style").handler("indented", context);
    assert.match(plain(), /^- This reply preview/mu);
    assert(invalidations >= 3);
    assert.deepEqual(assistantReply, before);
  } finally { events.get("session_shutdown")?.(); }
  assert.equal(AssistantMessageComponent.prototype.updateContent, original);
});

test("public reply transforms preserve source and handle partial Markdown and narrow widths", () => {
  for (const style of ["list", "quote"] as const) {
    const transformers: any[] = [];
    registerReplyLab({
      registerCommand() {}, registerShortcut() {}, on() {},
      registerMarkdownTransformer(value: any) { transformers.push(value); },
    } as unknown as ExtensionAPI, style);
    const transform = transformers[0]!;
    for (const messageType of ["user", "assistant-thinking"]) {
      assert.equal(transform(replyMarkdown, { messageType, isStreaming: true }), replyMarkdown);
    }
    assert.equal(transform(" \n", { messageType: "assistant", isStreaming: true }), " \n");
    for (const text of ["", "First", "中文与 English 自动换行。 ".repeat(12), "## Heading first\n\nBody", "- Item\n  - Nested", "```ts\nconst ready =", "```ts\nconst ready = true;\n```", "| Key | Value |\n| --- | --- |\n| a | b |"] ) {
      const message = { ...assistantReply, content: [{ type: "text" as const, text }] };
      const before = structuredClone(message);
      const row = new AssistantMessageComponent(message, false, undefined, "Hidden thinking", 0, transformers);
      row.updateContent(message, true);
      for (const width of [24, 60, 100]) {
        const lines = row.render(width);
        assert(lines.every(line => visibleWidth(line) <= width), `${style}/${width}/${text}`);
      }
      const partial = row.render(60);
      row.updateContent(message, false);
      assert.deepEqual(row.render(60), partial);
      assert.deepEqual(message, before);
    }
  }
});

test("legacy reply controls switch existing rows and restore the host method on shutdown", async () => {
  const original = AssistantMessageComponent.prototype.updateContent;
  const commands = new Map<string, any>();
  const shortcuts = new Map<string, any>();
  const events = new Map<string, any>();
  registerReplyLab({
    registerCommand(name: string, value: any) { commands.set(name, value); },
    registerShortcut(key: string, value: any) { shortcuts.set(key, value); },
    on(name: string, value: any) { events.set(name, value); },
    registerMarkdownTransformer() {},
  } as unknown as ExtensionAPI, "indented", installReplyLayout);
  assert(commands.has("reply-style"));
  const context = { mode: "tui", ui: { theme, setWidget() {}, notify() {} } };
  try {
    events.get("session_start")({}, context);
    const row = new AssistantMessageComponent({ ...assistantReply, content: [{ type: "text", text: "Reply fixture" }] }, false, undefined, "Hidden thinking", 0);
    const plain = () => stripTerminalSequences(row.render(80).join("\n")).trim();
    assert.equal(plain(), "• Reply fixture");
    await commands.get("reply-style").handler("current", context);
    assert.equal(plain(), "Reply fixture");
    await shortcuts.get("alt+r").handler();
    assert.equal(plain(), "• Reply fixture");
    await commands.get("reply-style").handler("invalid", context);
    assert.equal(plain(), "• Reply fixture");
  } finally { events.get("session_shutdown")?.(); }
  assert.equal(AssistantMessageComponent.prototype.updateContent, original);
});
