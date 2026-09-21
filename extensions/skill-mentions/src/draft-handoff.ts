import type { TUI } from "@earendil-works/pi-tui";

export interface DraftPart { text: string; paste: boolean; }
export interface DraftHandoff { raw: string; expanded: string; parts: DraftPart[]; }
const registryKey = Symbol.for("pi-ext/skill-mentions/reload-drafts-v1");
const shared = globalThis as typeof globalThis & { [registryKey]?: WeakMap<TUI, DraftHandoff> };
// Only source strings cross extension reload. No editor, callback, session or undo journal is retained.
const drafts = shared[registryKey] ??= new WeakMap<TUI, DraftHandoff>();
const marker = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;

/** Capture observed paste sources by native marker identity, not by matching task text. */
export function draftParts(raw: string, sources: ReadonlyMap<number, string>): DraftPart[] {
  const parts: DraftPart[] = [];
  let offset = 0;
  for (const match of raw.matchAll(marker)) {
    const text = sources.get(Number(match[1]));
    if (text === undefined) continue;
    if (match.index > offset) parts.push({ text: raw.slice(offset, match.index), paste: false });
    parts.push({ text, paste: true }); offset = match.index + match[0].length;
  }
  if (offset < raw.length) parts.push({ text: raw.slice(offset), paste: false });
  return parts;
}

export function saveDraftHandoff(tui: TUI, draft: DraftHandoff): void { drafts.set(tui, draft); }
export function takeDraftHandoff(tui: TUI): DraftHandoff | undefined {
  const draft = drafts.get(tui); drafts.delete(tui); return draft;
}
export function clearDraftHandoff(tui: TUI): void { drafts.delete(tui); }

/** Match native bracketed-paste normalization before storing source-only metadata. */
export function normalizedPaste(text: string, preceding: string): string {
  const decoded = text.replace(/\x1b\[(\d+);5u/g, (match, value: string) => {
    const code = Number(value);
    return code >= 97 && code <= 122 ? String.fromCharCode(code - 96) : code >= 65 && code <= 90 ? String.fromCharCode(code - 64) : match;
  });
  let clean = decoded.replace(/\r\n?/g, "\n").replace(/\t/g, "    ")
    .split("").filter(char => char === "\n" || char.charCodeAt(0) >= 32).join("");
  if (/^[\/~.]/.test(clean) && /\w/.test(preceding)) clean = ` ${clean}`;
  return clean;
}
