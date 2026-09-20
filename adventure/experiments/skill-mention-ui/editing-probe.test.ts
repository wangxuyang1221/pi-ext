import { expect, it } from "vitest";
import { Editor, stripTerminalSequences, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { chipEditor, chipToken } from "./chips.js";

const identity = (text: string) => text;
const theme: EditorTheme = {
  borderColor: identity,
  selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity },
};
const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} } as unknown as TUI;
const names = new Set(["presentations"]);

it("records existing narrow-width projection behavior without treating it as production acceptance", () => {
  const base = new Editor(tui, theme);
  const editor = chipEditor(base, () => names, "cube");
  editor.setText("$presentations");
  const results = [80, 24, 16, 12, 8].map(width => {
    const output = editor.render(width);
    expect(output.every(line => visibleWidth(line) <= width)).toBe(true);
    expect(editor.getExpandedText?.()).toBe("$presentations");
    return {
      width,
      hasCube: output.join("").includes("\u{f01a7}"),
      hasCyan: output.join("").includes("38;2;141;249;253"),
      lines: output.map(stripTerminalSequences),
    };
  });
  expect(results[0].hasCube).toBe(true);
  console.log(JSON.stringify({ probe: "narrow-width", results }));
});

it("keeps whole deletion and native undo after a label spans multiple rows", () => {
  const base = new Editor(tui, theme);
  const editor = chipEditor(base, () => names, "cube");
  editor.setText("用 $presentations");
  editor.render(8);
  editor.handleInput("\x1b[D");
  expect(base.getCursor()).toEqual({ line: 0, col: 2 });
  editor.handleInput("\x1b[C");
  editor.handleInput("\x7f");
  expect(editor.getText()).toBe("用 ");
  editor.handleInput("\x1f");
  expect(editor.getText()).toBe("用 $presentations");
});

it("shows why adding setText conversion after a typed delimiter creates an extra undo state", () => {
  const base = new Editor(tui, theme);
  const editor = chipEditor(base, () => names, "cube");
  for (const char of "$presentations ") editor.handleInput(char);
  expect(base.getText()).toBe("$presentations ");
  // This models the naive automatic-conversion approach, not an approved design.
  editor.setText(editor.getText());
  expect(base.getText()).toBe(chipToken("presentations") + " ");
  editor.handleInput("\x1f");
  expect(editor.getText()).toBe("$presentations ");
  expect(base.getText()).toBe("$presentations ");
  console.log(JSON.stringify({ probe: "naive-auto-conversion", firstUndoOnlyRemovesProjection: true }));
});
