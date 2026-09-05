// This module is copied into each experimental variant; it is not production code.
// Budgets charge UTF-16 text payload plus conservative per-entry overhead, not V8 heap size.
import { wrapTextWithAnsi } from '@earendil-works/pi-tui';

const ids = new WeakMap();
let nextId = 0;
export function id(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return String(value);
  if (!ids.has(value)) ids.set(value, ++nextId);
  return ids.get(value);
}

export class BudgetCache {
  constructor(limit) {
    this.limit = limit;
    this.bytes = 0;
    this.entries = new Map();
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key, value, bytes) {
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.entries.delete(key);
    bytes += key.length * 2 + 128;
    if (bytes > this.limit) return value;
    while (this.bytes + bytes > this.limit && this.entries.size) {
      const oldestKey = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldestKey).bytes;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    return value;
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}

const layouts = new BudgetCache(16 * 1024 * 1024);
const counts = new BudgetCache(2 * 1024 * 1024);

function textSize(value) {
  if (typeof value === 'string') return value.length * 2;
  if (Array.isArray(value)) return value.reduce((sum, text) => sum + text.length * 2 + 32, 0);
  return textSize(value.lines);
}

export function memoLines(key, compute) {
  const cached = layouts.get(key);
  if (cached !== undefined) return cached;
  const value = compute();
  return layouts.set(key, value, textSize(value));
}

export function countVisualLines(lines, width) {
  let total = 0;
  for (const line of lines) {
    const key = `${width}\0${line}`;
    let count = counts.get(key);
    if (count === undefined) {
      // Use the upstream wrapper for exact Unicode, word-boundary, and tab semantics.
      count = wrapTextWithAnsi(line.replace(/\t/gu, '   '), width).length;
      counts.set(key, count, 8);
    }
    total += count;
  }
  return total;
}

export function resetCaches() {
  layouts.clear(); counts.clear();
}

export function cacheStats() {
  return Object.fromEntries(Object.entries({ layouts, counts }).map(([name, cache]) => [name, {
    chargedBytes: cache.bytes, limitBytes: cache.limit, entries: cache.entries.size,
  }]));
}
