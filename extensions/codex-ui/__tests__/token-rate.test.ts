import assert from "node:assert/strict";
import { test } from "vitest";
import { fauxAssistantMessage, type AssistantMessage } from "@earendil-works/pi-ai";
import { TokenRate } from "../src/token-rate.js";

function textResponse(text = ""): AssistantMessage { return fauxAssistantMessage(text); }

test("counts received text with a fixed two-second denominator and expires without a zero", () => {
  let now = 0;
  const rate = new TokenRate(() => now);
  const partial = textResponse();
  rate.start(partial);
  assert.equal(rate.label(), "-- t/s");
  rate.update({ type: "text_delta", contentIndex: 0, delta: "abcdefgh", partial });
  assert.equal(rate.label(), "≈1 t/s");
  now = 1900;
  assert.equal(rate.label(), "≈1 t/s");
  now = 2000;
  assert.equal(rate.label(), "-- t/s");
});

test("shared partial start, deltas, end and final count the visible content exactly once", () => {
  const rate = new TokenRate(() => 0);
  const partial = textResponse("abcdefgh".repeat(10));
  rate.start({ ...partial });
  rate.update({ type: "text_start", contentIndex: 0, partial });
  for (let i = 0; i < 8; i++) rate.update({ type: "text_delta", contentIndex: 0, delta: "abcdefgh", partial });
  rate.update({ type: "text_end", contentIndex: 0, content: "abcdefgh".repeat(10), partial });
  rate.finish(partial);
  rate.finish(partial);
  assert.equal(rate.label(), "≈10 t/s");
});

test("complete responses without deltas are sampled once and old response callbacks cannot revive", () => {
  const rate = new TokenRate(() => 0);
  const old = textResponse("abcdefgh".repeat(10));
  rate.start(old); rate.finish(old);
  assert.equal(rate.label(), "≈10 t/s");
  const next = textResponse("abcdefgh".repeat(2));
  rate.start(next);
  rate.update({ type: "text_delta", contentIndex: 0, delta: "x".repeat(800), partial: old });
  rate.finish(old);
  assert.equal(rate.label(), "-- t/s");
  rate.finish(next);
  assert.equal(rate.label(), "≈2 t/s");
  rate.reset(); rate.finish(next);
  assert.equal(rate.label(), "-- t/s");
});

test("counts visible thinking but excludes redacted text and signatures", () => {
  const rate = new TokenRate(() => 0);
  const partial = textResponse();
  partial.content = [
    { type: "thinking", thinking: "abcdefgh".repeat(2), thinkingSignature: "x".repeat(800) },
    { type: "thinking", thinking: "[Reasoning redacted]", thinkingSignature: "x".repeat(800), redacted: true },
  ];
  rate.start(partial);
  rate.update({ type: "thinking_delta", contentIndex: 0, delta: "abcdefgh", partial });
  rate.update({ type: "thinking_delta", contentIndex: 1, delta: "x".repeat(800), partial });
  rate.finish(partial);
  assert.equal(rate.label(), "≈2 t/s");
});

test("tool argument escaping, whitespace and fragmentation never add a second serialized result", () => {
  const args = { text: "\n/中文abcdefghabcdefgh", flag: true };
  const raw = ' { "text" : "\\n\\/\\u4e2d\\u6587abcdefghabcdefgh", "flag" : true } ';
  const labels: string[] = [];
  for (const fragments of [[raw], [...raw], [raw.slice(0, 19), raw.slice(19)]]) {
    const rate = new TokenRate(() => 0);
    const partial = textResponse();
    partial.content = [{ type: "toolCall", id: "call", name: "tool", arguments: args }];
    rate.start(partial);
    rate.update({ type: "toolcall_start", contentIndex: 0, partial });
    for (const delta of fragments) rate.update({ type: "toolcall_delta", contentIndex: 0, delta, partial });
    labels.push(rate.label());
    rate.update({ type: "toolcall_end", contentIndex: 0, toolCall: partial.content[0] as import("@earendil-works/pi-ai").ToolCall, partial });
    assert.equal(rate.label(), labels.at(-1));
    rate.finish(partial);
    assert.equal(rate.label(), labels.at(-1));
  }
  const complete = new TokenRate(() => 0);
  const message = textResponse(); message.content = [{ type: "toolCall", id: "call", name: "tool", arguments: args }];
  complete.start(message); complete.finish(message);
  assert.deepEqual(labels, Array(3).fill(complete.label()));
});

test("tool arguments missing their final tail are completed exactly once", () => {
  const partial = textResponse();
  partial.content = [{ type: "toolCall", id: "call", name: "tool", arguments: { text: "abcdefgh".repeat(10) } }];
  const complete = new TokenRate(() => 0); complete.start(partial); complete.finish(partial);
  const rate = new TokenRate(() => 0); rate.start(partial);
  rate.update({ type: "toolcall_delta", contentIndex: 0, delta: '{ "text" : "abcdefgh', partial });
  rate.update({ type: "toolcall_end", contentIndex: 0, toolCall: partial.content[0] as import("@earendil-works/pi-ai").ToolCall, partial });
  rate.finish(partial);
  assert.equal(rate.label(), complete.label());
});

test("old and duplicate ends cannot reset the receive window and tiny output is positive", () => {
  let now = 0; const rate = new TokenRate(() => now);
  const partial = textResponse("a"); rate.start(partial); rate.finish(partial);
  assert.equal(rate.label(), "≈0.1 t/s");
  now = 3000; rate.finish(partial);
  assert.equal(rate.label(), "-- t/s");
});

test("the installed faux provider replaces arrays and final blocks without losing or duplicating samples", async () => {
  const { fauxProvider, createModels } = await import("@earendil-works/pi-ai");
  const faux = fauxProvider({ tokenSize: { min: 2, max: 2 } });
  faux.setResponses([fauxAssistantMessage([
    { type: "thinking", thinking: "abcdefgh".repeat(4) },
    { type: "text", text: "abcdefgh".repeat(6) },
  ])]);
  const models = createModels(); models.setProvider(faux.provider);
  const rate = new TokenRate(() => 0);
  const response = models.stream(faux.getModel(), { messages: [] });
  const observed: string[] = [];
  for await (const event of response) {
    if (event.type === "start") rate.start(event.partial);
    else if (event.type === "done") rate.finish(event.message);
    else rate.update(event);
    if (event.type === "text_delta" || event.type === "thinking_delta") observed.push(rate.label());
  }
  assert.equal(observed[0], "≈1 t/s");
  assert.equal(observed.at(-1), "≈10 t/s");
  assert.equal(rate.label(), "≈10 t/s");
});

test("a new array within one response is accepted immediately and redacted-only output stays absent", () => {
  const rate = new TokenRate(() => 0);
  const first = textResponse(); rate.start(first);
  const next = { ...first, content: [{ type: "text" as const, text: "a" }] };
  rate.update({ type: "text_delta", contentIndex: 0, delta: "a", partial: next });
  assert.equal(rate.label(), "≈0.1 t/s");
  const redacted = textResponse();
  redacted.content = [{ type: "thinking", thinking: "secret", redacted: true }];
  rate.start(redacted); rate.finish(redacted);
  assert.equal(rate.label(), "-- t/s");
});
