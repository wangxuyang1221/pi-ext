/** Remove terminal controls from one source line, before highlighting or padding. */
export function sanitizeDiffSource(text: string): string {
  const visible: string[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor);
    if (code === 9 || code === 10 || code >= 32 && code < 127 || code >= 160) {
      cursor++;
      continue;
    }
    visible.push(text.slice(start, cursor));
    cursor++;
    if (code === 27) {
      const next = text.charCodeAt(cursor);
      if (next === 91) cursor = skipCsi(text, cursor + 1);
      else if (next === 93 || next === 80 || next === 88 || next === 94 || next === 95) {
        cursor = skipString(text, cursor + 1);
      } else {
        // Other ESC sequences have optional intermediate bytes and a final byte.
        while (inRange(text.charCodeAt(cursor), 0x20, 0x2f)) cursor++;
        if (inRange(text.charCodeAt(cursor), 0x30, 0x7e)) cursor++;
      }
    } else if (code === 0x9b) cursor = skipCsi(text, cursor);
    else if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
      cursor = skipString(text, cursor);
    }
    start = cursor;
  }
  visible.push(text.slice(start));
  return visible.join("");
}

function inRange(code: number, first: number, last: number): boolean {
  return code >= first && code <= last;
}

function skipCsi(text: string, cursor: number): number {
  // ECMA-48: parameters 0x30..0x3f, intermediates 0x20..0x2f, final 0x40..0x7e.
  while (inRange(text.charCodeAt(cursor), 0x30, 0x3f)) cursor++;
  while (inRange(text.charCodeAt(cursor), 0x20, 0x2f)) cursor++;
  if (inRange(text.charCodeAt(cursor), 0x40, 0x7e)) cursor++;
  // An incomplete prefix is discarded; an invalid next character is processed normally.
  return cursor;
}

function skipString(text: string, cursor: number): number {
  // Suppress an unterminated string's remaining payload on this source line.
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor++);
    if (code === 7 || code === 0x9c) return cursor;
    if (code === 27 && text.charCodeAt(cursor) === 92) return cursor + 1;
  }
  return cursor;
}
