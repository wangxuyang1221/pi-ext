import { afterEach, expect, it, vi } from "vitest";
import { CombinedAutocompleteProvider, Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { SlashCommandInfo, Theme } from "@earendil-works/pi-coding-agent";
import { CodexEditor } from "../../codex-ui/src/components.js";
import { skillAutocomplete } from "../src/autocomplete.js";
import { loadSnapshot } from "../src/loading.js";

const identity = (text: string) => text;
const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} } as unknown as TUI;
const commands = ["alpha", "beta"].map(name => ({ name: `skill:${name}`, source: "skill", description: name, sourceInfo: { path: `/skills/${name}/SKILL.md` } })) as SlashCommandInfo[];
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.setText(""); });
const settle = () => new Promise(resolve => setTimeout(resolve, 80));
function editorFor(kind: string) {
  const editor = kind === "native" ? new Editor(tui, theme) : new CodexEditor(tui, theme, { matches: () => false } as never, () => ({ fg: (_: string, text: string) => text, getBgAnsi: () => "" }) as unknown as Theme);
  editor.setAutocompleteProvider(skillAutocomplete(new CombinedAutocompleteProvider([{ name: "help" }], process.cwd()), () => commands));
  editors.push(editor);
  return editor;
}

it("queries only discovered skill names, preserves metadata and does not match descriptions", async () => {
  const getCommands = vi.fn(() => [...commands, { ...commands[0], source: "prompt", name: "skill:al-prompt" } as SlashCommandInfo]);
  const provider = skillAutocomplete(new CombinedAutocompleteProvider([], process.cwd()), getCommands);
  const options = { signal: new AbortController().signal };
  expect(await provider.getSuggestions(["$al"], 0, 3, options)).toEqual({ prefix: "$al", items: [{ value: "$alpha", label: "alpha", description: "alpha" }] });
  expect(getCommands).toHaveBeenCalledTimes(1);
  expect(await provider.getSuggestions(["$unknown"], 0, 8, options)).toBeNull();
});

for (const kind of ["native", "codex"]) {
  it(`${kind}: handwritten, bracketed-paste and menu references load identically`, async () => {
    const expected = "用 $alpha $beta";
    const handwritten = editorFor(kind);
    for (const char of expected) handwritten.handleInput(char);
    const pasted = editorFor(kind);
    pasted.handleInput(`\x1b[200~${expected}\x1b[201~`);
    const selected = editorFor(kind); selected.setText("用 ");
    for (const char of "$al") selected.handleInput(char);
    await settle(); selected.handleInput("\t"); selected.handleInput(" ");
    for (const char of "$be") selected.handleInput(char);
    await settle(); selected.handleInput("\r");
    for (const editor of [handwritten, pasted, selected]) {
      expect(editor.getText()).toBe(expected);
      const snapshot = await loadSnapshot(editor.getText(), commands, async path => `BODY ${path}`);
      expect(snapshot?.task).toBe(expected);
      expect(snapshot?.skills.map(skill => [skill.name, skill.location, skill.body])).toEqual([
        ["alpha", "/skills/alpha/SKILL.md", "References are relative to /skills/alpha.\n\nBODY /skills/alpha/SKILL.md"],
        ["beta", "/skills/beta/SKILL.md", "References are relative to /skills/beta.\n\nBODY /skills/beta/SKILL.md"],
      ]);
    }
  });
  it(`${kind}: cancel keeps a complete reference and slash completion still works`, async () => {
    const editor = editorFor(kind), submit = vi.fn(); editor.onSubmit = submit;
    for (const char of "$alpha") editor.handleInput(char);
    await settle(); expect(editor.isShowingAutocomplete()).toBe(true);
    editor.handleInput("\x1b"); expect(editor.getText()).toBe("$alpha");
    expect(editor.isShowingAutocomplete()).toBe(false);
    editor.handleInput("\r"); expect(submit).toHaveBeenCalledWith("$alpha");
    editor.setText(""); editor.handleInput("/"); await settle();
    editor.handleInput("\t"); expect(editor.getText()).toBe("/help ");
  });

  it(`${kind}: suppresses completion inside a Markdown inline code span`, async () => {
    const editor = editorFor(kind); editor.setText("before `  ` after");
    for (let index = 0; index < " ` after".length; index++) editor.handleInput("\x1b[D");
    for (const char of "$al") editor.handleInput(char);
    await settle(); expect(editor.isShowingAutocomplete()).toBe(false);
    expect(editor.getText()).toBe("before ` $al ` after");
  });

  it.each(["文字", "（", "~~~\n", "\\", "```ts\n"])(`${kind}: does not offer skills after %j`, async before => {
    const editor = editorFor(kind); editor.setText(before);
    for (const char of "$al") editor.handleInput(char);
    await settle(); expect(editor.isShowingAutocomplete()).toBe(false);
  });
  it.each(["\t", "\r"])(`${kind}: selects with %j without submitting or losing surrounding lines`, async key => {
    const editor = editorFor(kind), submit = vi.fn(); editor.onSubmit = submit;
    editor.setText("第一行\n用  后文");
    for (let i = 0; i < 3; i++) editor.handleInput("\x1b[D");
    for (const char of "$al") editor.handleInput(char);
    await settle(); expect(editor.isShowingAutocomplete()).toBe(true);
    editor.handleInput(key);
    expect(editor.getText()).toBe("第一行\n用 $alpha 后文");
    expect(submit).not.toHaveBeenCalled();
    expect(editor.isShowingAutocomplete()).toBe(false);
    editor.handleInput("\r"); expect(submit).toHaveBeenCalledWith("第一行\n用 $alpha 后文");
  });
}
