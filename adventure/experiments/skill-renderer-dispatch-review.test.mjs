import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

// Source-level probe only. No installed Pi host, terminal, provider, or model is started.
// Supply an official source checkout with PI_REVIEW_SOURCE_ROOT, or run in a repository
// with @earendil-works/pi-coding-agent@0.86.0 and pi-tui@0.86.0 source maps installed.
const sourceRoot = process.env.PI_REVIEW_SOURCE_ROOT;
const expectedSourceHashes = {
  "packages/tui/src/tui.ts": "2ca47c56f4a4f24b8c6a4c9c9f2a06004bfc312d9dbcd0ac1921a2cae32bc675",
  "packages/tui/src/components/box.ts": "f79d30c9c263064df656dc55674b5d951bf765ffbbf658f400f449c44f6dab98",
  "packages/tui/src/components/text.ts": "3042e09dd8dcb870c23506e6fafb2dfcc095e7e375adad2fb62e447da17e5e3b",
  "packages/tui/src/components/spacer.ts": "b511acec1d33885dad23e7ab2108b2d04dff0589b3bfda53b1f7458be4381e66",
  "packages/tui/src/components/mouse-region.ts": "9dbcac616e8f8271b522b374bae29ab0b829d3771ce0ed228d6ae3da1c2be759",
  "packages/coding-agent/src/modes/interactive/components/markdown-transform.ts": "657edd0453dab59d362e0d18c330486b86a47fe7a33b8c32204db8ce23a142a9",
  "packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts": "7ec5c3e95413187aab7937740062cfa3c4dbac4754afbfa78810b6ad89ff0b27",
  "packages/coding-agent/src/modes/interactive/components/custom-message.ts": "321af8afdff8da4924a7dbf5623b5637eb160ea7d73a70e6662d8125249bde9b",
  "packages/coding-agent/src/modes/interactive/components/custom-entry.ts": "8796bd95c4b496aad74674bbfb0e286768731532ad5ab8f51e6471cfbfd9404e",
  "packages/coding-agent/src/modes/interactive/components/user-message.ts": "234d4f2544a0cb60082a6012a63576cdda4e9f99cdd0560129dd1efe5c6c7b1d",
  "packages/coding-agent/src/core/agent-session.ts": "3ea88a751cd830db66ae9348be9f8dfbd5218a01e74b445f3aee9fb87ad3e865",
  "packages/coding-agent/src/core/messages.ts": "5397e3c96c9504266e4ee8b6e88d5098b3280ee7dbb0c687b74708c62a06c8d4",
  "packages/coding-agent/src/modes/interactive/interactive-mode.ts": "01ebf39a2ce0b8939076fbd5cc78e9cad6f49f642a608cd3b2adb8d215e6c0f0"
};
const sourceRecords = [];
function source(repoPath) {
  let text;
  let origin;
  if (sourceRoot) {
    origin = path.join(sourceRoot, repoPath);
    text = readFileSync(origin, "utf8");
  } else {
    const match = repoPath.match(/^packages\/(coding-agent|tui)\/src\/(.*)\.ts$/);
    assert.ok(match, "Source path must refer to the audited Pi packages");
    origin = path.join(process.cwd(), "node_modules", "@earendil-works",
      match[1] === "coding-agent" ? "pi-coding-agent" : "pi-tui", "dist", match[2] + ".js.map");
    const map = JSON.parse(readFileSync(origin, "utf8"));
    const index = map.sources.findIndex((entry) => entry.endsWith(path.basename(repoPath)));
    assert.ok(index >= 0 && typeof map.sourcesContent[index] === "string", "Source map must embed TypeScript");
    text = map.sourcesContent[index];
  }
  const sha256 = createHash("sha256").update(text).digest("hex");
  assert.equal(sha256, expectedSourceHashes[repoPath], "Source must match the exact audited Pi 0.86.0 commit: " + repoPath);
  sourceRecords.push({ path: repoPath, sha256 });
  return text;
}

