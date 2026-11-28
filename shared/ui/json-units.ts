import { ScalarTokenCounter } from "./token-estimator.js";

/** Count JSON syntax and decoded string milli-tokens without retaining the input. */
export class JsonUnits {
  private quoted = false;
  private escaped = false;
  private unicodeRemaining = 0;
  private unicodeValue = 0;
  private readonly counter = new ScalarTokenCounter();

  push(text: string): number {
    let milli = 0;
    for (let index = 0; index < text.length; index++) {
      milli += this.consume(text.charCodeAt(index));
    }
    return milli;
  }

  flush(): number {
    return this.counter.flush();
  }

  private consume(codeUnit: number): number {
    if (this.unicodeRemaining > 0) {
      const digit = hexDigit(codeUnit);
      if (digit >= 0) {
        this.unicodeValue = (this.unicodeValue << 4) | digit;
        this.unicodeRemaining--;
        return this.unicodeRemaining === 0 ? this.counter.pushCodeUnit(this.unicodeValue) : 0;
      }
      this.unicodeRemaining = 0;
      this.unicodeValue = 0;
    }
    if (this.escaped) return this.consumeEscape(codeUnit);
    if (this.quoted && codeUnit === 0x5c) {
      this.escaped = true;
      return 0;
    }
    if (codeUnit === 0x22) {
      this.quoted = !this.quoted;
      return this.counter.pushCodeUnit(0x22);
    }
    if (!this.quoted && isJsonWhitespace(codeUnit)) return 0;
    return this.counter.pushCodeUnit(codeUnit);
  }

  private consumeEscape(codeUnit: number): number {
    this.escaped = false;
    if (codeUnit === 0x75) {
      this.unicodeRemaining = 4;
      this.unicodeValue = 0;
      return 0;
    }
    return this.counter.pushCodeUnit(decodeEscape(codeUnit));
  }
}

type Frame =
  | { kind: "value"; value: unknown }
  | { kind: "array"; items: readonly unknown[]; index: number; ref: object }
  | { kind: "object"; obj: Record<string, unknown>; keys: string[]; index: number; emitted: boolean; ref: object };

/** Iteratively estimate normalized tool arguments in milli-tokens without constructing JSON.stringify output. */
export function argumentUnits(args: Record<string, unknown>): number {
  const counter = new ScalarTokenCounter();
  const stack: Frame[] = [{ kind: "value", value: unwrapJsonValue(args, "") }];
  const active = new Set<object>();
  let milli = 0;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.kind === "value") {
      stack.pop();
      milli += emitValue(frame.value, counter, stack, active);
      continue;
    }
    if (frame.kind === "array") {
      if (frame.index >= frame.items.length) {
        stack.pop();
        active.delete(frame.ref);
        milli += counter.pushCodeUnit(0x5d);
        continue;
      }
      if (frame.index > 0) milli += counter.pushCodeUnit(0x2c);
      const itemIndex = frame.index++;
      const item = unwrapJsonValue(frame.items[itemIndex], String(itemIndex));
      stack.push({ kind: "value", value: isUnserializable(item) ? null : item });
      continue;
    }
    while (frame.index < frame.keys.length) {
      const key = frame.keys[frame.index++]!;
      const value = unwrapJsonValue(frame.obj[key], key);
      if (isUnserializable(value)) continue;
      if (frame.emitted) milli += counter.pushCodeUnit(0x2c);
      frame.emitted = true;
      milli += pushQuotedString(counter, key);
      milli += counter.pushCodeUnit(0x3a);
      stack.push({ kind: "value", value });
      break;
    }
    if (stack[stack.length - 1] === frame && frame.index >= frame.keys.length) {
      stack.pop();
      active.delete(frame.ref);
      milli += counter.pushCodeUnit(0x7d);
    }
  }

  return milli + counter.flush();
}

function emitValue(
  value: unknown,
  counter: ScalarTokenCounter,
  stack: Frame[],
  active: Set<object>,
): number {
  if (value === null || isUnserializable(value)) return counter.push("null");
  if (typeof value === "boolean") return counter.push(value ? "true" : "false");
  if (typeof value === "number") return counter.push(Number.isFinite(value) ? String(value) : "null");
  if (typeof value === "string") return pushQuotedString(counter, value);
  if (typeof value === "object") {
    if (active.has(value)) return counter.push("null");
    active.add(value);
    if (Array.isArray(value)) {
      stack.push({ kind: "array", items: value, index: 0, ref: value });
      return counter.pushCodeUnit(0x5b);
    }
    const obj = value as Record<string, unknown>;
    stack.push({ kind: "object", obj, keys: Object.keys(obj), index: 0, emitted: false, ref: value });
    return counter.pushCodeUnit(0x7b);
  }
  return counter.push("null");
}

function unwrapJsonValue(value: unknown, key: string): unknown {
  if (value && typeof value === "object" && "toJSON" in value) {
    const toJson = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJson === "function") return toJson.call(value, key);
  }
  return value;
}

function isUnserializable(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

function pushQuotedString(counter: ScalarTokenCounter, text: string): number {
  return counter.pushCodeUnit(0x22) + counter.push(text) + counter.pushCodeUnit(0x22);
}

function isJsonWhitespace(codeUnit: number): boolean {
  return codeUnit === 0x20 || codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d;
}

function hexDigit(codeUnit: number): number {
  if (codeUnit >= 0x30 && codeUnit <= 0x39) return codeUnit - 0x30;
  if (codeUnit >= 0x41 && codeUnit <= 0x46) return codeUnit - 0x41 + 10;
  if (codeUnit >= 0x61 && codeUnit <= 0x66) return codeUnit - 0x61 + 10;
  return -1;
}

function decodeEscape(codeUnit: number): number {
  switch (codeUnit) {
    case 0x6e: return 0x0a;
    case 0x72: return 0x0d;
    case 0x74: return 0x09;
    case 0x62: return 0x08;
    case 0x66: return 0x0c;
    default: return codeUnit;
  }
}
