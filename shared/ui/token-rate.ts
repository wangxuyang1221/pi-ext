import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";

import { argumentUnits, JsonUnits } from "./json-units.js";
import {
  estimateTextMilliTokens,
  MILLI_TOKENS_PER_TOKEN,
  ModelCalibration,
  ScalarTokenCounter,
} from "./token-estimator.js";

const BUCKET_MS = 100;
const WINDOW_MS = 2000;
const SLOTS = WINDOW_MS / BUCKET_MS + 1;
const MIN_RATE_SPAN_MS = 240;
const DISPLAY_THROTTLE_MS = 240;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

type ContentEvent = Extract<AssistantMessageEvent, { contentIndex: number }>;
type Block = AssistantMessage["content"][number];
type DisplayKind = "idle" | "tok" | "rate";

type Sample = {
  kind: Block["type"];
  baseMilli: number;
  scaledMilli: number;
  utf16Length: number;
  utf16Hash: number;
  finalLength: number;
  finalHash: number;
  streamedCount: number;
  complete: boolean;
  redacted: boolean;
  textCounter?: ScalarTokenCounter;
  json?: JsonUnits;
};

type ObservationSlot = {
  tick: number;
  time: number;
  cumulativeMilli: number;
};

export type ModelCalibrationPolicy = {
  eligible: boolean;
  modelHasReasoning?: boolean;
};

export type ModelCalibrationResolver = (message: AssistantMessage) => ModelCalibrationPolicy;

/** Track one response using arrival-timed cumulative slope and bounded per-block counters. */
export class TokenRate {
  private content: AssistantMessage["content"] | undefined;
  private usage: AssistantMessage["usage"] | undefined;
  private readonly seen = new WeakSet<object>();
  private blocks = new Map<number, Sample>();
  private readonly slots: ObservationSlot[] = Array.from(
    { length: SLOTS },
    () => ({ tick: -1, time: 0, cumulativeMilli: 0 }),
  );
  private factor = 1;
  private startIdentity: { provider: string; api: string; model: string } | undefined;
  private calibrationPolicy: ModelCalibrationPolicy = { eligible: true };
  private usedContentArrayFallback = false;
  private cumulativeDeltaMilli = 0;
  private visibleMilli = 0;
  private lastArrivalAt = -1;
  private latestTick = -1;
  private hasTools = false;
  private hasThinking = false;
  private hasRedaction = false;
  private hasReplacement = false;
  private displayedKind: DisplayKind = "idle";
  private displayedLabel = "-- t/s";
  private displayedAt = -Infinity;

  constructor(
    private readonly now = () => performance.now(),
    private readonly calibration?: ModelCalibration,
    private readonly resolveCalibration?: ModelCalibrationResolver,
  ) {}

  start(message: AssistantMessage): void {
    if (this.seen.has(message.content)) return;
    this.reset();
    this.content = message.content;
    this.usage = message.usage;
    this.seen.add(message.content);
    this.startIdentity = { provider: message.provider, api: message.api, model: message.model };
    this.calibrationPolicy = this.resolveCalibration?.(message) ?? { eligible: true };
    this.factor = this.calibrationPolicy.eligible ? (this.calibration?.factor(message) ?? 1) : 1;
    // A queued start's partial may already contain future deltas. Reconcile at end.
  }

  update(event: AssistantMessageEvent): void {
    if (!("contentIndex" in event) || !this.accept(event.partial)) return;
    const block = event.partial.content[event.contentIndex];
    if (!block) return;
    if (block.type === "thinking" && block.redacted) {
      this.handleRedactedBlock(event.contentIndex);
      return;
    }
    if (block.type === "toolCall") this.hasTools = true;
    else if (block.type === "thinking") this.hasThinking = true;

    const sample = this.blocks.get(event.contentIndex) ?? createSample(block.type);
    this.blocks.set(event.contentIndex, sample);
    if (!sample.complete) this.sampleEvent(sample, event);
  }

