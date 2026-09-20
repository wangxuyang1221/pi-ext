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
