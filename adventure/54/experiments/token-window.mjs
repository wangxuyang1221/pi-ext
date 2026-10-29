import assert from "node:assert/strict";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";

// Technical probe only. Reuse Pi's documented coarse character heuristic, but
// aggregate fractional estimates instead of rounding every transport fragment.
class WindowProbe {
  bins = Array.from({ length: 20 }, () => ({ time: -Infinity, chars: 0 }));
  blocks = new Map();
  epoch;
  accepting = false;
  visitedCharacters = 0;
  begin(epoch) {
    this.epoch = epoch;
    this.accepting = true;
    this.blocks.clear();
    for (const bin of this.bins) { bin.time = -Infinity; bin.chars = 0; }
  }
  add(chars, now) {
    if (!chars) return;
    const tick = Math.floor(now / 100);
    const bin = this.bins[tick % this.bins.length];
    if (bin.time !== tick * 100) { bin.time = tick * 100; bin.chars = 0; }
    bin.chars += chars;
    this.visitedCharacters += chars;
  }
  consume(epoch, event, now) {
    if (epoch !== this.epoch || !this.accepting) return;
    if (event.type === "done" || event.type === "error") { this.accepting = false; return; }
    if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") {
      const block = this.blocks.get(event.contentIndex) ?? { chars: 0, closed: false };
      if (block.closed) return;
      this.add(event.delta.length, now);
      block.chars += event.delta.length;
      this.blocks.set(event.contentIndex, block);
    } else if (event.type === "text_end" || event.type === "thinking_end" || event.type === "toolcall_end") {
      const block = this.blocks.get(event.contentIndex) ?? { chars: 0, closed: false };
      if (block.closed) return;
      // A start event's partial may already contain the final arguments because
      // it is shared across queued events. Never count that mutable snapshot.
      if (!block.chars) {
        const redacted = event.type === "thinking_end" && event.partial.content[event.contentIndex]?.redacted;
        if (!redacted) this.add(event.type === "toolcall_end" ? JSON.stringify(event.toolCall.arguments).length : event.content.length, now);
      }
      block.closed = true;
      this.blocks.set(event.contentIndex, block);
    }
  }
  read(now) {
    let chars = 0;
    for (const bin of this.bins) if (now >= bin.time && now - bin.time < 2000) chars += bin.chars;
    return chars ? chars / 3.5 / 2 : undefined;
  }
}

const checks = [];
const p = new WindowProbe();
p.begin("one");
assert.equal(p.read(0), undefined);
checks.push("no data returns unavailable, not zero");

const body = "a".repeat(14);
const thought = "b".repeat(21);
const args = JSON.stringify({ value: "x".repeat(23) });
assert.equal(body.length + thought.length + args.length, 70);
const partial = {
  role: "assistant", timestamp: Date.now(), stopReason: "pending",
  content: [{ type: "text", text: body }, { type: "thinking", thinking: thought }, { type: "toolCall", id: "call", name: "tool", arguments: JSON.parse(args) }],
  usage: { input: 9999, output: 9999, reasoning: 5000, cacheRead: 9999 },
};
const stream = new AssistantMessageEventStream();
stream.push({ type: "start", partial });
for (const [index, kind, value] of [[0, "text", body], [1, "thinking", thought], [2, "toolcall", args]]) {
  stream.push({ type: `${kind}_start`, contentIndex: index, partial });
  for (const delta of value) stream.push({ type: `${kind}_delta`, contentIndex: index, delta, partial });
  stream.push(kind === "toolcall"
    ? { type: "toolcall_end", contentIndex: index, toolCall: partial.content[index], partial }
    : { type: `${kind}_end`, contentIndex: index, content: value, partial });
}
stream.push({ type: "done", reason: "stop", message: partial });
for await (const event of stream) p.consume("one", event, 1000);
assert.equal(p.read(1000), 10);
assert.equal(p.visitedCharacters, 70);
checks.push("queued shared partial cannot double-count text, thinking or tool arguments");
checks.push("final usage and reasoning totals do not replace recent visible-output rate");

assert.equal(p.read(2999), 10);
assert.equal(p.read(3000), undefined);
checks.push("two-second inactivity expires to unavailable");

p.begin("two");
p.consume("one", { type: "text_delta", contentIndex: 0, delta: "stale" }, 3100);
assert.equal(p.read(3100), undefined);
p.consume("two", { type: "toolcall_end", contentIndex: 0, toolCall: { arguments: { value: "x".repeat(23) } } }, 3100);
assert.equal(p.read(3100), 5);
p.consume("two", { type: "toolcall_end", contentIndex: 0, toolCall: { arguments: { value: "x".repeat(23) } } }, 3100);
assert.equal(p.read(3100), 5);
checks.push("new response clears the window and rejects old callbacks");
checks.push("complete tool arguments without deltas count once at completion");

p.begin("three");
p.consume("three", { type: "thinking_end", contentIndex: 0, content: "opaque", partial: { content: [{ redacted: true, thinkingSignature: "opaque-payload" }] } }, 4000);
p.consume("three", { type: "tool_result", content: "ignored" }, 4000);
assert.equal(p.read(4000), undefined);
checks.push("redacted payloads and tool results are excluded");

const q = new WindowProbe(); q.begin("bulk");
q.consume("bulk", { type: "text_delta", contentIndex: 0, delta: body + thought + args }, 1000);
assert.equal(q.read(1000), 10);
checks.push("fragmentation does not change the estimate");

for (let i = 0; i < 100000; i++) q.consume("bulk", { type: "text_delta", contentIndex: 0, delta: "a" }, i);
assert.equal(q.bins.length, 20);
assert.equal(q.blocks.size, 1);
checks.push("sample storage remains twenty buckets after 100000 updates");

console.log(JSON.stringify({ node: process.version, pi: "1.4.0", checks, fixtureRate: 10, sampleBuckets: 20, timeQuantumMs: 100, limitations: ["Controlled events through the real stream queue, not live provider integration", "Character/3.5 is a coarse estimate, not calibrated model tokenization", "No final missing-suffix reconciliation or arbitrary provider replay handling", "Lifecycle-to-extension event mapping and production resource cleanup remain to implement"] }, null, 2));