  finish(message: AssistantMessage): void {
    if (!this.accept(message)) return;
    message.content.forEach((block, index) => {
      if (block.type === "thinking" && block.redacted) {
        this.handleRedactedBlock(index);
        return;
      }
      if (block.type === "toolCall") this.hasTools = true;
      else if (block.type === "thinking") this.hasThinking = true;

      const sample = this.blocks.get(index) ?? createSample(block.type);
      this.blocks.set(index, sample);
      if (!sample.complete) {
        this.reconcileFinalBlock(sample, block);
      } else if (
        block.type === "text"
        && sample.kind === "text"
        && (block.text.length !== sample.finalLength
          || updateFnv1a(FNV_OFFSET_BASIS, block.text, block.text.length) !== sample.finalHash)
      ) {
        this.hasReplacement = true;
      }
    });

    const identityMatches = this.startIdentity !== undefined
      && message.provider === this.startIdentity.provider
      && message.api === this.startIdentity.api
      && message.model === this.startIdentity.model;

    if (this.calibration && this.calibrationPolicy.eligible && !this.usedContentArrayFallback && identityMatches) {
      let baseTextMilli = 0;
      for (const [index, sample] of this.blocks) {
        if (sample.kind !== "text" || sample.redacted) continue;
        const finalBlock = message.content[index];
        if (!finalBlock || finalBlock.type !== "text") {
          this.hasReplacement = true;
          break;
        }
        baseTextMilli += sample.baseMilli;
      }
      this.calibration.observe({
        message,
        baseTextMilli,
        hasTools: this.hasTools,
        hasThinking: this.hasThinking,
        hasRedaction: this.hasRedaction,
        hasReplacement: this.hasReplacement,
        modelHasReasoning: this.calibrationPolicy.modelHasReasoning,
      });
    }

    this.reset();
  }

  reset(): void {
    this.content = undefined;
    this.usage = undefined;
    this.blocks.clear();
    this.clearSlots();
    this.factor = 1;
    this.startIdentity = undefined;
    this.calibrationPolicy = { eligible: true };
    this.usedContentArrayFallback = false;
    this.cumulativeDeltaMilli = 0;
    this.visibleMilli = 0;
    this.lastArrivalAt = -1;
    this.hasTools = false;
    this.hasThinking = false;
    this.hasRedaction = false;
    this.hasReplacement = false;
    this.displayedKind = "idle";
    this.displayedLabel = "-- t/s";
    this.displayedAt = -Infinity;
  }

  label(): string {
    const now = this.now();
    const desired = this.computeDesiredLabel(now);
    if (
      desired.kind !== this.displayedKind
      || desired.kind === "idle"
      || now < this.displayedAt
      || now - this.displayedAt >= DISPLAY_THROTTLE_MS
    ) {
      this.displayedKind = desired.kind;
      this.displayedLabel = desired.text;
      this.displayedAt = now;
    }
    return this.displayedLabel;
  }

  private computeDesiredLabel(now: number): { kind: DisplayKind; text: string } {
    if (!this.content) return { kind: "idle", text: "-- t/s" };
    if (this.lastArrivalAt >= 0 && now - this.lastArrivalAt >= WINDOW_MS) {
      return { kind: "idle", text: "-- t/s" };
    }
    const rate = this.computeRate();
    if (rate !== undefined && rate > 0) {
      return { kind: "rate", text: formatRate(rate) };
    }
    if (this.visibleMilli > 0) {
      return { kind: "tok", text: formatTokens(this.visibleMilli) };
    }
    return { kind: "idle", text: "-- t/s" };
  }

  private computeRate(): number | undefined {
    if (this.latestTick < 0 || this.lastArrivalAt < 0) return undefined;
    let earliest: ObservationSlot | undefined;
    for (const slot of this.slots) {
      if (slot.tick < 0 || slot.tick >= this.latestTick) continue;
      if (slot.time > this.lastArrivalAt) continue;
      if (this.lastArrivalAt - slot.time > WINDOW_MS) continue;
      if (!earliest || slot.time < earliest.time) earliest = slot;
    }
    if (!earliest) return undefined;
    const spanMs = this.lastArrivalAt - earliest.time;
    if (spanMs < MIN_RATE_SPAN_MS) return undefined;
    const deltaMilli = this.cumulativeDeltaMilli - earliest.cumulativeMilli;
    if (deltaMilli <= 0) return undefined;
    // milli-tokens / ms equals tokens / s directly.
    return deltaMilli / spanMs;
  }

