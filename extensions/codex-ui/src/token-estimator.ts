import type { AssistantMessage } from "@earendil-works/pi-ai";

export const MILLI_TOKENS_PER_TOKEN = 1000;

const REPLACEMENT_CHAR_MILLI = 1000;
const MAX_CALIBRATED_MODELS = 16;
const MIN_CALIBRATION_BASE_MILLI = 64 * MILLI_TOKENS_PER_TOKEN;
const MIN_CALIBRATION_RATIO = 0.5;
const MAX_CALIBRATION_RATIO = 2.0;
const MIN_CALIBRATION_FACTOR = 0.67;
const MAX_CALIBRATION_FACTOR = 1.5;
const CALIBRATION_ALPHA = 0.2;

/** Return estimated token weight in integer milli-tokens for one decoded Unicode scalar. */
export function scalarMilliTokens(codePoint: number): number {
  if (codePoint < 0x80) {
    if ((codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a)) return 240;
    if (codePoint >= 0x30 && codePoint <= 0x39) return 340;
    if (codePoint === 0x20 || codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return 120;
    return 450;
  }
  if (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0x3040 && codePoint <= 0x30ff)
    || (codePoint >= 0xac00 && codePoint <= 0xd7af)
    || (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
  ) {
    return 800;
  }
  if (codePoint <= 0x7ff) return 667;
  if (codePoint <= 0xffff) return 1000;
  return 1333;
}

/** Incrementally weight UTF-16 code units with chunk-invariant surrogate pairing. */
export class ScalarTokenCounter {
  private pendingHigh = 0;

  pushCodeUnit(codeUnit: number): number {
    let milli = 0;
    if (this.pendingHigh !== 0) {
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        const codePoint = 0x10000 + ((this.pendingHigh - 0xd800) << 10) + (codeUnit - 0xdc00);
        this.pendingHigh = 0;
        return scalarMilliTokens(codePoint);
      }
      this.pendingHigh = 0;
      milli += REPLACEMENT_CHAR_MILLI;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      this.pendingHigh = codeUnit;
      return milli;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return milli + REPLACEMENT_CHAR_MILLI;
    }
    return milli + scalarMilliTokens(codeUnit);
  }

  push(text: string): number {
    let milli = 0;
    for (let index = 0; index < text.length; index++) {
      milli += this.pushCodeUnit(text.charCodeAt(index));
    }
    return milli;
  }

  flush(): number {
    if (this.pendingHigh === 0) return 0;
    this.pendingHigh = 0;
    return REPLACEMENT_CHAR_MILLI;
  }
}

/** Estimate token weight in milli-tokens for a complete string. */
export function estimateTextMilliTokens(text: string): number {
  const counter = new ScalarTokenCounter();
  return counter.push(text) + counter.flush();
}

export interface CalibrationObservation {
  message: AssistantMessage;
  baseTextMilli: number;
  hasTools: boolean;
  hasThinking: boolean;
  hasRedaction: boolean;
  hasReplacement: boolean;
  modelHasReasoning?: boolean;
}

/** Session-scoped per-model text calibration updated only from comparable text-only completions. */
export class ModelCalibration {
  private readonly factors = new Map<string, number>();

  factor(message: Pick<AssistantMessage, "provider" | "api" | "model" | "responseModel">): number {
    if (!isCalibratableIdentity(message)) return 1;
    const key = modelKey(message);
    return this.factors.get(key) ?? 1;
  }

  observe(observation: CalibrationObservation): void {
    const { message, baseTextMilli, hasTools, hasThinking, hasRedaction, hasReplacement, modelHasReasoning } = observation;
    if (message.stopReason !== "stop") return;
    if (hasTools || hasThinking || hasRedaction || hasReplacement) return;
    if (!isCalibratableIdentity(message)) return;
    if (baseTextMilli < MIN_CALIBRATION_BASE_MILLI) return;

    const output = message.usage?.output;
    if (typeof output !== "number" || !Number.isInteger(output) || output <= 0) return;

    const textTokens = verifiedTextTokens(output, message.usage.reasoning, modelHasReasoning);
    if (textTokens === undefined || textTokens <= 0) return;

    const ratio = textTokens / (baseTextMilli / MILLI_TOKENS_PER_TOKEN);
    if (!Number.isFinite(ratio) || ratio < MIN_CALIBRATION_RATIO || ratio > MAX_CALIBRATION_RATIO) return;

    const key = modelKey(message);
    const prev = this.factors.get(key) ?? 1;
    const updated = Math.exp((1 - CALIBRATION_ALPHA) * Math.log(prev) + CALIBRATION_ALPHA * Math.log(ratio));
    const clamped = Math.min(MAX_CALIBRATION_FACTOR, Math.max(MIN_CALIBRATION_FACTOR, updated));

    this.factors.delete(key);
    this.factors.set(key, clamped);
    if (this.factors.size > MAX_CALIBRATED_MODELS) {
      const oldest = this.factors.keys().next().value;
      if (oldest !== undefined) this.factors.delete(oldest);
    }
  }

  size(): number {
    return this.factors.size;
  }
}

function isCalibratableIdentity(
  message: Pick<AssistantMessage, "provider" | "api" | "model" | "responseModel">,
): boolean {
  if (!message.provider || !message.api || !message.model) return false;
  if (message.provider === "faux" || message.api.startsWith("faux")) return false;
  if (message.provider === "pi-virtual" || message.api === "pi-virtual") return false;
  if (message.responseModel && message.responseModel !== message.model) return false;
  return true;
}

function modelKey(message: Pick<AssistantMessage, "provider" | "api" | "model">): string {
  return `${message.provider}\0${message.api}\0${message.model}`;
}

function verifiedTextTokens(
  output: number,
  reasoning: number | undefined,
  modelHasReasoning: boolean | undefined,
): number | undefined {
  if (reasoning !== undefined) {
    if (typeof reasoning !== "number" || !Number.isInteger(reasoning) || reasoning < 0 || reasoning >= output) {
      return undefined;
    }
    if (reasoning > 0) return output - reasoning;
  }
  return modelHasReasoning === false ? output : undefined;
}
