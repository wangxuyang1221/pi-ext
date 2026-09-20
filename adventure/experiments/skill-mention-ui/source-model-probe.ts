import { matchesKey, visibleWidth, type Editor } from "@earendil-works/pi-tui";
import { findReferences, type Reference } from "../../../extensions/skill-mentions/src/references.js";

const cube = "\u{f01a7}";
const cyan = "\x1b[22;38;2;141;249;253m";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
type Snapshot = { text: string; atoms: Reference[]; undoOperations?: number; after?: string };
type ProjectedAtom = { start: number; end: number; sourceStart: number; sourceEnd: number };

// Own projection layout: wordWrapLine is not exported from the package root.
function wrapProjectedLine(line: string, width: number, segments: Intl.SegmentData[]) {
  const units = segments.flatMap(segment => visibleWidth(segment.segment) <= width ? [segment]
    : [...graphemes.segment(segment.segment)].map(child => ({ ...child, index: segment.index + child.index })));
  const chunks: { text: string; startIndex: number }[] = [];
  let start = 0, cells = 0;
  for (const unit of units) {
    const size = visibleWidth(unit.segment);
    if (cells + size > width && unit.index > start) {
      chunks.push({ text: line.slice(start, unit.index), startIndex: start });
      start = unit.index;
      cells = 0;
    }
    cells += size;
  }
  chunks.push({ text: line.slice(start), startIndex: start });
  return chunks;
}