  private sampleEvent(sample: Sample, event: ContentEvent): void {
    if ("delta" in event) {
      if (event.delta.length === 0) return;
      const baseDelta = event.type === "toolcall_delta"
        ? (sample.json ??= new JsonUnits()).push(event.delta)
        : (sample.textCounter ??= new ScalarTokenCounter()).push(event.delta);
      if (sample.kind === "text") {
        sample.utf16Hash = updateFnv1a(sample.utf16Hash, event.delta, event.delta.length);
      }
      sample.utf16Length += event.delta.length;
      sample.streamedCount++;
      const scaledDelta = this.advanceSampleBase(sample, baseDelta);
      if (scaledDelta > 0) this.recordArrival(scaledDelta);
    } else if (event.type === "text_end" || event.type === "thinking_end") {
      this.completeText(sample, event.content);
    } else if (event.type === "toolcall_end") {
      this.completeToolCall(sample, event.toolCall.arguments, event.toolCall.argumentsError);
    }
  }

  private reconcileFinalBlock(sample: Sample, block: Block): void {
    if (block.type === "text") {
      this.completeText(sample, block.text);
    } else if (block.type === "thinking") {
      this.completeText(sample, block.thinking);
    } else {
      this.completeToolCall(sample, block.arguments, block.argumentsError);
    }
  }

  private completeText(sample: Sample, content: string): void {
    const flushed = sample.textCounter?.flush() ?? 0;
    if (flushed > 0) this.advanceSampleBase(sample, flushed);
    const contentHash = sample.kind === "text" ? updateFnv1a(FNV_OFFSET_BASIS, content, content.length) : 0;
    sample.finalLength = content.length;
    sample.finalHash = contentHash;
    if (sample.streamedCount > 0 && sample.utf16Length === content.length) {
      if (sample.kind === "text" && contentHash !== sample.utf16Hash) {
        this.hasReplacement = true;
        this.setSampleAuthoritativeBase(sample, estimateTextMilliTokens(content));
      }
      sample.complete = true;
      return;
    }
    if (sample.streamedCount > 0) {
      if (
        content.length < sample.utf16Length
        || (sample.kind === "text" && updateFnv1a(FNV_OFFSET_BASIS, content, sample.utf16Length) !== sample.utf16Hash)
      ) {
        this.hasReplacement = true;
      }
    }
    this.setSampleAuthoritativeBase(sample, estimateTextMilliTokens(content));
    sample.complete = true;
  }

  private completeToolCall(
    sample: Sample,
    args: Record<string, unknown>,
    argumentsError: string | undefined,
  ): void {
    const flushed = sample.json?.flush() ?? 0;
    if (flushed > 0) this.advanceSampleBase(sample, flushed);
    if (argumentsError) {
      sample.complete = true;
      return;
    }
    this.setSampleAuthoritativeBase(sample, argumentUnits(args));
    sample.complete = true;
  }

  private handleRedactedBlock(contentIndex: number): void {
    this.hasRedaction = true;
    const sample = this.blocks.get(contentIndex);
    if (!sample || sample.redacted) return;
    sample.redacted = true;
    sample.complete = true;
    if (sample.scaledMilli > 0) {
      this.visibleMilli = Math.max(0, this.visibleMilli - sample.scaledMilli);
      sample.baseMilli = 0;
      sample.scaledMilli = 0;
      // Reset the rate slope while keeping lastArrivalAt so remaining warmup tokens still expire on silence.
      this.clearSlots();
      this.displayedAt = -Infinity;
    }
  }

