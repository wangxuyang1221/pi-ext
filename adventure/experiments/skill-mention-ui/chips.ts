import { matchesKey, stripTerminalSequences, type AutocompleteProvider, type EditorComponent } from "@earendil-works/pi-tui";
import { knownReferences } from "./ui.js";

export const chipLabel = (name: string) => `‹ ◇ ${name} ›`;
// Invisible separators distinguish projected atoms from literal lookalike text.
const marker = "\u2063";
// Braille blank occupies one cell but is not a wrap opportunity. Rendering
// replaces it with a normal space; no font or terminal protocol is required.
const chipPattern = () => /\u2063‹\u2800◇\u2800([\p{L}\p{N}_-]+)\u2800›\u2063/gu;
export const chipToken = (name: string) => marker + chipLabel(name).replaceAll(" ", "\u2800") + marker;
export function encodeChips(text: string, names: ReadonlySet<string>): string {
  for (const ref of knownReferences(text, names).reverse()) {
    text = text.slice(0, ref.start) + chipToken(ref.name) + text.slice(ref.end);
  }
  return text;
}
export function decodeChips(text: string): string {
  return text.replace(chipPattern(), (_match, name: string) => `$${name}`);
}
const chipStyle = "\x1b[1;38;2;226;202;232;48;2;53;37;59m";
export function chipMarkdown(text: string, names: ReadonlySet<string>, background: string): string {
  for (const ref of knownReferences(text, names).reverse()) {
    text = text.slice(0, ref.start) + "`" + chipStyle + chipLabel(ref.name)
      + "\x1b[22m\x1b[39m" + background + "`" + text.slice(ref.end);
  }
  return text;
}
export function styleChipLines(lines: string[]): string[] {
  return lines.map(raw => {
    const spans = [...stripTerminalSequences(raw).matchAll(chipPattern())].map(match => ({ start: match.index, end: match.index + match[0].length }));
    if (!spans.length) return raw.replaceAll(marker, "").replaceAll("\u2800", " ");
    const ansi = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|_[^\x07]*(?:\x07|\x1b\\))/g;
    let out = "", index = 0, position = 0, sgr = "";
    function append(text: string) {
      for (const char of text) {
        if (char !== marker) out += spans.some(span => position >= span.start && position < span.end)
          ? chipStyle + (char === "\u2800" ? " " : char) + "\x1b[22m\x1b[39m\x1b[49m" + sgr : char;
        position += char.length;
      }
    }
    for (const match of raw.matchAll(ansi)) {
      append(raw.slice(index, match.index));
      out += match[0];
      if (match[0].endsWith("m")) sgr = match[0] === "\x1b[0m" ? "" : sgr + match[0];
      index = match.index + match[0].length;
    }
    append(raw.slice(index));
    return out;
  });
}

export function chipEditor(base: EditorComponent, names: () => ReadonlySet<string>): EditorComponent {
  const getCursor = Reflect.get(base, "getCursor") as () => { line: number; col: number };
  if (typeof getCursor !== "function") throw new Error("Chip prototype requires the public Editor.getCursor API");
  const offset = () => {
    const cursor = getCursor.call(base);
    return base.getText().split("\n").slice(0, cursor.line).reduce((total, line) => total + line.length + 1, 0) + cursor.col;
  };
  const spans = () => [...base.getText().matchAll(chipPattern())].map(match => ({ start: match.index, end: match.index + match[0].length }));
  function moveTo(destination: number) {
    // Public cursor movement retains the existing editor's layout and IME marker.
    for (let guard = base.getText().length + 1; guard > 0 && offset() !== destination; guard--) {
      const before = offset();
      base.handleInput(before < destination ? "\x1b[C" : "\x1b[D");
      if (offset() === before) break;
    }
  }
  function remove(start: number, end: number) {
    // setText records one native undo snapshot for the complete atomic edit.
    base.setText(base.getText().slice(0, start) + base.getText().slice(end));
    moveTo(start);
  }
  function snapCursor() {
    const current = offset();
    const inside = spans().find(span => span.start < current && current < span.end);
    if (inside) moveTo(current - inside.start <= inside.end - current ? inside.start : inside.end);
  }
  function input(data: string) {
    snapCursor();
    const before = offset();
    const menu = Reflect.get(base, "isShowingAutocomplete")?.call(base);
    if (!menu) {
      const previous = spans().find(span => span.end === before);
      const next = spans().find(span => span.start === before);
      if (previous && matchesKey(data, "left")) return moveTo(previous.start);
      if (next && matchesKey(data, "right")) return moveTo(next.end);
      if (previous && matchesKey(data, "backspace")) return remove(previous.start, previous.end);
      if (next && matchesKey(data, "delete")) return remove(next.start, next.end);
      if (matchesKey(data, "ctrl+w") || matchesKey(data, "alt+backspace")) {
        const word = spans().find(span => span.end <= before && /^\s*$/.test(base.getText().slice(span.end, before)));
        if (word) return remove(word.start, before);
      }
      if (matchesKey(data, "alt+d")) {
        const word = spans().find(span => span.start >= before && /^\s*$/.test(base.getText().slice(before, span.start)));
        if (word) return remove(before, word.end);
      }
    }
    base.handleInput(data);
    const current = offset();
    const inside = spans().find(span => span.start < current && current < span.end);
    if (inside) moveTo(current < before ? inside.start : inside.end);
  }
  const callbacks = new Map<PropertyKey, unknown>();
  return new Proxy(base, {
    get(target, key) {
      if (key === "handleInput") return input;
      if (key === "render") return (width: number) => styleChipLines(target.render(width));
      if (key === "getText") return () => decodeChips(target.getText());
      if (key === "getExpandedText") return () => decodeChips(target.getExpandedText?.() ?? target.getText());
      if (key === "setText") return (text: string) => target.setText(encodeChips(text, names()));
      if (key === "addToHistory") return (text: string) => target.addToHistory?.(encodeChips(text, names()));
      if (key === "insertTextAtCursor") return (text: string) => target.insertTextAtCursor?.(encodeChips(text, names()));
      if (key === "setAutocompleteProvider") return (provider: AutocompleteProvider) => target.setAutocompleteProvider?.({
        triggerCharacters: provider.triggerCharacters,
        getSuggestions: (...args) => provider.getSuggestions(...args),
        shouldTriggerFileCompletion: (...args) => provider.shouldTriggerFileCompletion?.(...args) ?? true,
        applyCompletion(lines, row, col, item, prefix) {
          const result = provider.applyCompletion(lines, row, col, item, prefix);
          if (!prefix.startsWith("$") || !item.value.startsWith("$") || !names().has(item.value.slice(1))) return result;
          const start = col - prefix.length;
          const token = chipToken(item.value.slice(1));
          result.lines[row] = result.lines[row].slice(0, start) + token + result.lines[row].slice(start + item.value.length);
          result.cursorCol = start + token.length;
          return result;
        },
      });
      if (callbacks.has(key)) return callbacks.get(key);
      const value = Reflect.get(target, key, target);
      if (key === "handleMouse" && typeof value === "function") return (...args: unknown[]) => {
        const result = value.apply(target, args);
        snapCursor();
        return result;
      };
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (key === "onSubmit" || key === "onChange") {
        callbacks.set(key, value);
        return Reflect.set(target, key, typeof value === "function" ? (text: string) => value(decodeChips(text)) : value, target);
      }
      return Reflect.set(target, key, value, target);
    },
  });
}
