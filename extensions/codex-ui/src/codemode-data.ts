import { stripTerminalSequences } from "@earendil-works/pi-tui";

export type RecordValue = Record<string, unknown>;
export const record = (value: unknown): RecordValue | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
export const clean = (value: unknown, limit = 4096): string => stripTerminalSequences(String(value ?? "").slice(0, limit))
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, "").replace(/\t/gu, "  ");
export const inline = (value: unknown, limit = 512): string => clean(value, limit).replace(/\s+/gu, " ").trim();
const SECRET = /api[-_]?key|access[-_]?token|authorization|password|passwd|secret|cookie/i;

/** Bounded work and allocation, including arbitrarily wide or cyclic extension results. */
export function snapshot(value: unknown, maxChars: number, redact = false): { value: unknown; complete: boolean; chars: number } {
  let left = maxChars, complete = true, nodes = 0;
  const seen = new WeakSet<object>();
  const visit = (input: unknown, depth: number): unknown => {
    if (left <= 0 || ++nodes > 2048 || depth > 12) { complete = false; return undefined; }
    if (typeof input === "string") {
      const out = input.slice(0, left); left -= out.length;
      if (out.length < input.length) complete = false;
      return out;
    }
    left -= 16;
    if (input == null || typeof input === "number" || typeof input === "boolean") return input;
    if (typeof input !== "object" || seen.has(input)) { complete = false; return undefined; }
    seen.add(input);
    if (Array.isArray(input)) {
      const output: unknown[] = [];
      for (const item of input) { if (left <= 0 || nodes > 2048) { complete = false; break; } output.push(visit(item, depth + 1)); }
      return output;
    }
    const output: RecordValue = Object.create(null);
    for (const key in input) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
      if (left <= key.length || nodes > 2048) { complete = false; break; }
      left -= key.length;
      output[key] = redact && SECRET.test(key) ? "[redacted]" : visit((input as RecordValue)[key], depth + 1);
    }
    return output;
  };
  return { value: visit(value, 0), complete, chars: maxChars - Math.max(0, left) };
}

export interface CapturedResult {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
}
export interface ResultCapture { result: CapturedResult; complete: boolean; bytes: number; revision: number }

/** Result previews only; original tool output and persistent session data are never changed. */
export class ResultCache {
  private entries = new Map<string, ResultCapture>();
  bytes = 0;
  private revision = 0;
  constructor(readonly budget = 4 * 1024 * 1024, readonly perResult = 64 * 1024) {}
  set(id: string, input: unknown): void {
    this.delete(id);
    const obj = record(input);
    const copy = snapshot({ content: obj?.content, details: obj?.details }, Math.floor(this.perResult / 2));
    const value = record(copy.value);
    const content: CapturedResult["content"] = [];
    for (const block of Array.isArray(value?.content) ? value.content : []) {
      const item = record(block);
      if (item?.type === "text" && typeof item.text === "string") content.push({ type: "text", text: item.text });
      else if (item?.type === "image") { content.push({ type: "text", text: `[Image: ${inline(item.mimeType)}; binary preview unavailable]` }); copy.complete = false; }
    }
    const entry = { result: { content, details: copy.complete ? value?.details : undefined }, complete: copy.complete, bytes: copy.chars * 2 + 256, revision: ++this.revision };
    if (entry.bytes > this.budget) return;
    while (this.bytes + entry.bytes > this.budget && this.entries.size) this.delete(this.entries.keys().next().value!);
    this.entries.set(id, entry); this.bytes += entry.bytes;
  }
  get(id: string): ResultCapture | undefined { return this.entries.get(id); }
  delete(id: string): void { const entry = this.entries.get(id); if (entry) { this.bytes -= entry.bytes; this.entries.delete(id); } }
  clear(): void { this.entries.clear(); this.bytes = 0; }
  get size(): number { return this.entries.size; }
}

export function resultText(input: unknown, limit = 65536): string {
  const blocks = record(input)?.content;
  if (!Array.isArray(blocks)) return "";
  const texts: string[] = [];
  let left = limit;
  for (const block of blocks) {
    if (left <= 0 || texts.length >= 256) break;
    const item = record(block);
    const text = item?.type === "text" ? clean(item.text, left) : item?.type === "image" ? "[Image output]" : "";
    texts.push(text); left -= text.length + 1;
  }
  return texts.join("\n");
}
