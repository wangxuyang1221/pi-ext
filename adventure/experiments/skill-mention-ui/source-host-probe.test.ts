import { expect, it } from "vitest";
import { CURSOR_MARKER, Editor, stripTerminalSequences, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { sourceHostProbe } from "./source-host-probe.js";

const identity = (text: string) => text;
const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} } as unknown as TUI;

it("composes source projection with the actual native frame and focused cursor marker", () => {
  const base = new Editor(tui, theme);
  const editor = sourceHostProbe(base, new Set(["presentations"]), { rows: () => 30, codex: false, background: () => "", icon: "cube" });
  editor.focused = true;
  editor.setText("用 $presentations 后文");
  for (const width of [8, 16, 80]) {
    const rows = editor.render(width);
    expect(rows.map(stripTerminalSequences).join("")).toContain("\u{f01a7}");
    expect(rows[0]).toContain("─");
    expect(rows.at(-1)).toContain("─");
    expect(rows.join("")).toContain(CURSOR_MARKER);
    expect(rows.every(row => visibleWidth(row) <= width)).toBe(true);
    expect(base.getText()).toBe("用 $presentations 后文");
  }
});
