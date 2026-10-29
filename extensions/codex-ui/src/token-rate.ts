import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";

import { argumentUnits, JsonUnits } from "./json-units.js";

const BUCKET_MS = 100;
const BUCKETS = 20;
const UNITS_PER_TOKEN = 4;
type ContentEvent = Extract<AssistantMessageEvent, { contentIndex: number }>;
type Block = AssistantMessage["content"][number];
type Sample = { units: number; complete: boolean; json?: JsonUnits };

/** Track one response, retaining counters rather than copies of its shared text. */
export class TokenRate {
  private content: AssistantMessage["content"] | undefined;
  private usage: AssistantMessage["usage"] | undefined;
  private readonly seen = new WeakSet<object>();
  private blocks = new Map<number, Sample>();
  private readonly buckets = Array.from({ length: BUCKETS }, () => ({ tick: -1, units: 0 }));

  constructor(private readonly now = () => performance.now()) {}

  start(message: AssistantMessage): void {
    if (this.seen.has(message.content)) return;
    this.reset();
    this.content = message.content;
    this.usage = message.usage;
    this.seen.add(message.content);
    // A queued start's partial may already contain future deltas. Reconcile at end.
  }

  update(event: AssistantMessageEvent): void {
    if (!("contentIndex" in event) || !this.accept(event.partial)) return;
    const block = event.partial.content[event.contentIndex];
    if (!block || (block.type === "thinking" && block.redacted)) return;
    const sample = this.blocks.get(event.contentIndex) ?? { units: 0, complete: false };
    this.blocks.set(event.contentIndex, sample);
    if (!sample.complete) this.sampleEvent(sample, event);
  }

  private sampleEvent(sample: Sample, event: ContentEvent): void {
    if ("delta" in event) {
      const units = event.type === "toolcall_delta"
        ? (sample.json ??= new JsonUnits()).push(event.delta) : event.delta.length;
      sample.units += units;
      this.add(units);
    } else if (event.type === "text_end" || event.type === "thinking_end") {
      this.complete(sample, event.content.length);
    } else if (event.type === "toolcall_end") {
      this.complete(sample, argumentUnits(event.toolCall.arguments));
    }
  }

  finish(message: AssistantMessage): void {
    if (!this.accept(message)) return;
    message.content.forEach((block, index) => {
      const sample = this.blocks.get(index) ?? { units: 0, complete: false };
      if (!sample.complete) this.complete(sample, visibleLength(block));
    });
    this.content = undefined; this.usage = undefined;
    this.blocks.clear();
  }

  reset(): void {
    this.content = undefined;
    this.usage = undefined;
    this.blocks.clear();
    for (const bucket of this.buckets) { bucket.tick = -1; bucket.units = 0; }
  }

  label(): string {
    const tick = Math.floor(this.now() / BUCKET_MS);
    let units = 0;
    for (const bucket of this.buckets) if (tick - bucket.tick < BUCKETS && tick >= bucket.tick) units += bucket.units;
    if (units === 0) return "-- t/s";
    const rate = units / UNITS_PER_TOKEN / 2;
    return `≈${rate < 1 ? rate.toFixed(1) : Math.round(rate)} t/s`;
  }

  private accept(message: AssistantMessage): boolean {
    if (!this.content) return false;
    if (message.content === this.content) return true;
    // Faux creates a fresh content array per block and a separate final message,
    // retaining response-local usage. Real providers retain the content array.
    if (this.seen.has(message.content) || message.usage !== this.usage) return false;
    this.content = message.content;
    this.seen.add(message.content);
    return true;
  }

  private complete(sample: Sample, units: number): void {
    this.add(Math.max(0, units - sample.units));
    sample.complete = true;
  }

  private add(units: number): void {
    if (units <= 0) return;
    const tick = Math.floor(this.now() / BUCKET_MS);
    const bucket = this.buckets[tick % BUCKETS]!;
    if (bucket.tick !== tick) { bucket.tick = tick; bucket.units = 0; }
    bucket.units += units;
  }
}

function visibleLength(block: Block): number {
  if (block.type === "text") return block.text.length;
  if (block.type === "thinking") return block.redacted ? 0 : block.thinking.length;
  return argumentUnits(block.arguments);
}
