import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { labelColor, type LabelLine } from "./labels.js";

export interface ProjectedSurface {
  renderProjectedLines(width: number, content: string[], menu: string[], hiddenAbove: number, hiddenBelow: number): string[];
}

/** Keep native working-status borders through protected, documented rendering hooks. */
export class LabelNativeEditor extends CustomEditor implements ProjectedSurface {
  constructor(tui: TUI, theme: EditorTheme, keys: KeybindingsManager) {
    super(tui, theme, keys, { embedWorkingStatus: true });
  }
  renderProjectedLines(width: number, content: string[], menu: string[], hiddenAbove: number, hiddenBelow: number): string[] {
    return [this.renderTopBorder(width, hiddenAbove), ...content, this.renderBottomBorder(width, hiddenBelow), ...menu];
  }
}

/** Obtain menu geometry through public renders, without inspecting frame text. */
export function sourceSurface(base: CustomEditor, width: number, rows: number) {
  const composed = base as CustomEditor & { renderSourceSurface?: (width: number) => { nativeBodyRows: number; menu: string[] } };
  if (composed.renderSourceSurface) return composed.renderSourceSurface(width);
  let menuHeight = 0;
  if (base.isShowingAutocomplete()) {
    // With no logical line wrapped, source body height is known independently of its text.
    // Pi 0.86 SelectList uses one row per item; row count is independent of width.
    const wide = base.getLines().reduce((size, line) => Math.max(size, visibleWidth(line)), width) + 2 * base.getPaddingX() + 1;
    const full = base.render(wide);
    const bodyHeight = Math.min(base.getLines().length, Math.max(5, Math.floor(rows * 0.3)));
    menuHeight = full.length - bodyHeight - 2;
  }
  const frame = base.render(width);
  const nativeBodyRows = frame.length - menuHeight - 2;
  return { nativeBodyRows, menu: menuHeight ? frame.slice(-menuHeight) : [] };
}

export function projectedCursor(lines: readonly LabelLine[], offset: number): { row: number; column: number } {
  let row = 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].start <= offset) row = i;
  const line = lines[row];
  return { row, column: line.cells.filter(cell => cell.end <= offset).reduce((total, cell) => total + cell.width, 0) };
}

export function paintEditorLine(line: LabelLine, cursor: number | undefined, focused: boolean): string {
  const parts: string[] = [];
  let colored = false, inserted = false;
  for (const cell of line.cells) {
    if (colored !== cell.label) { parts.push(cell.label ? labelColor : "\x1b[39m\x1b[22m"); colored = cell.label; }
    if (cursor !== undefined && cursor <= cell.start && !inserted) {
      parts.push(focused ? CURSOR_MARKER : "", "\x1b[7m", cell.text, "\x1b[27m"); inserted = true;
    } else parts.push(cell.text);
  }
  if (colored) parts.push("\x1b[39m\x1b[22m");
  if (cursor !== undefined && !inserted) parts.push(focused ? CURSOR_MARKER : "", "\x1b[7m \x1b[27m");
  return parts.join("");
}
