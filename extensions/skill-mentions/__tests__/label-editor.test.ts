import { beforeAll, expect, it } from "vitest";
import { CustomEditor, initTheme, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { getKeybindings, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { captureLabelDraft, createLabelEditor, releaseLabelEditor } from "../src/label-editor.js";

beforeAll(() => initTheme("dark", false));
function fixture(names: ReadonlySet<string> = new Set(["alpha", "𠮷"])) {
  const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI;
  const same = (value: string) => value;
  const base = new CustomEditor(tui, { borderColor: same, selectList: { selectedPrefix: same, selectedText: same, description: same, scrollInfo: same, noMatch: same } }, { matches: () => false } as unknown as KeybindingsManager);
  const editor = createLabelEditor(base, { names: () => names, icon: () => "cube", tui });
  return { base, editor };
}
const undo = "\x1b[45;5u";

it("deletes and restores an explicit label synchronously with one consumer change per action", () => {
  const { editor, base } = fixture(); const changes: string[] = [];
  editor.setText("Use $alpha");
  editor.onChange = value => { changes.push(value); expect(editor.getText()).toBe(value); };
  editor.handleInput("\x7f");
  expect(editor.getText()).toBe("Use "); expect(base.getText()).toBe("Use ");
  expect(changes).toEqual(["Use "]);
  editor.handleInput(undo);
  expect(editor.getText()).toBe("Use $alpha");
  expect(changes).toEqual(["Use ", "Use $alpha"]);
});

it("does not lock a handwritten name before a delimiter but locks an explicit paste", () => {
  const { editor } = fixture();
  for (const char of "$alpha") editor.handleInput(char);
  editor.handleInput("\x7f"); expect(editor.getText()).toBe("$alph");
  editor.handleInput("a"); editor.handleInput("."); editor.handleInput("\x1b[D");
  editor.handleInput("\x7f"); expect(editor.getText()).toBe(".");
  editor.setText(""); editor.handleInput("\x1b[200~$alpha\x1b[201~");
  editor.handleInput("\x7f"); expect(editor.getText()).toBe("");
});

it("keeps folded paste intact through delete, grouped undo and same-stack submission", () => {
  const { editor } = fixture(); const paste = "p".repeat(2048);
  editor.handleInput(`\x1b[200~${paste}\x1b[201~`); editor.insertTextAtCursor!(" $alpha");
  editor.handleInput("\x7f"); expect(editor.getExpandedText!()).toBe(paste + " ");
  editor.handleInput(undo); expect(editor.getExpandedText!()).toBe(paste + " $alpha");
  let result: string | undefined; editor.onSubmit = value => { result = value; };
  editor.handleInput("\x7f"); editor.handleInput("\r"); expect(result).toBe(paste);
});

it("restores repeated logical actions by identity rather than equal text", () => {
  const { editor } = fixture();
  editor.setText("$alpha $alpha"); editor.handleInput("\x7f");
  editor.handleInput("\x7f"); editor.handleInput("\x7f"); expect(editor.getText()).toBe("");
  for (const text of ["$alpha", "$alpha ", "$alpha $alpha"]) {
    editor.handleInput(undo); expect(editor.getText()).toBe(text);
  }
});

it("preserves native word typing coalescing around a grouped deletion", () => {
  const { editor } = fixture();
  editor.setText("$alpha"); editor.handleInput("\x7f");
  for (const char of "word") editor.handleInput(char);
  editor.handleInput(undo); expect(editor.getText()).toBe("");
  editor.handleInput(undo); expect(editor.getText()).toBe("$alpha");
});

it("counts supplementary-plane native deletions without consuming an older undo", () => {
  const { editor } = fixture(); editor.setText("before "); editor.insertTextAtCursor!("$𠮷");
  editor.handleInput("\x7f"); expect(editor.getText()).toBe("before ");
  editor.handleInput(undo); expect(editor.getText()).toBe("before $𠮷");
  editor.handleInput(undo); expect(editor.getText()).toBe("before ");
});

it("keeps history browsing as one native undo unit before deleting a label", () => {
  const { editor } = fixture(); editor.setText("$alpha"); editor.handleInput("\x7f"); editor.setText("draft");
  editor.addToHistory("first $alpha"); editor.addToHistory("second $alpha");
  editor.handleInput("\x01"); editor.handleInput("\x1b[A"); editor.handleInput("\x1b[A");
  expect(editor.getText()).toBe("first $alpha");
  editor.handleInput("\x05"); editor.handleInput("\x7f");
  expect(editor.getText()).toBe("first ");
  editor.handleInput(undo); expect(editor.getText()).toBe("first $alpha");
  editor.handleInput(undo); expect(editor.getText()).toBe("draft");
  editor.handleInput(undo); expect(editor.getText()).toBe("");
  editor.handleInput(undo); expect(editor.getText()).toBe("$alpha");
});

it("does not coalesce word typing across a no-op cursor movement", () => {
  const { editor } = fixture(); editor.setText("$alpha"); editor.handleInput("\x7f");
  editor.handleInput("a"); editor.handleInput("\x1b[C"); editor.handleInput("b");
  editor.handleInput(undo); expect(editor.getText()).toBe("a");
  editor.handleInput(undo); expect(editor.getText()).toBe("");
  editor.handleInput(undo); expect(editor.getText()).toBe("$alpha");
});

it("honors configured native deletion and undo keys", () => {
  const bindings = getKeybindings(), previous = bindings.getUserBindings();
  bindings.setUserBindings({ ...previous, "tui.editor.deleteCharBackward": "ctrl+x", "tui.editor.undo": "ctrl+z" });
  try {
    const { editor } = fixture(); editor.setText("$alpha");
    editor.handleInput("\x18"); expect(editor.getText()).toBe("");
    editor.handleInput("\x1a"); expect(editor.getText()).toBe("$alpha");
  } finally { bindings.setUserBindings(previous); }
});

it("does not turn an intercepted shortcut into a grouped deletion or duplicate its mutation", () => {
  const { editor } = fixture(); editor.setText("$alpha");
  editor.onExtensionShortcut = data => {
    if (data !== "\x7f") return false;
    editor.setText("$alph"); return true;
  };
  editor.handleInput("\x7f"); expect(editor.getText()).toBe("$alph");
  editor.onExtensionShortcut = undefined;
  editor.handleInput(undo); expect(editor.getText()).toBe("$alpha");
  editor.handleInput(undo); expect(editor.getText()).toBe("");
});

it("does not create a visual-only undo when confirming an already complete handwritten name", async () => {
  const { editor } = fixture();
  editor.setAutocompleteProvider({ getSuggestions: async () => ({ prefix: "$alpha", items: [{ value: "$alpha", label: "alpha" }] }),
    applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }) });
  for (const char of "$alpha") editor.handleInput(char);
  editor.handleInput("\t"); await new Promise(done => setTimeout(done, 10));
  expect(editor.render(80).map(stripTerminalSequences).join("\n")).toContain("\u{f01a7}alpha");
  editor.handleInput(undo); expect(editor.getText()).toBe("");
});

