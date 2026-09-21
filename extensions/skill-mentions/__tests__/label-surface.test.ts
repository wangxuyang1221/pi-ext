import { beforeAll, expect, it } from "vitest";
import { initTheme, type Theme, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { getKeybindings, stripTerminalSequences, visibleWidth, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { CodexEditor } from "../../codex-ui/src/components.js";
import { createLabelEditor } from "../src/label-editor.js";
import { LabelNativeEditor } from "../src/editor-surface.js";
import { icons, labelReferences, layoutLabels, type IconMode } from "../src/labels.js";

beforeAll(() => initTheme("dark", false));
const delay = () => new Promise(resolve => setTimeout(resolve, 10));
function fixture(host: string, icon: IconMode, names = ["alpha", "beta"]) {
  const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI;
  const same = (value: string) => value;
  const theme = { fg: (_name: string, value: string) => value, getBgAnsi: () => "\x1b[48;5;238m" } as Theme;
  const editorTheme = { borderColor: same, selectList: { selectedPrefix: same, selectedText: same, description: same, scrollInfo: same, noMatch: same } };
  const keys = { matches: () => false } as unknown as KeybindingsManager;
  const base = host === "native" ? new LabelNativeEditor(tui, editorTheme, keys) : new CodexEditor(tui, editorTheme, keys, () => theme);
  const editor = createLabelEditor(base, { names: () => new Set(names), icon: () => icon, tui });
  return { editor, base, tui };
}
const cases = ["native", "codex"].flatMap(host => (["cube", "command"] as const).map(icon => ({ host, icon })));
it.each(cases)("preserves full long names through narrow viewports and resize in $host/$icon", ({ host, icon }) => {
  const name = "a".repeat(1024), { editor, tui } = fixture(host, icon, [name]);
  editor.setText("prefix $" + name + " suffix");
  for (const width of [8, 16, 80, 120, 8]) {
    tui.terminal.columns = width;
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
  const rendered = editor.render(10).map(stripTerminalSequences);
  const row = rendered.findIndex(line => line.includes(icons[icon] + "alpha"));
  expect(row).toBeGreaterThan(0);
  const x = rendered[row].indexOf(icons[icon]);
  // Cube is a supplementary-plane character but its terminal width is one cell.
  editor.handleMouse({ type: "click", button: "left", x: x + 1, y: row } as TuiMouseEvent);
  expect(editor.getCursor().col).toBe(4);
  editor.handleInput("\x1b[C"); expect(editor.getCursor().col).toBe(10);
  editor.handleInput("\x1b[D"); expect(editor.getCursor().col).toBe(4);
  editor.render(10); editor.handleInput("\x1b[B");
  expect(editor.getCursor().col).toBe(11);
  editor.render(10); editor.handleInput("\x1b[A"); expect(editor.getCursor().col).toBe(4);
  editor.handleInput("\x1b[C"); editor.render(10); editor.handleInput("\x1b[B"); expect(editor.getCursor().col).toBe(15);
  editor.render(10); editor.handleInput("\x1b[A"); expect(editor.getCursor().col).toBe(10);
  expect(editor.getText()).toBe("abc $alpha tail");
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
    const rows = editor.render(10).map(stripTerminalSequences), y = rows.findIndex(row => row.includes("⌘alpha"));
    editor.handleMouse({ type: "click", button: "left", x: 1, y, width: 10, height: rows.length } as TuiMouseEvent);
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
