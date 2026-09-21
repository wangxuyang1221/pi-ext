import { beforeAll, expect, it } from "vitest";
import { initTheme, Theme, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { getKeybindings, stripTerminalSequences, visibleWidth, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { CodexEditor } from "../../codex-ui/src/components.js";
import { createLabelEditor } from "../src/label-editor.js";
import { LabelNativeEditor } from "../src/editor-surface.js";
import { icons, labelReferences, layoutLabels, type IconMode } from "../src/labels.js";

beforeAll(() => initTheme("dark", false));
const delay = () => new Promise(resolve => setTimeout(resolve, 10));
function fixture(host: string, icon: IconMode, names = ["alpha", "beta"]) {
  const terminal = { rows: 40, columns: 80 };
  const tui = { terminal, requestRender() {} } as unknown as TUI;
  const same = (value: string) => value;
  const theme = new Theme({
    accent: "", border: "", borderAccent: "", borderMuted: "", success: "", error: "", warning: "",
    muted: "", dim: "", text: "", thinkingText: "", scrollbarTrack: "", scrollbarThumb: "", searchMatchText: "",
    userMessageText: "", customMessageText: "", customMessageLabel: "", toolTitle: "", toolOutput: "",
    mdHeading: "", mdLink: "", mdLinkUrl: "", mdCode: "", mdCodeBlock: "", mdCodeBlockBorder: "",
    mdQuote: "", mdQuoteBorder: "", mdHr: "", mdListBullet: "",
    toolDiffAdded: "", toolDiffRemoved: "", toolDiffContext: "",
    syntaxComment: "", syntaxKeyword: "", syntaxFunction: "", syntaxVariable: "", syntaxString: "",
    syntaxNumber: "", syntaxType: "", syntaxOperator: "", syntaxPunctuation: "",
    thinkingOff: "", thinkingMinimal: "", thinkingLow: "", thinkingMedium: "", thinkingHigh: "",
    thinkingXhigh: "", thinkingMax: "", bashMode: "",
  }, {
    selectedBg: 238, searchMatchBg: 238, userMessageBg: 238, customMessageBg: 238,
    toolPendingBg: 238, toolSuccessBg: 238, toolErrorBg: 238,
  }, "256color");
  const editorTheme = { borderColor: same, selectList: { selectedPrefix: same, selectedText: same, description: same, scrollInfo: same, noMatch: same } };
  const keys = { matches: () => false } as unknown as KeybindingsManager;
  const base = host === "native" ? new LabelNativeEditor(tui, editorTheme, keys) : new CodexEditor(tui, editorTheme, keys, () => theme);
  const editor = createLabelEditor(base, { names: () => new Set(names), icon: () => icon, tui });
  return { editor, base, tui, terminal };
}
const cases = ["native", "codex"].flatMap(host => (["cube", "command"] as const).map(icon => ({ host, icon })));
it.each(cases)("preserves full long names through narrow viewports and resize in $host/$icon", ({ host, icon }) => {
  const name = "a".repeat(1024), { editor, terminal } = fixture(host, icon, [name]);
  editor.setText("prefix $" + name + " suffix");
  for (const width of [8, 16, 80, 120, 8]) {
    terminal.columns = width;
    const rows = editor.render(width);
    expect(rows.every(row => visibleWidth(row) <= width)).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(14);
    expect(rows.join("\n")).toContain("\x1b[38;2;141;249;253m");
    expect(editor.getExpandedText()).toBe("prefix $" + name + " suffix");
  }
  editor.handleInput("\x01");
  for (let i = 0; i < 7; i++) editor.handleInput("\x1b[C");
  expect(editor.getCursor().col).toBe(7); editor.handleInput("\x1b[C");
  expect(editor.getCursor().col).toBe(1032);
  editor.handleInput("\x7f"); expect(editor.getText()).toBe("prefix  suffix");
  editor.handleInput("\x1b[45;5u"); expect(editor.getText()).toBe("prefix $" + name + " suffix");
});

it.each(cases)("maps wrapped vertical motion and mouse clicks to label boundaries in $host/$icon", ({ host, icon }) => {
  const { editor } = fixture(host, icon); editor.setText("abc $alpha tail"); editor.handleInput("\x01");
  const rendered = editor.render(13).map(stripTerminalSequences);
  const row = rendered.findIndex(line => line.includes(` ${icons[icon]} alpha `));
  expect(row).toBeGreaterThan(0);
  const x = rendered[row].indexOf(icons[icon]);
  // Cube is a supplementary-plane character but its terminal width is one cell.
  editor.handleMouse({ type: "click", button: "left", x: x + 1, y: row } as TuiMouseEvent);
  expect(editor.getCursor().col).toBe(4);
  editor.handleInput("\x1b[C"); expect(editor.getCursor().col).toBe(10);
  editor.handleInput("\x1b[D"); expect(editor.getCursor().col).toBe(4);
  editor.render(13); editor.handleInput("\x1b[B");
  expect(editor.getCursor().col).toBe(11);
  editor.render(13); editor.handleInput("\x1b[A"); expect(editor.getCursor().col).toBe(4);
  editor.handleInput("\x1b[C"); editor.render(13); editor.handleInput("\x1b[B"); expect(editor.getCursor().col).toBe(15);
  editor.render(13); editor.handleInput("\x1b[A"); expect(editor.getCursor().col).toBe(10);
  expect(editor.getText()).toBe("abc $alpha tail");
});

it.each(cases)("maps all three display spaces without new source stops in $host/$icon", ({ host, icon }) => {
  const { editor, base } = fixture(host, icon), source = "abc  $alpha  tail";
  for (const width of [8, 16, 80]) {
    editor.setText(source);
    const padding = base.getPaddingX(), columns = width - 2 * padding - (padding ? 0 : 1);
    const layout = layoutLabels(source, labelReferences(source, new Set(["alpha"])), icon, columns);
    const spaces = layout.flatMap((line, row) => {
      let column = padding;
      return line.cells.flatMap(cell => {
        const x = column; column += cell.width;
        return cell.label && cell.text === " " ? [{ x, y: row + 1 }] : [];
      });
    });
    expect(spaces).toHaveLength(3);
    for (const [index, point] of spaces.entries()) {
      editor.setText(source); editor.render(width);
      editor.handleMouse({ type: "click", button: "left", ...point } as TuiMouseEvent);
      expect(editor.getCursor()).toEqual({ line: 0, col: index === 2 ? 11 : 5 });
      editor.handleInput(index === 2 ? "\x1b[D" : "\x1b[C");
      expect(editor.getCursor().col).toBe(index === 2 ? 5 : 11);
      editor.handleInput(index === 2 ? "\x1b[3~" : "\x7f");
      expect(editor.getText()).toBe("abc    tail");
      editor.handleInput("\x1b[45;5u"); expect(editor.getExpandedText()).toBe(source);
    }
  }
  editor.setText(source);
  expect(editor.render(80).map(stripTerminalSequences).join("\n")).toContain(`abc   ${icons[icon]} alpha   tail`);
});

it.each(cases)("snaps a supplementary-name suffix space after the whole source in $host/$icon", ({ host, icon }) => {
  const { editor, base } = fixture(host, icon, ["𠮷"]);
  editor.setText("$𠮷 tail"); editor.render(80);
  // Prefix space, icon, gap and the two-cell name precede the suffix space.
  editor.handleMouse({ type: "click", button: "left", x: base.getPaddingX() + 5, y: 1 } as TuiMouseEvent);
  expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  editor.handleInput("X"); expect(editor.getText()).toBe("$𠮷X tail");
  editor.handleInput("\x1b[45;5u"); expect(editor.getExpandedText()).toBe("$𠮷 tail");
});

it.each(cases)("exposes every row of a viewport-sized label through paging in $host/$icon", ({ host, icon }) => {
  const name = Array.from({ length: 256 }, (_, index) => index.toString(36).padStart(4, "0")).join("");
  const { editor, base } = fixture(host, icon, [name]); editor.setText("$" + name);
  const width = 16, padding = base.getPaddingX(), columns = width - 2 * padding - (padding ? 0 : 1);
  const expected = layoutLabels("$" + name, labelReferences("$" + name, new Set([name])), icon, columns).map(row => stripTerminalSequences(row.text).trim());
  const seen = new Set<string>();
  for (let i = 0; i <= expected.length; i += 12) {
    for (const row of editor.render(width).slice(1, -1)) seen.add(stripTerminalSequences(row).replace(/^›/, " ").trim());
    editor.handleInput("\x1b[5~");
  }
  expect(expected.filter(row => !seen.has(row))).toEqual([]);
  expect(editor.getExpandedText()).toBe("$" + name);
});

it("scrolls a tall projection with wheel events without changing the source caret", () => {
  const name = "a".repeat(1024), { editor } = fixture("native", "command", [name]); editor.setText("$" + name);
  const before = editor.render(16), cursor = editor.getCursor();
  expect(editor.handleMouse({ type: "wheel", button: "none", x: 1, y: 2, wheelDelta: -12, width: 16, height: before.length } as TuiMouseEvent)?.handled).toBe(true);
  expect(editor.render(16)).not.toEqual(before); expect(editor.getCursor()).toEqual(cursor);
  expect(editor.getExpandedText()).toBe("$" + name);
  editor.handleInput("\x7f"); expect(editor.getText()).toBe("");
});

it("maps projected clicks when native cursor keys are function keys", () => {
  const bindings = getKeybindings(), previous = bindings.getUserBindings();
  bindings.setUserBindings({ ...previous, "tui.editor.cursorLeft": "f1", "tui.editor.cursorRight": "f2" });
  try {
    const { editor } = fixture("native", "command"); editor.setText("abc $alpha tail");
    const rows = editor.render(13).map(stripTerminalSequences), y = rows.findIndex(row => row.includes(" ⌘ alpha "));
    editor.handleMouse({ type: "click", button: "left", x: 1, y, width: 13, height: rows.length } as TuiMouseEvent);
    expect(editor.getCursor().col).toBe(4);
  } finally { bindings.setUserBindings(previous); }
});

it.each(cases)("keeps completion below projected content and groups completion undo in $host/$icon", async ({ host, icon }) => {
  const { editor } = fixture(host, icon);
  editor.setAutocompleteProvider({
    getSuggestions: async () => ({ prefix: "$b", items: [{ value: "beta", label: "beta", description: "Fixture candidate" }, { value: "betamax", label: "betamax" }] }),
    applyCompletion: (lines, line, col, item) => ({ lines: [lines[0].slice(0, col - 2) + "$" + item.value], cursorLine: line, cursorCol: col - 1 + item.value.length }),
  });
  editor.setText("abc $alpha $b"); editor.handleInput("\t"); await delay();
  expect(editor.isShowingAutocomplete()).toBe(true);
  const before = editor.render(12).map(stripTerminalSequences);
  expect(before.some(row => row.includes("beta"))).toBe(true);
  editor.handleInput("\t"); expect(editor.getText()).toBe("abc $alpha $beta");
  editor.handleInput("\x7f"); expect(editor.getText()).toBe("abc $alpha ");
  editor.handleInput("\x1b[45;5u"); expect(editor.getText()).toBe("abc $alpha $beta");
  editor.handleInput("\x1b[45;5u"); expect(editor.getText()).toBe("abc $alpha $b");
});

it.each(cases)("matches a fresh render after unrendered edits and coordinate input in $host/$icon", ({ host, icon }) => {
  for (const edit of ["insert", "set", "type", "remove", "restore"]) for (const key of ["\x1b[A", "\x1b[B", "\x1b[5~", "\x1b[6~", "mouse"]) {
    const actual = fixture(host, icon).editor, control = fixture(host, icon).editor;
    for (const editor of [actual, control]) {
      editor.setText("$alpha\nabc"); editor.render(12);
      if (edit === "insert") editor.insertTextAtCursor("\nxyz");
      if (edit === "set") editor.setText("123\n$alpha\nxyz\nmore");
      if (edit === "type") { editor.handleInput("\x1b\r"); editor.handleInput("xyz"); }
      if (edit === "remove" || edit === "restore") {
        editor.setText("$alpha"); editor.render(12); editor.handleInput("\x7f");
        if (edit === "restore") { editor.render(12); editor.handleInput("\x1b[45;5u"); }
      }
    }
    control.render(12);
    for (const editor of [actual, control]) {
      if (key === "mouse") editor.handleMouse({ type: "click", button: "left", x: 3, y: 2, width: 12, height: 8 } as TuiMouseEvent);
      else editor.handleInput(key);
    }
    expect(actual.getCursor(), `${edit} / ${key}`).toEqual(control.getCursor());
    actual.handleInput("!"); control.handleInput("!");
    expect(actual.getText(), `${edit} / ${key}`).toBe(control.getText());
  }
});