function evaluate(text, exports, bindings = {}) {
  const js = stripTypeScriptTypes(text, { mode: "strip" })
    .replace(/^import[\s\S]*?;\s*$/gm, "")
    .replace(/\bexport\s+(?=(?:class|function|const|let|var)\b)/g, "");
  return new Function(...Object.keys(bindings), js + "\nreturn { " + exports.join(", ") + " };")(...Object.values(bindings));
}

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "Audited extraction boundary must match source");
  return text.slice(from, to);
}

const tuiSource = source("packages/tui/src/tui.ts");
const dispatchSource = between(tuiSource, "export function dispatchMouseEvent(", "/** Recreate local coordinates");
const containerSource = between(tuiSource, "export class Container ", "/**\n * TUI - Main class");
const { dispatchMouseEvent, Container } = evaluate(dispatchSource + "\n" + containerSource, ["dispatchMouseEvent", "Container"]);

// Terminal styling/width are replaced. Fixtures are ASCII, single-width, and never wrap.
// These helpers deliberately reject inputs outside that evidence boundary.
const visibleWidth = (text) => {
  const plain = stripVTControlCharacters(text);
  assert.match(plain, /^[\x20-\x7e]*$/, "Width fixture must remain printable ASCII");
  return plain.length;
};
const wrapTextWithAnsi = (text, width) => text.split("\n").map((line) => {
  assert.ok(visibleWidth(line) <= width, "This probe does not implement terminal wrapping");
  return line;
});
const applyBackgroundToLine = (line, width, bg) => bg(line + " ".repeat(Math.max(0, width - visibleWidth(line))));
const common = { dispatchMouseEvent, visibleWidth, wrapTextWithAnsi, applyBackgroundToLine };
const { Box } = evaluate(source("packages/tui/src/components/box.ts"), ["Box"], common);
const { Text } = evaluate(source("packages/tui/src/components/text.ts"), ["Text"], common);
const { Spacer } = evaluate(source("packages/tui/src/components/spacer.ts"), ["Spacer"]);
const { MouseRegion } = evaluate(source("packages/tui/src/components/mouse-region.ts"), ["MouseRegion"], { dispatchMouseEvent });

const markdownCalls = [];
class MarkdownStub {
  constructor(text, paddingX, paddingY, theme, style, options = {}) {
    Object.assign(this, { text, paddingX, paddingY, options });
  }
  invalidate() {}
  render(width) {
    const availableWidth = Math.max(1, width - this.paddingX * 2);
    const displayed = this.options.transform?.(this.text, availableWidth) ?? this.text;
    markdownCalls.push({ source: this.text, displayed, availableWidth });
    if (!displayed || displayed.trim() === "") return [];
    return wrapTextWithAnsi(displayed, availableWidth);
  }
}
const theme = {
  fg: (_color, text) => text,
  bg: (_color, text) => "\x1b[48;5;237m" + text + "\x1b[49m",
};
const getMarkdownTheme = () => ({});
const keyText = () => "ctrl+o";
const { createMarkdownTransform } = evaluate(
  source("packages/coding-agent/src/modes/interactive/components/markdown-transform.ts"),
  ["createMarkdownTransform"]);
const components = { Box, Container, Text, Spacer, MouseRegion, Markdown: MarkdownStub, theme, getMarkdownTheme, keyText, createMarkdownTransform };
const { SkillInvocationMessageComponent } = evaluate(
  source("packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts"),
  ["SkillInvocationMessageComponent"], components);
const { CustomMessageComponent } = evaluate(
  source("packages/coding-agent/src/modes/interactive/components/custom-message.ts"),
  ["CustomMessageComponent"], components);
const { CustomEntryComponent } = evaluate(
  source("packages/coding-agent/src/modes/interactive/components/custom-entry.ts"),
  ["CustomEntryComponent"], components);
const { UserMessageComponent } = evaluate(
  source("packages/coding-agent/src/modes/interactive/components/user-message.ts"),
  ["UserMessageComponent"], components);
const agentSource = source("packages/coding-agent/src/core/agent-session.ts");
const { parseSkillBlock } = evaluate(
  between(agentSource, "export function parseSkillBlock(", "/** Session-specific events"),
  ["parseSkillBlock"]);
const { convertToLlm } = evaluate(source("packages/coding-agent/src/core/messages.ts"), ["convertToLlm"]);

