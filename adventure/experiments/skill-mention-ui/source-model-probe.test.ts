import { expect, it } from "vitest";
import { CombinedAutocompleteProvider, Editor, stripTerminalSequences, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { sourceModelProbe } from "./source-model-probe.js";
import { skillAutocomplete } from "../../../extensions/skill-mentions/src/autocomplete.js";

const identity = (text: string) => text;
const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} } as unknown as TUI;
const names = new Set(["presentations"]);
const cube = "\u{f01a7}";

it("automatically projects a completed reference without changing the native source buffer or undo units", () => {
  const base = new Editor(tui, theme);
  const changes: string[] = [];
  base.onChange = text => changes.push(text);
  const editor = sourceModelProbe(base, names);
  for (const char of "$presentations") editor.handleInput(char);
  expect(editor.render(80).join("")).not.toContain(cube);
  editor.handleInput(" ");
  expect(editor.render(80).map(stripTerminalSequences).join("")).toContain(cube + " presentations");
  expect(base.getText()).toBe("$presentations ");
  expect(changes).toHaveLength(15);
  editor.handleInput("\x1f");
  expect(base.getText()).toBe("$presentations");
  expect(editor.render(80).join("")).not.toContain(cube);
  editor.handleInput("\x1f");
  expect(base.getText()).toBe("");
});

it("keeps a multirow label atomic in the native raw buffer and restores its label on undo", () => {
  const base = new Editor(tui, theme);
  const methods = [base.handleInput, base.render, base.setText];
  const editor = sourceModelProbe(base, names);
  editor.setText("用 $presentations");
  const rows = editor.render(8);
  expect(rows.every(line => visibleWidth(line) <= 8)).toBe(true);
  expect(rows.map(stripTerminalSequences).join("")).toContain(cube + " presentations");
  expect(rows.filter(line => line.includes("38;2;141;249;253")).length).toBeGreaterThan(1);
  expect(base.getText()).toBe("用 $presentations");
  editor.handleInput("\x1b[D");
  expect(base.getCursor()).toEqual({ line: 0, col: 2 });
  editor.handleInput("\x1b[C");
  expect(base.getCursor()).toEqual({ line: 0, col: 16 });
  editor.handleInput("\x7f");
  expect(base.getText()).toBe("用 ");
  editor.handleInput("\x1f");
  expect(base.getText()).toBe("用 $presentations");
  expect(editor.render(8).join("")).toContain(cube);
  expect([base.handleInput, base.render, base.setText]).toEqual(methods);
});

it("labels a complete pasted reference at EOF and keeps literal lookalike text outside label ranges", () => {
  const base = new Editor(tui, theme);
  const editor = sourceModelProbe(base, names);
  editor.handleInput("\x1b[200~$presentations\x1b[201~");
  expect(base.getText()).toBe("$presentations");
  expect(editor.render(80).join("")).toContain(cube);
  editor.handleInput("\x1f");
  expect(base.getText()).toBe("");
  const lookalike = ` ${cube} presentations `;
  editor.setText(lookalike + "$presentations");
  const row = editor.render(80)[0];
  expect(row.startsWith(lookalike)).toBe(true);
  expect(row.slice(0, lookalike.length)).not.toContain("\x1b");
  expect(editor.getExpandedText()).toBe(lookalike + "$presentations");
});

it("keeps the real completion provider on raw text and turns the selected name into a label", async () => {
  const base = new Editor(tui, theme);
  base.setAutocompleteProvider(skillAutocomplete(new CombinedAutocompleteProvider([], process.cwd()), () => [
    { name: "skill:presentations", source: "skill" } as never,
  ]));
  const editor = sourceModelProbe(base, names);
  for (const char of "$pre") editor.handleInput(char);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(base.isShowingAutocomplete()).toBe(true);
  editor.handleInput("\t");
  expect(base.getText()).toBe("$presentations");
  expect(base.isShowingAutocomplete()).toBe(false);
  expect(editor.render(80).join("")).toContain(cube);
});

it("maps projected rows back to raw cursor boundaries around a wrapped label", () => {
  const base = new Editor(tui, theme);
  const editor = sourceModelProbe(base, names);
  const text = "前文 $presentations 后文";
  editor.setText(text);
  expect(editor.cursorPoint(17, 8).row).toBeGreaterThan(0);
  for (const width of [8, 16, 80]) {
    for (const offset of [0, 1, 2, 3, 17, 18, 19, 20]) {
      const point = editor.cursorPoint(offset, width);
      editor.placeCursor(point.row, point.col, width);
      expect(base.getCursor().col).toBe(offset);
    }
  }
  editor.placeCursor(1, 2, 8);
  expect([3, 17]).toContain(base.getCursor().col);
  expect(base.getText()).toBe(text);
});

it("restores an EOF label after undoing a temporary adjacent-text edit", () => {
  const base = new Editor(tui, theme);
  const editor = sourceModelProbe(base, names);
  editor.setText("用 $presentations");
  editor.handleInput("\x1b[D");
  editor.handleInput("X");
  expect(base.getText()).toBe("用 X$presentations");
  editor.handleInput("\x7f");
  editor.handleInput("\x1b[C");
  editor.handleInput("\x7f");
  expect(base.getText()).toBe("用 ");
});

it("uses the command fallback without changing raw coordinates or atomic editing", () => {
  const base = new Editor(tui, theme);
  const editor = sourceModelProbe(base, names, "command");
  editor.setText("$presentations");
  const output = editor.render(8);
  expect(output.join("")).toContain("⌘");
  expect(output.join("")).not.toContain(cube);
  expect(output.every(line => visibleWidth(line) <= 8)).toBe(true);
  const end = editor.cursorPoint(14, 8);
  editor.placeCursor(end.row, end.col, 8);
  expect(base.getCursor().col).toBe(14);
  editor.handleInput("\x7f");
  expect(base.getText()).toBe("");
  editor.handleInput("\x1f");
  expect(base.getText()).toBe("$presentations");
});

it("snaps projected mouse positions inside a folded paste to native cursor boundaries", () => {
  const base = new Editor(tui, theme);
  const editor = sourceModelProbe(base, names);
  const pasted = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n");
  editor.handleInput("\x1b[200~" + pasted + "\x1b[201~");
  const markerEnd = base.getText().length;
  editor.handleInput("\x1b[200~ $presentations\x1b[201~");
  for (const column of [1, markerEnd - 1]) {
    editor.placeCursor(0, column, 80);
    expect([0, markerEnd]).toContain(base.getCursor().col);
    expect(editor.getExpandedText()).toBe(pasted + " $presentations");
  }
});

it("preserves folded paste contents when deleting and undoing an adjacent label", () => {
  const base = new Editor(tui, theme);
  const editor = sourceModelProbe(base, names);
  const pasted = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n");
  editor.handleInput("\x1b[200~" + pasted + "\x1b[201~");
  editor.handleInput("\x1b[200~ $presentations\x1b[201~");
  expect(editor.getExpandedText()).toBe(pasted + " $presentations");
  editor.handleInput("\x7f");
  expect(editor.getExpandedText()).toBe(pasted + " ");
  expect(base.getText()).toMatch(/^\[paste #\d+ \+12 lines\] $/);
  editor.handleInput("\x1f");
  expect(editor.getExpandedText()).toBe(pasted + " $presentations");
  expect(editor.render(80).join("")).toContain(cube);
});