it("ignores old completion results after setText or release and preserves callback order", async () => {
  const { editor, base } = fixture(); let resolve!: (value: any) => void;
  editor.setAutocompleteProvider({ getSuggestions: () => new Promise(done => { resolve = done; }), applyCompletion: () => ({ lines: ["$alpha"], cursorLine: 0, cursorCol: 6 }) });
  editor.setText("$a"); editor.handleInput("\t"); await new Promise(done => setTimeout(done, 10)); editor.setText("$alpha");
  resolve({ prefix: "$a", items: [{ value: "alpha", label: "alpha" }] });
  await new Promise(done => setTimeout(done, 10)); expect(editor.getText()).toBe("$alpha");
  expect(editor.isShowingAutocomplete()).toBe(false);
  const events: string[] = []; editor.onChange = text => events.push("change:" + text); editor.onSubmit = text => events.push("submit:" + text);
  editor.handleInput("\x7f"); expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  editor.handleInput(undo); editor.handleInput("\r");
  expect(events).toEqual(["change:", "change:$alpha", "change:", "submit:$alpha"]);
  editor.setText("$a"); editor.handleInput("\t"); await new Promise(done => setTimeout(done, 10)); releaseLabelEditor(editor);
  resolve({ prefix: "$a", items: [{ value: "alpha", label: "alpha" }] });
  await new Promise(done => setTimeout(done, 10)); expect(base.getText()).toBe("$a"); expect(base.isShowingAutocomplete()).toBe(false);
});

it("refreshes discovered names before input and does not resurrect removed labels through undo", () => {
  const names = new Set(["alpha"]), { editor } = fixture(names);
  editor.setText("$alpha"); names.clear(); editor.handleInput("\x7f"); expect(editor.getText()).toBe("$alph");
  names.add("alpha"); editor.setText("$alpha"); editor.handleInput("\x7f"); expect(editor.getText()).toBe("");
  names.clear(); editor.handleInput(undo); editor.handleInput("\x7f"); expect(editor.getText()).toBe("$alph");
});

