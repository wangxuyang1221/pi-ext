import { afterEach, beforeAll, expect, it } from "vitest";
import { CustomEditor, initTheme, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { type TUI } from "@earendil-works/pi-tui";
import { CodexEditor } from "../../codex-ui/src/components.js";
import { cleanup, lifecycleFixture } from "./lifecycle-fixture.js";
import { findReferences } from "../src/references.js";

const undo = "\x1b[45;5u";
const editors: CustomEditor[] = [];
beforeAll(() => initTheme("dark", false));
afterEach(async () => {
  for (const editor of editors.splice(0)) editor.setText("");
  await cleanup();
});

function editorFixture(kind: "native" | "codex") {
  const identity = (text: string) => text;
  const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} } as unknown as TUI;
  const keys = { matches: () => false } as unknown as KeybindingsManager;
  const theme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
  const editor = kind === "native" ? new CustomEditor(tui, theme, keys) : new CodexEditor(tui, theme, keys, () => ({ fg: (_key: string, text: string) => text, getBgAnsi: () => "" }) as unknown as Theme);
  editors.push(editor);
  return editor;
}

// These characterize rejected API strategies. They do not accept the label feature.
it.each(["native", "codex"] as const)("documents %s per-character deletion requiring one native undo per character", kind => {
  const editor = editorFixture(kind);
  const paste = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n");
  const reference = "$" + "a".repeat(64);
  editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
  editor.insertTextAtCursor(` ${reference}.`);
  editor.handleInput("\x1b[D");
  const original = editor.getExpandedText();
  expect(findReferences(editor.getText()).map(value => value.name)).toEqual([reference.slice(1)]);
  for (let i = 0; i < reference.length; i++) editor.handleInput("\x7f");
  expect(editor.getExpandedText()).toBe(`${paste} .`);
  editor.handleInput(undo);
  expect(editor.getExpandedText()).not.toBe(original);
  for (let i = 1; i < reference.length; i++) editor.handleInput(undo);
  expect(editor.getExpandedText()).toBe(original);
});

it.each(["native", "codex"] as const)("documents %s word-delete optimization changing the user's kill ring", kind => {
  const editor = editorFixture(kind);
  editor.insertTextAtCursor("keep");
  editor.handleInput("\x17");
  expect(editor.getText()).toBe("");
  editor.insertTextAtCursor("$alpha");
  editor.handleInput("\x17");
  expect(editor.getText()).toBe("$");
  editor.handleInput("\x7f");
  expect(editor.getText()).toBe("");
  editor.handleInput("\x19");
  expect(editor.getText()).toBe("alpha");
  expect(editor.getText()).not.toBe("keep");
});

it.each(["native", "codex"] as const)("documents %s setText deletion losing the expanded paste registry", kind => {
  const editor = editorFixture(kind);
  const paste = "x".repeat(1024);
  editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
  editor.insertTextAtCursor(" $alpha");
  const original = editor.getExpandedText();
  editor.setText(editor.getText().slice(0, -"$alpha".length));
  expect(editor.getExpandedText()).not.toBe(`${paste} `);
  expect(editor.getExpandedText()).toMatch(/^\[paste #1 /);
  editor.handleInput(undo);
  expect(editor.getExpandedText()).toBe(original);
});

function stageCompletionDeletion(editor: CustomEditor) {
  const reference = findReferences(editor.getText())[0];
  editor.setAutocompleteProvider({
    async getSuggestions() { return { prefix: "", items: [{ value: "audit", label: "audit" }] }; },
    applyCompletion(lines) {
      const text = lines.join("\n");
      return { lines: [text.slice(0, reference.start) + text.slice(reference.end)], cursorLine: 0, cursorCol: reference.start };
    },
  });
  editor.handleInput("\t");
}

it.each(["native", "codex"] as const)("documents %s completion-based splicing as atomic but asynchronous", async kind => {
  const editor = editorFixture(kind);
  editor.insertTextAtCursor("keep"); editor.handleInput("\x17");
  const paste = "x".repeat(1024);
  editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
  editor.insertTextAtCursor(" $alpha.");
  const original = editor.getExpandedText();
  let changes = 0;
  editor.onChange = () => { changes++; };
  stageCompletionDeletion(editor);
  expect(editor.getExpandedText()).toBe(original);
  expect(changes).toBe(0);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(editor.getExpandedText()).toBe(`${paste} .`);
  expect(changes).toBe(1);
  editor.handleInput(undo);
  expect(editor.getExpandedText()).toBe(original);
  editor.handleInput("\x19");
  expect(editor.getExpandedText()).toBe(original + "keep");
});

it.each(["native", "codex"] as const)("documents %s immediate submit overtaking a completion-based deletion", async kind => {
  const editor = editorFixture(kind);
  editor.insertTextAtCursor("Use $alpha.");
  let submitted: string | undefined;
  editor.onSubmit = value => { submitted = value; };
  stageCompletionDeletion(editor);
  editor.handleInput("\r");
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(submitted).toBe("Use $alpha.");
  expect(editor.getText()).toBe("");
});

it("captures per-message transformer functions through public registration without matching task text", async () => {
  let request = 0;
  const h = await lifecycleFixture({ extra: pi => {
    pi.on("message_start", event => {
      if (event.message.role !== "user") return;
      const id = ++request;
      pi.registerMarkdownTransformer((text, context) => context.messageType === "user" ? `${id} ${text}` : text);
    });
    pi.on("message_end", event => {
      if (event.message.role === "user") pi.registerMarkdownTransformer(text => text);
    });
  } });
  await h.session.prompt("same text");
  await h.session.prompt("same text");
  // Rendering starts only after both message_end events reset registration.
  expect(h.plain()).toContain("1 same text");
  expect(h.plain()).toContain("2 same text");
  h.mode.chatContainer.invalidate();
  expect(h.mode.chatContainer.render(40).join("\n")).toContain("1 same text");
  expect(h.rebuild()).not.toContain("1 same text");
  expect(h.errors).toEqual([]);
});