const interactiveSource = source("packages/coding-agent/src/modes/interactive/interactive-mode.ts");
const hostMethod = between(interactiveSource, "\tprivate addMessageToChat(", "\n\tprivate renderSessionItems(");
const textMethod = between(interactiveSource, "\tprivate getUserMessageText(", "\n\t/** Show a managed-tool status");
const { SourceHost } = evaluate("class SourceHost {\n" + textMethod + hostMethod + "\n}", ["SourceHost"], {
  ...components, SkillInvocationMessageComponent, CustomMessageComponent, UserMessageComponent, parseSkillBlock,
});
function host(transformers = [], outputPad = 1, customRenderer) {
  const result = new SourceHost();
  Object.assign(result, {
    chatContainer: new Container(), outputPad, toolOutputExpanded: false,
    getMarkdownThemeWithSettings: getMarkdownTheme,
    getMarkdownTransformers: () => transformers,
    editor: { addToHistory() {} },
    session: { extensionRunner: { getMessageRenderer: () => customRenderer } },
  });
  return result;
}

const results = [];
function test(name, run) {
  const details = run();
  results.push({ name, status: "pass", ...details });
}
function summarize(component) {
  const raw = component.render(80);
  return {
    rows: raw.length,
    lines: raw.map((line) => stripVTControlCharacters(line).trimEnd()),
    hasBackgroundAnsi: raw.some((line) => line.includes("\x1b[48;5;237m")),
  };
}
const skillXml = '<skill name="adventure" location="/fixture/adventure/SKILL.md">\nFollow the quest workflow.\n</skill>';
const task = "Plan a quest.";
const nativeText = skillXml + "\n\n" + task;
const taskFirstEnvelope = task + "\n\n" + skillXml;
const image = { type: "image", data: "fixture-not-decoded", mimeType: "image/png" };
const userMessage = (text) => ({ role: "user", content: [{ type: "text", text }, image], timestamp: 1 });

test("native skill bypasses user transformers; only task suffix is transformed", () => {
  const seen = [];
  const h = host([(text, context) => { seen.push({ text, context }); return text; }]);
  h.addMessageToChat(userMessage(nativeText));
  assert.ok(h.chatContainer.children[0] instanceof SkillInvocationMessageComponent);
  assert.ok(h.chatContainer.children[2] instanceof UserMessageComponent);
  const output = summarize(h.chatContainer);
  assert.deepEqual(seen.map((entry) => entry.text), [task]);
  assert.equal(output.rows, 7);
  return { output, transformedSource: seen[0].text };
});

test("task-first full snapshot uses ordinary user renderer and display-only transformer", () => {
  assert.equal(parseSkillBlock(taskFirstEnvelope), null);
  const message = userMessage(taskFirstEnvelope);
  const before = JSON.stringify(message);
  const seen = [];
  const h = host([(text, context) => {
    seen.push({ text, context });
    assert.equal(text, taskFirstEnvelope);
    return "Skill: adventure | " + task;
  }]);
  h.addMessageToChat(message);
  assert.equal(h.chatContainer.children.length, 1);
  assert.ok(h.chatContainer.children[0] instanceof UserMessageComponent);
  const output = summarize(h.chatContainer);
  assert.equal(output.rows, 3);
  assert.deepEqual(seen, [{ text: taskFirstEnvelope, context: { messageType: "user", isStreaming: false, availableWidth: 78 } }]);
  assert.equal(JSON.stringify(message), before);
  const converted = convertToLlm([message]);
  assert.strictEqual(converted[0], message);
  assert.strictEqual(converted[0].content[1], image);
  assert.equal(converted[0].content[0].text, taskFirstEnvelope);
  return { output, modelRole: converted[0].role, fullSnapshotPreserved: true, imagePreserved: true };
});

test("two paragraph user declaration keeps one ordinary user box", () => {
  const h = host([() => "Skill: adventure\n\n" + task]);
  h.addMessageToChat(userMessage(taskFirstEnvelope));
  const output = summarize(h.chatContainer);
  assert.equal(output.rows, 5);
  return { output };
});

