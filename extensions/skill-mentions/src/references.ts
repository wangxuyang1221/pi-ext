import { randomUUID } from "node:crypto";
import { Marked, type Token } from "@earendil-works/pi-tui";

export interface Reference {
  name: string;
  start: number;
  end: number;
}

const markdown = new Marked();
const boundary = (char: string | undefined) => char === undefined || char === " " || char === "\n" || char === "\t";

const closingDelimiters = new Set(`,.;:!?，。；：！？、…)]}）］｝】》〉」』”’"'`);

function activationBoundary(text: string, end: number): boolean {
  const char = text[end];
  if (boundary(char)) return true;
  if (!closingDelimiters.has(char)) return false;
  // Inspect at most one Unicode code point after a period, not the whole suffix.
  return char !== "." || !/^[\p{L}\p{N}_-]/u.test(text.slice(end + 1, end + 3));
}

/** Find complete references with activation boundaries outside Markdown code. */
export function findReferences(text: string): Reference[] {
  const candidates: Reference[] = [];
  for (const match of text.matchAll(/\$[\p{L}\p{N}_-]*/gu)) {
    const start = match.index, end = start + match[0].length;
    if (boundary(text[start - 1]) && activationBoundary(text, end)) candidates.push({ name: match[0].slice(1), start, end });
  }
  if (!candidates.length) return [];

  // Markdown strips container prefixes from nested tokens. Temporary unique markers
  // retain source identities through that normalization without changing the input.
  let prefix: string;
  do { prefix = `q${randomUUID().slice(0, 8)}x`; } while (text.includes(prefix));
  const parts: string[] = [];
  let offset = 0;
  candidates.forEach((candidate, index) => {
    parts.push(text.slice(offset, candidate.start), `${prefix}${index}z`);
    offset = candidate.end;
  });
  parts.push(text.slice(offset));
  const excluded = new Set<number>();
  const marker = new RegExp(`${prefix}(\\d+)z`, "g");
  // Marked.walkTokens collects callback results with repeated concatenation.
  // This synchronous visitor needs no results and visits each public token once.
  const pending: Token[] = markdown.lexer(parts.join(""));
  while (pending.length) {
    const token = pending.pop()!;
    let raw: string | undefined;
    if (token.type === "code" || token.type === "codespan") raw = token.raw;
    if (raw) for (const match of raw.matchAll(marker)) excluded.add(Number(match[1]));
    if (token.type === "list") {
      for (const item of token.items) pending.push(item);
    } else if (token.type === "table") {
      for (const cell of token.header) for (const child of cell.tokens) pending.push(child);
      for (const row of token.rows) for (const cell of row) for (const child of cell.tokens) pending.push(child);
    } else if ("tokens" in token && Array.isArray(token.tokens)) {
      for (const child of token.tokens) pending.push(child);
    }
  }
  return candidates.filter((_candidate, index) => !excluded.has(index));
}

/** Return a reference at the cursor only with strict whitespace boundaries outside code. */
export function completionReference(text: string, cursor: number): Reference | undefined {
  return findReferences(text).find(reference => reference.end === cursor && boundary(text[cursor]));
}