// A planning probe, not a complete EditorComponent: source/undo and projection
// layout run here; app chrome, menus, viewport and IME integration are deferred.
export function sourceModelProbe(base: Editor, names: ReadonlySet<string>, icon: "cube" | "command" = "cube", references = findReferences) {
  let atoms: Reference[] = [];
  const journal: Snapshot[] = [];
  let inPaste = false;
  let listener = base.onChange;
  let batching = false, changed = false;
  // onChange is the documented callback field, not an editor method override.
  base.onChange = text => { if (batching) changed = true; else listener?.(text); };
  function batch(action: () => void) {
    batching = true;
    try { action(); }
    finally {
      batching = false;
      if (changed) { changed = false; listener?.(base.getText()); }
    }
  }
  const snapshot = (): Snapshot => ({ text: base.getText(), atoms: atoms.map(atom => ({ ...atom })) });
  function recognize(all: boolean) {
    const text = base.getText();
    atoms = references(text).filter(ref => names.has(ref.name) && (all || ref.end < text.length || offset() !== ref.end
      || atoms.some(previous => previous.start === ref.start && previous.end === ref.end && previous.name === ref.name)));
  }
  function offset() {
    const cursor = base.getCursor();
    return base.getLines().slice(0, cursor.line).reduce((total, line) => total + line.length + 1, 0) + cursor.col;
  }
  function moveTo(destination: number) {
    for (let remaining = base.getText().length + 1; offset() !== destination && remaining > 0; remaining--) {
      const before = offset();
      base.handleInput(before < destination ? "\x1b[C" : "\x1b[D");
      const after = offset();
      if (after === before) throw new Error("Public cursor movement made no progress");
      // Native paste markers and graphemes can skip an unreachable offset.
      if ((before - destination) * (after - destination) < 0) {
        if (Math.abs(before - destination) < Math.abs(after - destination)) {
          base.handleInput(before < after ? "\x1b[D" : "\x1b[C");
        }
        return;
      }
    }
    if (offset() !== destination) throw new Error("Public cursor movement did not reach the target");
  }
  function layout(width: number) {
    const text = base.getText();
    let view = "", start = 0;
    const projected: ProjectedAtom[] = [];
    for (const atom of atoms) {
      view += text.slice(start, atom.start);
      const label = ` ${icon === "command" ? "⌘" : cube} ${atom.name} `;
      projected.push({ start: view.length, end: view.length + label.length, sourceStart: atom.start, sourceEnd: atom.end });
      view += label;
      start = atom.end;
    }
    view += text.slice(start);
    const rows: { text: string; plain: string; start: number; end: number }[] = [];
    let lineOffset = 0;
    for (const line of view.split("\n")) {
      const local = projected.filter(atom => atom.start >= lineOffset && atom.end <= lineOffset + line.length)
        .map(atom => ({ start: atom.start - lineOffset, end: atom.end - lineOffset }));
      const segments: Intl.SegmentData[] = [];
      for (const segment of graphemes.segment(line)) {
        const atom = local.find(atom => atom.start <= segment.index && segment.index < atom.end);
        if (!atom) segments.push(segment);
        else if (segment.index === atom.start) segments.push({ segment: line.slice(atom.start, atom.end), index: atom.start, input: line });
      }
      for (const chunk of wrapProjectedLine(line, width, segments)) {
        let output = "", index = chunk.startIndex;
        for (const char of chunk.text) {
          output += local.some(atom => atom.start <= index && index < atom.end) ? cyan + char + "\x1b[39m" : char;
          index += char.length;
        }
        rows.push({ text: output, plain: chunk.text, start: lineOffset + chunk.startIndex, end: lineOffset + chunk.startIndex + chunk.text.length });
      }
      lineOffset += line.length + 1;
    }
    return { rows, view, projected };
  }
  function render(width: number) { return layout(width).rows.map(row => row.text); }
  function cursorPoint(sourceOffset: number, width: number) {
    const data = layout(width);
    let viewOffset = sourceOffset;
    for (const atom of data.projected) {
      if (sourceOffset >= atom.sourceEnd) viewOffset += atom.end - atom.start - (atom.sourceEnd - atom.sourceStart);
      else if (sourceOffset > atom.sourceStart) {
        viewOffset = sourceOffset - atom.sourceStart < atom.sourceEnd - sourceOffset ? atom.start : atom.end;
        break;
      } else break;
    }
    let row = data.rows.findIndex(row => viewOffset >= row.start && viewOffset < row.end);
    if (row < 0) row = data.rows.findIndex(row => viewOffset === row.start);
    if (row < 0) row = data.rows.findIndex(row => viewOffset === row.end);
    if (row < 0) throw new Error("Source cursor has no projected row");
    return { row, col: visibleWidth(data.rows[row].plain.slice(0, viewOffset - data.rows[row].start)) };
  }
  function placeCursor(rowIndex: number, column: number, width: number) {
    const data = layout(width);
    const row = data.rows[Math.max(0, Math.min(data.rows.length - 1, rowIndex))];
    let cells = 0, viewOffset = row.end;
    for (const segment of graphemes.segment(row.plain)) {
      if (column < cells + visibleWidth(segment.segment)) { viewOffset = row.start + segment.index; break; }
      cells += visibleWidth(segment.segment);
    }
    let sourceOffset = viewOffset;
    for (const atom of data.projected) {
      if (viewOffset >= atom.end) sourceOffset -= atom.end - atom.start - (atom.sourceEnd - atom.sourceStart);
      else if (viewOffset >= atom.start) {
        sourceOffset = visibleWidth(data.view.slice(atom.start, viewOffset)) < visibleWidth(data.view.slice(viewOffset, atom.end))
          ? atom.sourceStart : atom.sourceEnd;
        break;
      } else break;
    }
    moveTo(sourceOffset);
  }
  return {
    get onChange() { return listener; },
    set onChange(value: ((text: string) => void) | undefined) { listener = value; },
    getText: () => base.getText(),
    getExpandedText: () => base.getExpandedText(),
    setText(text: string) { base.setText(text); recognize(true); },
    handleInput(data: string) {
      const before = snapshot();
      const completesMenu = base.isShowingAutocomplete() && (matchesKey(data, "tab") || matchesKey(data, "enter"));
      const completesPaste = (inPaste || data.includes("\x1b[200~")) && data.includes("\x1b[201~");
      if (data.includes("\x1b[200~")) inPaste = true;
      if (completesPaste) inPaste = false;
      const cursor = offset();
      const previous = atoms.find(atom => atom.end === cursor);
      const next = atoms.find(atom => atom.start === cursor);
      if (!base.isShowingAutocomplete()) {
        if (previous && matchesKey(data, "left")) return moveTo(previous.start);
        if (next && matchesKey(data, "right")) return moveTo(next.end);
        const removed = matchesKey(data, "backspace") ? previous : matchesKey(data, "delete") ? next : undefined;
        if (removed) {
          const expected = before.text.slice(0, removed.start) + before.text.slice(removed.end);
          let operations = 0;
          batch(() => {
            while (base.getText().length > expected.length && operations <= before.text.length) {
              const length = base.getText().length;
              base.handleInput(data);
              operations++;
              if (base.getText().length >= length) throw new Error("Native deletion made no progress");
            }
          });
          if (base.getText() !== expected) throw new Error("Native deletion crossed the atom boundary");
          journal.push({ ...before, undoOperations: operations, after: expected });
          recognize(true);
          return;
        }
      }
      const composite = journal.at(-1);
      if (matchesKey(data, "ctrl+-") && composite?.undoOperations && composite.after === before.text) {
        batch(() => { for (let index = 0; index < composite.undoOperations!; index++) base.handleInput(data); });
        if (base.getText() !== composite.text) throw new Error("Composite undo did not restore the source");
        atoms = composite.atoms;
        journal.pop();
        return;
      }
      base.handleInput(data);
      if (matchesKey(data, "ctrl+-")) {
        const index = journal.findLastIndex(entry => entry.text === base.getText());
        if (index >= 0) { atoms = journal[index].atoms; journal.splice(index); }
        else recognize(true);
      } else {
        if (before.text !== base.getText()) {
          journal.push(before);
          recognize(completesPaste || completesMenu);
        }
      }
    },
    render,
    layout,
    sourceOffset: offset,
    hasAtoms: () => atoms.length > 0,
    cursorPoint,
    placeCursor,
  };
}