  private advanceSampleBase(sample: Sample, baseDelta: number): number {
    if (baseDelta === 0) return 0;
    sample.baseMilli += baseDelta;
    const nextScaled = this.scaleTotal(sample.kind, sample.baseMilli);
    const scaledDelta = nextScaled - sample.scaledMilli;
    sample.scaledMilli = nextScaled;
    this.visibleMilli = Math.max(0, this.visibleMilli + scaledDelta);
    return scaledDelta;
  }

  private setSampleAuthoritativeBase(sample: Sample, authoritativeBase: number): void {
    sample.baseMilli = authoritativeBase;
    const nextScaled = this.scaleTotal(sample.kind, authoritativeBase);
    const diff = nextScaled - sample.scaledMilli;
    sample.scaledMilli = nextScaled;
    this.visibleMilli = Math.max(0, this.visibleMilli + diff);
  }

  private scaleTotal(kind: Block["type"], baseMilli: number): number {
    return kind === "text" ? Math.round(baseMilli * this.factor) : baseMilli;
  }

  private recordArrival(scaledMilli: number): void {
    const now = this.now();
    if (this.lastArrivalAt >= 0 && now - this.lastArrivalAt >= WINDOW_MS) {
      this.clearSlots();
    }
    this.cumulativeDeltaMilli += scaledMilli;
    this.lastArrivalAt = now;
    const tick = Math.floor(now / BUCKET_MS);
    this.latestTick = tick;
    const slotIndex = ((tick % SLOTS) + SLOTS) % SLOTS;
    const slot = this.slots[slotIndex]!;
    slot.tick = tick;
    slot.time = now;
    slot.cumulativeMilli = this.cumulativeDeltaMilli;
  }

  private clearSlots(): void {
    this.latestTick = -1;
    for (const slot of this.slots) {
      slot.tick = -1;
      slot.time = 0;
      slot.cumulativeMilli = 0;
    }
  }

  private accept(message: AssistantMessage): boolean {
    if (!this.content) return false;
    if (message.content === this.content) return true;
    // Faux creates a fresh content array per block and a separate final message,
    // retaining response-local usage. Real providers retain the content array.
    if (this.seen.has(message.content) || message.usage !== this.usage) return false;
    this.content = message.content;
    this.seen.add(message.content);
    this.usedContentArrayFallback = true;
    return true;
  }
}

function createSample(kind: Block["type"]): Sample {
  return {
    kind,
    baseMilli: 0,
    scaledMilli: 0,
    utf16Length: 0,
    utf16Hash: FNV_OFFSET_BASIS,
    finalLength: 0,
    finalHash: FNV_OFFSET_BASIS,
    streamedCount: 0,
    complete: false,
    redacted: false,
  };
}

function updateFnv1a(hash: number, text: string, length: number): number {
  let next = hash;
  for (let index = 0; index < length; index++) {
    next ^= text.charCodeAt(index);
    next = Math.imul(next, FNV_PRIME) >>> 0;
  }
  return next;
}

function formatRate(rate: number): string {
  if (rate < 1) {
    const rounded = Math.max(0.1, Math.round(rate * 10) / 10);
    if (rounded < 1) return `≈${rounded.toFixed(1)} t/s`;
    return "≈1 t/s";
  }
  return `≈${compactCount(rate)} t/s`;
}

function formatTokens(milli: number): string {
  const tokens = milli / MILLI_TOKENS_PER_TOKEN;
  if (tokens < 1) return "≈<1 tok";
  return `≈${compactCount(tokens)} tok`;
}

function compactCount(value: number): string {
  const rounded = Math.round(value);
  if (rounded < 1000) return String(rounded);
  if (value < 10_000) {
    const k = Math.round(value / 100) / 10;
    return k >= 10 ? "10k" : `${k.toFixed(1)}k`;
  }
  const thousands = Math.round(value / 1000);
  if (thousands < 1000) return `${thousands}k`;
  if (value < 10_000_000) {
    const m = Math.round(value / 100_000) / 10;
    return m >= 10 ? "10M" : `${m.toFixed(1)}M`;
  }
  const millions = Math.round(value / 1_000_000);
  if (millions < 1000) return `${millions}M`;
  return "999M+";
}
