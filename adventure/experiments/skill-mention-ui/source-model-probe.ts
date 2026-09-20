import { matchesKey, visibleWidth, type Editor } from "@earendil-works/pi-tui";
import { findReferences, type Reference } from "../../../extensions/skill-mentions/src/references.js";

const cube = "\u{f01a7}";
const cyan = "\x1b[22;38;2;141;249;253m";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
type Snapshot = { text: string; atoms: Reference[] };
type ProjectedAtom = { start: number; end: number };

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
export function sourceModelProbe(base: Editor, names: ReadonlySet<string>) {
  let atoms: Reference[] = [];
  const journal: Snapshot[] = [];
  let inPaste = false;
  const snapshot = (): Snapshot => ({ text: base.getText(), atoms: atoms.map(atom => ({ ...atom })) });
  function recognize(all: boolean) {
    const text = base.getText();
    atoms = findReferences(text).filter(ref => names.has(ref.name) && (all || ref.end < text.length));
  }
  function offset() {
    const cursor = base.getCursor();
    return base.getLines().slice(0, cursor.line).reduce((total, line) => total + line.length + 1, 0) + cursor.col;
  }
  function moveTo(destination: number) {
    for (let remaining = base.getText().length + 1; offset() !== destination && remaining > 0; remaining--) {
      const before = offset();
      base.handleInput(before < destination ? "\x1b[C" : "\x1b[D");
      if (offset() === before) throw new Error("Public cursor movement made no progress");
    }
    if (offset() !== destination) throw new Error("Public cursor movement did not reach the target");
  }
  function render(width: number): string[] {
    const text = base.getText();
    let view = "", start = 0;
    const projected: ProjectedAtom[] = [];
    for (const atom of atoms) {
      view += text.slice(start, atom.start);
      const label = ` ${cube} ${atom.name} `;
      projected.push({ start: view.length, end: view.length + label.length });
      view += label;
      start = atom.end;
    }
    view += text.slice(start);
    const result: string[] = [];
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
        result.push(output);
      }
      lineOffset += line.length + 1;
    }
    return result;
  }
  return {
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
          journal.push(before);
          base.setText(before.text.slice(0, removed.start) + before.text.slice(removed.end));
          moveTo(removed.start);
          recognize(true);
          return;
        }
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
  };
}
