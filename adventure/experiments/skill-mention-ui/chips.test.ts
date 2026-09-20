import { expect, it } from "vitest";
import { CombinedAutocompleteProvider, Editor, Markdown, stripTerminalSequences, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { getMarkdownTheme, initTheme, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { skillAutocomplete } from "../../../extensions/skill-mentions/src/autocomplete.js";
import { chipEditor, chipLabel, chipMarkdown, chipToken, decodeChips, encodeChips } from "./chips.js";

const identity = (text: string) => text;
const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
const tui = { terminal: { rows: 30, columns: 104 }, requestRender() {} } as unknown as TUI;

const names = new Set(["presentations", "lark-doc"]);
it("projects known references into labels and round-trips source without changing lookalike text", () => {
  const source = "$presentations, 和 $lark-doc。 ` $presentations ` \\$lark-doc $unknown " + chipLabel("presentations");
  const projected = encodeChips(source, names);
  expect(projected).not.toBe(source);
  expect(projected).toContain(chipToken("lark-doc"));
  expect(projected).toContain("` $presentations ` \\$lark-doc $unknown");
  expect(decodeChips(projected)).toBe(source);
  expect(decodeChips(chipLabel("presentations"))).toBe(chipLabel("presentations"));
});

it("moves and deletes a whole label through the real editor and submits the original source", () => {
  const base = new Editor(tui, theme);
  const originalMethods = [base.handleInput, base.render, Reflect.get(base, "segment")];
  const editor = chipEditor(base, () => names);
  expect([base.handleInput, base.render, Reflect.get(base, "segment")]).toEqual(originalMethods);
  editor.setText("用 $presentations");
  expect(base.getText()).toBe("用 " + chipToken("presentations"));
  expect(editor.getText()).toBe("用 $presentations");
  editor.handleInput("\x1b[D");
  expect(base.getCursor().col).toBe(2);
  editor.handleInput("\x1b[C");
  expect(base.getCursor().col).toBe(base.getText().length);
  editor.handleInput("\x7f");
  expect(editor.getText()).toBe("用 ");
  editor.handleInput("\x1f");
  expect(editor.getText()).toBe("用 $presentations");
  let submitted = "";
  editor.onSubmit = text => { submitted = text; };
  editor.handleInput("\r");
  expect(submitted).toBe("用 $presentations");
  expect(editor.getText()).toBe("");
});

it("converts a confirmed completion into an atom without changing the submitted spelling", async () => {
  const base = new Editor(tui, theme);
  const editor = chipEditor(base, () => names);
  const commands = [...names].map(name => ({ name: `skill:${name}`, source: "skill" })) as SlashCommandInfo[];
  editor.setAutocompleteProvider!(skillAutocomplete(new CombinedAutocompleteProvider([], process.cwd()), () => commands));
  editor.setText("用 ");
  for (const char of "$pre") editor.handleInput(char);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(base.isShowingAutocomplete()).toBe(true);
  editor.handleInput("\t");
  expect(base.getText()).toBe("用 " + chipToken("presentations"));
  expect(editor.getExpandedText!()).toBe("用 $presentations");
  editor.handleInput("\x1b[D");
  editor.handleInput("\x1b[3~");
  expect(editor.getText()).toBe("用 ");
  editor.setText("");
});

it("keeps adjacent word deletion atomic and undoable", () => {
  const base = new Editor(tui, theme);
  const editor = chipEditor(base, () => names);
  editor.setText("用 $presentations ");
  editor.handleInput("\x17");
  expect(editor.getText()).toBe("用 ");
  editor.handleInput("\x1f");
  expect(editor.getText()).toBe("用 $presentations ");
  editor.setText("");
});

it("renders a borderless gray label with a blue icon in both locations", () => {
  const source = "$presentations, 和 $lark-doc。";
  initTheme("dark", false);
  const styled = chipMarkdown(source, names, "\x1b[48;2;67;67;67m");
  const rendered = new Markdown(styled, 0, 0, getMarkdownTheme()).render(104);
  expect(rendered.map(stripTerminalSequences).join("\n")).toContain(chipLabel("presentations") + ", 和 " + chipLabel("lark-doc") + "。");
  const base = new Editor(tui, theme);
  const editor = chipEditor(base, () => names);
  editor.setText(source);
  const output = editor.render(104);
  expect(output.join("\n")).toContain("48;2;52;54;58");
  expect(output.join("\n")).toContain("38;2;127;169;223");
  expect(output.join("\n")).toContain("38;2;215;218;222");
  expect(chipLabel("presentations")).toBe(" ◇ presentations ");
  expect(stripTerminalSequences(styled)).not.toMatch(/[‹›]/);
  expect(output.every(line => visibleWidth(line) <= 104)).toBe(true);
  expect(editor.getText()).toBe(source);
  // Nonbreaking projected padding keeps fitting labels together when wrapping.
  const wrapped = editor.render(27).map(stripTerminalSequences).join("\n");
  expect(wrapped).toContain(chipLabel("presentations"));
  expect(wrapped).toContain(chipLabel("lark-doc"));
});

it("renders blue icon and text without a new background while keeping atomic editing", () => {
  const source = "$presentations, 和 $lark-doc。";
  initTheme("dark", false);
  const styled = chipMarkdown(source, names, "\x1b[48;2;67;67;67m", "blue");
  expect(styled).toContain("38;2;127;169;223");
  expect(styled).not.toContain("48;2;");
  expect(styled).not.toContain("215;218;222");
  const rendered = new Markdown(styled, 0, 0, getMarkdownTheme()).render(104);
  expect(rendered.map(stripTerminalSequences).join("\n")).toContain(chipLabel("presentations"));
  const base = new Editor(tui, theme);
  const editor = chipEditor(base, () => names, "blue");
  editor.setText("用 $presentations");
  expect(editor.render(104).join("\n")).not.toContain("48;2;");
  expect(editor.render(104).join("\n")).toContain("38;2;127;169;223");
  editor.handleInput("\x1b[D");
  expect(base.getCursor().col).toBe(2);
  editor.handleInput("\x1b[C");
  editor.handleInput("\x7f");
  expect(editor.getText()).toBe("用 ");
  editor.handleInput("\x1f");
  expect(editor.getText()).toBe("用 $presentations");
});

it("uses a command icon and the sampled cyan without changing source or background", () => {
  const source = "$presentations,";
  const markdown = chipMarkdown(source, names, "\x1b[48;2;67;67;67m", "command");
  expect(stripTerminalSequences(markdown)).toContain(" ⌘ presentations ");
  expect(markdown).toContain("38;2;141;249;253");
  expect(markdown).not.toContain("48;2;");
  const base = new Editor(tui, theme);
  const editor = chipEditor(base, () => names, "command");
  editor.setText(source);
  const rendered = editor.render(104);
  expect(rendered.map(stripTerminalSequences).join("\n")).toContain(" ⌘ presentations ,");
  expect(rendered.join("\n")).toContain("38;2;141;249;253");
  expect(editor.getText()).toBe(source);
  expect(visibleWidth("⌘")).toBe(visibleWidth("◇"));
});

it("renders the outline cube in one cell and keeps the atom editable as a whole", () => {
  const cube = "\u{f01a7}";
  const source = "用 $presentations";
  initTheme("dark", false);
  const markdown = chipMarkdown(source, names, "\x1b[48;2;67;67;67m", "cube");
  expect(markdown).toContain(cube);
  expect(markdown).toContain("38;2;141;249;253");
  expect(markdown).not.toContain("48;2;");
  const rendered = new Markdown(markdown, 0, 0, getMarkdownTheme()).render(104);
  expect(rendered.map(stripTerminalSequences).join("\n")).toContain(`${cube} presentations`);
  expect(visibleWidth(cube)).toBe(1);
  const base = new Editor(tui, theme);
  const editor = chipEditor(base, () => names, "cube");
  editor.setText(source);
  expect(editor.render(104).map(stripTerminalSequences).join("\n")).toContain(`${cube} presentations`);
  editor.handleInput("\x1b[D");
  expect(base.getCursor().col).toBe(2);
  editor.handleInput("\x1b[C");
  editor.handleInput("\x7f");
  expect(editor.getText()).toBe("用 ");
  editor.handleInput("\x1f");
  expect(editor.getText()).toBe(source);
});