test("outputPad changes ordinary user horizontal padding only", () => {
  const h = host([() => "Skill: adventure | " + task], 0);
  h.addMessageToChat(userMessage(taskFirstEnvelope));
  const output = summarize(h.chatContainer);
  assert.equal(output.rows, 3);
  assert.equal(output.lines[1], "Skill: adventure | " + task);
  const native = host([], 0);
  native.addMessageToChat(userMessage(nativeText));
  const nativeOutput = summarize(native.chatContainer);
  assert.equal(nativeOutput.rows, 7);
  assert.equal(nativeOutput.lines[1].startsWith(" "), true);
  return { ordinaryUserOutput: output, nativeSkillStillHasHorizontalPadding: true };
});

test("custom renderer replaces fallback box but retains host spacer", () => {
  const custom = { role: "custom", customType: "skill-review-fixture", display: true, content: nativeText, timestamp: 1 };
  const seenOptions = [];
  const h = host([], 0, (_message, options) => {
    seenOptions.push(options);
    return new Text("Skill: adventure", 0, 0);
  });
  h.addMessageToChat(custom);
  const output = summarize(h.chatContainer);
  assert.equal(output.rows, 2);
  assert.equal(output.hasBackgroundAnsi, false);
  assert.deepEqual(seenOptions[0], { expanded: false, outputPad: 0 });
  const fallback = new CustomMessageComponent(custom);
  assert.equal(summarize(fallback).hasBackgroundAnsi, true);
  const model = convertToLlm([custom])[0];
  assert.equal(model.role, "user");
  assert.equal(model.content[0].text, nativeText);
  return { output, sessionRole: custom.role, modelRole: model.role };
});

test("custom entry renderer has one spacer and no imposed content box", () => {
  const entry = { type: "custom", customType: "skill-review-fixture", data: {}, id: "fixture", parentId: null, timestamp: "1970-01-01T00:00:00Z" };
  const component = new CustomEntryComponent(entry, () => new Text("Skill: adventure", 0, 0));
  const output = summarize(component);
  assert.equal(output.rows, 2);
  assert.equal(output.hasBackgroundAnsi, false);
  const hidden = new CustomEntryComponent(entry, () => undefined);
  assert.equal(hidden.hasContent(), false);
  assert.equal(hidden.render(80).length, 0);
  return { output, undefinedRendererRows: 0 };
});

test("empty display transform suppresses user box; preceding transcript spacer remains", () => {
  const first = host([() => ""]);
  first.addMessageToChat(userMessage(taskFirstEnvelope));
  assert.equal(first.chatContainer.render(80).length, 0);
  const later = host([() => ""]);
  later.chatContainer.addChild(new Text("Earlier message", 0, 0));
  later.addMessageToChat(userMessage(taskFirstEnvelope));
  const output = summarize(later.chatContainer);
  assert.equal(output.rows, 2);
  assert.deepEqual(output.lines, ["Earlier message", ""]);
  return { firstUserRows: 0, laterUserAddsOnlySpacerRows: 1 };
});

test("multiple skill snapshots need not use the single native skill parser", () => {
  const second = '<skill name="review" location="/fixture/review/SKILL.md">\nReview each decision.\n</skill>';
  const message = userMessage(task + "\n\n" + skillXml + "\n\n" + second);
  assert.equal(parseSkillBlock(message.content[0].text), null);
  const h = host([() => "Skills: adventure, review | " + task]);
  h.addMessageToChat(message);
  const output = summarize(h.chatContainer);
  assert.equal(output.rows, 3);
  assert.strictEqual(convertToLlm([message])[0], message);
  return { output, bothSnapshotsPreserved: message.content[0].text.includes(skillXml) && message.content[0].text.includes(second) };
});

console.log(JSON.stringify({
  auditVersion: "Pi 0.86.0",
  auditCommit: "ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc",
  node: process.version,
  scope: "Source components, transcript dispatch, Markdown transform chain and message conversion",
  substitutions: [
    "MarkdownStub applies the real transform but does not parse Markdown",
    "Theme, terminal styling and ASCII non-wrapping width helpers are substitutes",
    "SourceHost supplies a substitute session/UI environment for actual addMessageToChat",
    "No real session lifecycle, PTY, model call, reload, queue or compaction was run"
  ],
  count: results.length,
  results,
  sourceRecords,
}, null, 2));

