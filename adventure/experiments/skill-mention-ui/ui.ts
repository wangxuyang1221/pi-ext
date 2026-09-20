import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { findReferences, type Reference } from "../../../extensions/skill-mentions/src/references.js";

export type Variant = "accent" | "tint";
export const sample = "$presentations, 和 $lark-doc，这两个 skill 做啥的？\n$unknown  ` $presentations `  \\$lark-doc";
export const openStyle = (variant: Variant) => `\x1b[1;38;2;137;205;255${variant === "tint" ? ";48;2;43;62;78" : ""}m`;

// A length-preserving prototype adapter, not the final punctuation grammar.
export function normalizePunctuation(text: string): string {
  return text.replace(/(\$[\p{L}\p{N}_-]+)[,，。.！!？?；;：:、]/gu, "$1 ");
}

export function knownReferences(text: string, names: ReadonlySet<string>): Reference[] {
  return findReferences(normalizePunctuation(text)).filter(reference => names.has(reference.name));
}

export function styleMarkdown(text: string, names: ReadonlySet<string>, variant: Variant, background = "\x1b[49m"): string {
  let output = text;
  for (const reference of knownReferences(text, names).reverse()) {
    // Code spans prevent Pi's inline LaTeX parser from consuming paired dollars.
    output = output.slice(0, reference.start) + "`" + openStyle(variant) + output.slice(reference.start, reference.end)
      + "\x1b[22m\x1b[39m" + (variant === "tint" ? background : "") + "`" + output.slice(reference.end);
  }
  return output;
}

export function styleEditorLines(lines: string[], source: string, names: ReadonlySet<string>, variant: Variant): string[] {
  const references = knownReferences(source, names);
  let offset = 0;
  const logical = source.split("\n").map(text => {
    const row = { text, offset };
    offset += text.length + 1;
    return row;
  });
  // Only decorate complete visible logical lines. Wrapped/collapsed lines are
  // intentionally left plain rather than guessing source coordinates.
  return lines.map(raw => {
    const plain = stripTerminalSequences(raw);
    const row = logical.find(item => item.text.length > 0 && plain.includes(item.text));
    if (!row) return raw;
    const start = plain.indexOf(row.text);
    const spans = references.filter(ref => ref.start >= row.offset && ref.end <= row.offset + row.text.length)
      .map(ref => ({ start: start + ref.start - row.offset, end: start + ref.end - row.offset }));
    if (!spans.length) return raw;
    const ansi = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|_[^\x07]*(?:\x07|\x1b\\))/g;
    let out = "", index = 0, position = 0, sgr = "";
    function append(text: string) {
      for (const char of text) {
        out += spans.some(span => position >= span.start && position < span.end)
          ? openStyle(variant) + char + "\x1b[22m\x1b[39m\x1b[49m" + sgr : char;
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
