import { visibleWidth } from "@earendil-works/pi-tui";
import { findReferences, type Reference } from "./references.js";

export type IconMode = "cube" | "command";
export const icons: Record<IconMode, string> = { cube: "\u{f01a7}", command: "⌘" };
export const labelColor = "\x1b[22m\x1b[38;2;141;249;253m";
const colorEnd = "\x1b[39m\x1b[22m";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export interface LabelCell { text: string; start: number; end: number; width: number; label: boolean; }
export interface LabelLine { text: string; start: number; end: number; cells: LabelCell[]; }

/** Resolve visual references through the same parser used for activation. */
export function labelReferences(text: string, names: ReadonlySet<string>, typingCursor?: number): Reference[] {
  return findReferences(text).filter(value => names.has(value.name) &&
    !(typingCursor !== undefined && value.start < typingCursor && typingCursor <= value.end));
}

/** Paint source ranges without introducing task or history markers. */
export function paintLabels(text: string, labels: readonly Reference[], mode: IconMode): string {
  const parts: string[] = [];
  let start = 0;
  for (const label of labels) {
    parts.push(text.slice(start, label.start), labelColor, icons[mode], label.name, colorEnd);
    start = label.end;
  }
  parts.push(text.slice(start));
  return parts.join("");
}

function paintCells(cells: readonly LabelCell[]): string {
  const parts: string[] = [];
  let colored = false;
  for (const cell of cells) {
    if (cell.label !== colored) { parts.push(cell.label ? labelColor : colorEnd); colored = cell.label; }
    parts.push(cell.text);
  }
  if (colored) parts.push(colorEnd);
  return parts.join("");
}

/** Lay out source cells independently of host frames, retaining UTF-16 source coordinates. */
export function layoutLabels(text: string, labels: readonly Reference[], mode: IconMode, width: number): LabelLine[] {
  width = Math.max(1, Math.floor(width));
  const byStart = new Map(labels.map(value => [value.start, value]));
  const lines: LabelLine[] = [];
  let cells: LabelCell[] = [], used = 0, lineStart = 0;
  const flush = (end: number) => {
    lines.push({ text: paintCells(cells), start: lineStart, end, cells });
    cells = []; used = 0; lineStart = end;
  };
  const append = (value: string, start: number, labeled: boolean) => {
    const appendCell = (text: string, index: number, cellWidth: number) => {
      const cell = { text, start: start + index, end: start + index + text.length, width: cellWidth, label: labeled };
      if (used && used + cell.width > width) flush(cell.start);
      cells.push(cell); used += cell.width;
    };
    // Avoid creating one ICU iterator per ordinary ASCII word or space.
    if (/^[\x20-\x7e]*$/u.test(value)) {
      for (let i = 0; i < value.length; i++) appendCell(value[i], i, 1);
    } else {
      for (const part of segmenter.segment(value)) appendCell(part.segment, part.index, visibleWidth(part.segment));
    }
  };
  let offset = 0;
  while (offset < text.length) {
    if (text[offset] === "\n") { flush(offset); offset++; lineStart = offset; continue; }
    const label = byStart.get(offset);
    if (label) {
      const size = visibleWidth(icons[mode]) + visibleWidth(label.name);
      if (used && size <= width && used + size > width) flush(offset);
      const iconWidth = visibleWidth(icons[mode]);
      if (used && used + iconWidth > width) flush(offset);
      cells.push({ text: icons[mode], start: offset, end: offset + 1, width: iconWidth, label: true }); used += iconWidth;
      append(label.name, offset + 1, true); offset = label.end;
    } else {
      let end = offset + 1;
      const space = /\s/u.test(text[offset]);
      while (end < text.length && text[end] !== "\n" && /\s/u.test(text[end]) === space && !byStart.has(end)) end++;
      const value = text.slice(offset, end), size = visibleWidth(value);
      if (!space && used && size <= width && used + size > width) flush(offset);
      append(value, offset, false); offset = end;
    }
  }
  flush(text.length);
  return lines;
}
