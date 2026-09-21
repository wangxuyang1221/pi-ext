import { beforeAll, expect, it } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { createEditor, deleteReference, paste, undoGroup, undoKey } from "./probe.js";

beforeAll(() => initTheme("dark", false));
const smallPaste = Array.from({ length: 12 }, (_, index) => `${index}: ${"p".repeat(330)}`).join("\n");
const matrix = (["native", "codex"] as const).flatMap(kind => (["backward", "forward"] as const).flatMap(direction => [64, 256, 1024].map(length => ({ kind, direction, length }))));

it.each(matrix)("$kind restores a $length-character reference after $direction deletion without eviction", ({ kind, direction, length }) => {
  const editor = createEditor(kind), name = "a".repeat(length);
  paste(editor, smallPaste);
  editor.insertTextAtCursor(` $${name}.`);
  for (let i = 0; i < (direction === "backward" ? 1 : length + 2); i++) editor.handleInput("\x1b[D");
  const raw = editor.getText(), expanded = editor.getExpandedText(), cursor = editor.getCursor();
  let changes = 0;
  editor.onChange = () => { changes++; };
  const group = deleteReference(editor, direction);
  expect(group.steps).toBe(length + 1);
  expect(editor.getExpandedText()).toBe(`${smallPaste} .`);
  expect(editor.getText()).toMatch(/^\[paste #1 \+12 lines\] \.$/);
  expect(changes).toBe(length + 1);
  undoGroup(editor, group);
  expect(editor.getText()).toBe(raw);
  expect(editor.getExpandedText()).toBe(expanded);
  expect(editor.getCursor()).toEqual(cursor);
  expect(changes).toBe(2 * (length + 1));
  // All deletion snapshots were consumed, so the next native undo removes the insertion.
  editor.handleInput(undoKey);
  expect(editor.getExpandedText()).toBe(smallPaste);
  editor.onChange = undefined;
  editor.handleInput("\r");
});

it.each(["native", "codex"] as const)("%s retains earlier groups across 1349 native deletion snapshots", kind => {
  const editor = createEditor(kind);
  paste(editor, smallPaste);
  const names = [64, 256, 1024].map(length => "a".repeat(length));
  editor.insertTextAtCursor(` $${names[0]} $${names[1]} $${names[2]}`);
  const original = editor.getExpandedText(), groups = [];
  for (let i = 0; i < 3; i++) {
    groups.push(deleteReference(editor, "backward"));
    if (i < 2) {
      editor.handleInput("\x7f");
      groups.push({ steps: 1 });
    }
  }
  expect(groups.reduce((sum, value) => sum + value.steps, 0)).toBe(1349);
  expect(editor.getExpandedText()).toBe(smallPaste + " ");
  const expected = [
    `${smallPaste} $${names[0]}`,
    `${smallPaste} $${names[0]} `,
    `${smallPaste} $${names[0]} $${names[1]}`,
    `${smallPaste} $${names[0]} $${names[1]} `,
    original,
  ];
  for (const text of expected) {
    undoGroup(editor, groups.pop()!);
    expect(editor.getExpandedText()).toBe(text);
  }
  editor.handleInput(undoKey);
  expect(editor.getExpandedText()).toBe(smallPaste);
  editor.handleInput("\r");
});

it.each(["native", "codex"] as const)("%s keeps deletion snapshots after setText clears the visible draft", kind => {
  const editor = createEditor(kind);
  paste(editor, smallPaste); editor.insertTextAtCursor(" $" + "a".repeat(256));
  const original = editor.getExpandedText();
  const group = deleteReference(editor, "backward");
  editor.setText("");
  expect(editor.getText()).toBe("");
  editor.handleInput(undoKey);
  expect(editor.getExpandedText()).toBe(smallPaste + " ");
  undoGroup(editor, group);
  expect(editor.getExpandedText()).toBe(original);
  editor.handleInput("\r");
});

it.each(["native", "codex"] as const)("%s submits the synchronous deletion result and clears native undo history", kind => {
  const editor = createEditor(kind);
  paste(editor, smallPaste); editor.insertTextAtCursor(" $" + "a".repeat(1024));
  deleteReference(editor, "backward");
  expect(editor.getExpandedText()).toBe(smallPaste + " ");
  let submitted: string | undefined;
  editor.onSubmit = value => { submitted = value; };
  editor.handleInput("\r");
  expect(submitted).toBe(smallPaste);
  for (let i = 0; i < 1030; i++) editor.handleInput(undoKey);
  expect(editor.getText()).toBe("");
  expect(editor.getExpandedText()).toBe("");
});

it.each(["native", "codex"] as const)("%s leaves kill ring unchanged across synchronous grouped deletion and undo", kind => {
  const editor = createEditor(kind);
  editor.insertTextAtCursor("keep"); editor.handleInput("\x17");
  paste(editor, smallPaste); editor.insertTextAtCursor(" $" + "a".repeat(1024));
  const original = editor.getExpandedText();
  undoGroup(editor, deleteReference(editor, "backward"));
  expect(editor.getExpandedText()).toBe(original);
  editor.handleInput("\x19");
  expect(editor.getExpandedText()).toBe(original + "keep");
  editor.handleInput("\r");
});

it.each(["native", "codex"] as const)("%s demonstrates an extra undo when a supplementary-plane name is counted as UTF-16 units", kind => {
  const editor = createEditor(kind);
  editor.insertTextAtCursor("before ");
  editor.insertTextAtCursor("$𠮷");
  const original = editor.getText();
  const group = deleteReference(editor, "backward");
  expect(group.steps).toBe(2);
  expect("$𠮷".length).toBe(3);
  undoGroup(editor, { steps: "$𠮷".length });
  expect(editor.getText()).toBe("before ");
  expect(editor.getText()).not.toBe(original);
  editor.handleInput("\r");
});

it.each(["native", "codex"] as const)("%s counts native grapheme steps rather than UTF-16 code units", kind => {
  const editor = createEditor(kind);
  const name = "𠮷".repeat(64);
  paste(editor, smallPaste); editor.insertTextAtCursor(` $${name}`);
  const original = editor.getExpandedText();
  const group = deleteReference(editor, "backward");
  expect(group.steps).toBe(65);
  undoGroup(editor, group);
  expect(editor.getExpandedText()).toBe(original);
  editor.handleInput(undoKey);
  expect(editor.getExpandedText()).toBe(smallPaste);
  editor.handleInput("\r");
});