it("does not coalesce typing across a failed native character jump", () => {
  const { editor } = fixture(); editor.setText("$alpha"); editor.handleInput("\x7f");
  editor.handleInput("a"); editor.handleInput("\x1d"); editor.handleInput("z"); editor.handleInput("b");
  expect(editor.getText()).toBe("ab"); editor.handleInput(undo); expect(editor.getText()).toBe("a");
  editor.handleInput(undo); expect(editor.getText()).toBe("");
  editor.handleInput(undo); expect(editor.getText()).toBe("$alpha");
});

it("rebuilds the projected frame after rendering an empty-label draft and undoing", () => {
  const { editor } = fixture(); editor.setText("Use $alpha"); editor.render(80);
  editor.handleInput("\x7f"); editor.render(80); editor.handleInput(undo);
  expect(editor.render(80).map(stripTerminalSequences).join("\n")).toContain("\u{f01a7}alpha");
});

it("renders cyan source labels across narrow rows without polluting raw text", () => {
  const { editor } = fixture(); editor.setText("abc $alpha"); editor.focused = false;
  const rendered = editor.render(8);
  expect(rendered.join("\n")).toContain("\x1b[38;2;141;249;253m");
  expect(rendered.map(stripTerminalSequences).join("\n")).toContain("\u{f01a7}alpha");
  expect(rendered.every(line => visibleWidth(line) <= 8)).toBe(true);
  expect(editor.getText()).toBe("abc $alpha");
  expect(editor.getExpandedText()).toBe("abc $alpha");
});

it("respects native action priority when configured character and word deletion keys overlap", () => {
  const bindings = getKeybindings(), previous = bindings.getUserBindings();
  bindings.setUserBindings({ ...previous, "tui.editor.deleteCharBackward": ["ctrl+w", "backspace"] });
  try {
    const { editor } = fixture(); editor.setText("$alpha"); editor.handleInput("\x7f");
    expect(editor.getText()).toBe(""); editor.handleInput(undo); expect(editor.getText()).toBe("$alpha");
    editor.handleInput("\x17"); expect(editor.getText()).toBe("$");
    editor.handleInput("\x19"); expect(editor.getText()).toBe("$alpha");
  } finally { bindings.setUserBindings(previous); }
});

it("groups the native backslash-enter workaround without consuming an earlier group", () => {
  const { editor } = fixture(); editor.setText("$alpha"); editor.handleInput("\x7f");
  editor.handleInput("\\"); editor.handleInput("\r"); expect(editor.getText()).toBe("\n");
  editor.handleInput(undo); expect(editor.getText()).toBe("\\");
  editor.handleInput(undo); expect(editor.getText()).toBe("");
  editor.handleInput(undo); expect(editor.getText()).toBe("$alpha");
});

it("preserves the native kill ring around grouped deletions and consecutive undo", () => {
  const { editor } = fixture(); editor.setText("keep"); editor.handleInput("\x17");
  editor.setText("$alpha"); editor.handleInput("\x7f"); editor.handleInput("\x19");
  expect(editor.getText()).toBe("keep"); editor.handleInput(undo); expect(editor.getText()).toBe("");
  editor.handleInput(undo); expect(editor.getText()).toBe("$alpha");
});

it("retains paste identities across backward renumbering, undo and draft handoff", () => {
  const { editor } = fixture(); const a = "a".repeat(1024), b = "b".repeat(1024);
  editor.handleInput(`\x1b[200~${a}\x1b[201~`); editor.insertTextAtCursor!(" $alpha ");
  editor.handleInput(`\x1b[200~${b}\x1b[201~`);
  editor.handleInput("\x01"); editor.handleInput("\x1b[C"); editor.handleInput("\x7f");
  expect(captureLabelDraft(editor)?.expanded).toBe(" $alpha " + b);
  editor.handleInput(undo); expect(captureLabelDraft(editor)?.expanded).toBe(a + " $alpha " + b);
  releaseLabelEditor(editor); expect(captureLabelDraft(editor)).toBeUndefined();
});

it("allows synchronous onChange reentry after the native group is complete", () => {
  const { editor } = fixture(); editor.setText("$alpha");
  editor.onChange = value => { if (value === "") editor.setText("next"); };
  editor.handleInput("\x7f"); expect(editor.getText()).toBe("next");
  editor.onChange = undefined;
  editor.handleInput(undo); expect(editor.getText()).toBe("");
  editor.handleInput(undo); expect(editor.getText()).toBe("$alpha");
});
