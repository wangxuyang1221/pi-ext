import assert from "node:assert/strict";
import { test } from "vitest";
import { fauxAssistantMessage, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";

import { ModelCalibration } from "../../../shared/ui/token-estimator.js";
import { TokenRate } from "../../../shared/ui/token-rate.js";

function textResponse(text = "", overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return { ...fauxAssistantMessage(text), ...overrides };
}

// Exact 10.000 tokens: 10 digits (3400) + 20 letters (4800) + 4 punctuation (1800) = 10000 milli-tokens.
const EXACT_TEN_TOKENS = "0123456789" + "abcdefghijklmnopqrst" + "++++";

test("arrival-timed slope reaches steady rate at 300ms regardless of TTFT or large initial burst", () => {
  for (const scenario of ["plain", "ttft", "initial-burst"] as const) {
    let now = scenario === "ttft" ? 5000 : 0;
    const rate = new TokenRate(() => now);
    const partial = textResponse();
    rate.start(partial);
    assert.equal(rate.label(), "-- t/s");

    // First arrival establishes baseline; huge burst does not inflate later slope.
    const firstDelta = scenario === "initial-burst" ? EXACT_TEN_TOKENS.repeat(80) : EXACT_TEN_TOKENS;
    rate.update({ type: "text_delta", contentIndex: 0, delta: firstDelta, partial });
    assert.equal(rate.label(), scenario === "initial-burst" ? "≈800 tok" : "≈10 tok");

    // 100ms and 200ms are still under 240ms span -> stay in tok warmup.
    now += 100;
    rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
    assert.match(rate.label(), /^≈[\d.]+k? tok$/u);

    now += 100;
    rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
    assert.match(rate.label(), /^≈[\d.]+k? tok$/u);

    // 300ms (4th observation point, 300ms >= 240ms) immediately transitions to exact 100 t/s.
    now += 100;
    rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
    assert.equal(rate.label(), "≈100 t/s", scenario);
  }
});

test("exact 240ms warmup threshold, 2000ms 21-slot span, silence expiry and re-baseline", () => {
  let now = 0;
  const rate = new TokenRate(() => now);
  const partial = textResponse();
  rate.start(partial);

  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  assert.equal(rate.label(), "≈10 tok");

  now = 239;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  assert.equal(rate.label(), "≈10 tok", "239ms is still under 240ms and within display throttle");

  now = 240;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  assert.equal(rate.label(), "≈83 t/s", "20 tokens / 0.24s = 83.33 -> ≈83 t/s");

  // Stream steadily to t = 2000ms; 21 slots hold both t=0 and t=2000 simultaneously.
  for (let t = 300; t <= 2000; t += 100) {
    now = t;
    rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  }
  now = 2240; // past throttle, still within 2000ms of last arrival (t=2000).
  assert.equal(rate.label(), "≈100 t/s");

  // Silence at 2000ms expires immediately to -- t/s.
  now = 4000;
  assert.equal(rate.label(), "-- t/s");

  // Next delta re-baselines rather than stretching across the silent gap.
  now = 4100;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  assert.match(rate.label(), /^≈\d+ tok$/u);

  now = 4400;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(3), partial });
  assert.equal(rate.label(), "≈100 t/s");
});

test("display throttle caps steady-state updates to 240ms while keeping state transitions immediate", () => {
  let now = 0;
  const rate = new TokenRate(() => now);
  const partial = textResponse();
  rate.start(partial);

  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  assert.equal(rate.label(), "≈10 tok");

  // Transition tok -> rate at 250ms is immediate even if within 240ms of a prior tok check.
  now = 250;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(2), partial });
  assert.equal(rate.label(), "≈80 t/s");

  // Rate changes at 350ms (100ms since last render) stay throttled at 80 t/s.
  now = 350;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(10), partial });
  assert.equal(rate.label(), "≈80 t/s");

  // At 490ms (240ms since last render at 250ms) the updated rate appears.
  now = 490;
  assert.equal(rate.label(), "≈343 t/s");

  // finish() clears immediately without waiting for throttle or 2s expiry.
  rate.finish(partial);
  assert.equal(rate.label(), "-- t/s");
});

test("simultaneous queue drain shows token count only, and tiny or huge rates stay within 10 columns", () => {
  let now = 0;
  const rate = new TokenRate(() => now);
  const partial = textResponse();
  rate.start(partial);
  for (let i = 0; i < 10; i++) {
    rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  }
  assert.equal(rate.label(), "≈100 tok");

  // Tiny <1 tok and <1 t/s.
  const tiny = new TokenRate(() => now);
  const p2 = textResponse();
  tiny.start(p2);
  tiny.update({ type: "text_delta", contentIndex: 0, delta: "a", partial: p2 });
  assert.equal(tiny.label(), "≈<1 tok");
  now = 1000;
  tiny.update({ type: "text_delta", contentIndex: 0, delta: "a", partial: p2 });
  assert.equal(tiny.label(), "≈0.2 t/s");
  assert.ok(visibleWidth(tiny.label()) <= 10);

  // Huge rates format compactly and stay <= 10 visible columns.
  for (const mult of [50, 500, 50_000, 500_000]) {
    let t = 0;
    const fast = new TokenRate(() => t);
    const p = textResponse();
    fast.start(p);
    fast.update({ type: "text_delta", contentIndex: 0, delta: "a", partial: p });
    t = 250;
    fast.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(mult), partial: p });
    const label = fast.label();
    assert.match(label, /^≈[\d.]+[kM]?\+? t\/s$/u);
    assert.ok(visibleWidth(label) <= 10, `expected <= 10 cols, got ${label}`);
  }
});

test("end reconciliation does not inject spikes, argumentsError keeps streamed count, and old responses cannot revive", () => {
  let now = 0;
  const rate = new TokenRate(() => now);
  const partial = textResponse();
  partial.content = [
    { type: "text", text: EXACT_TEN_TOKENS.repeat(100) },
    { type: "toolCall", id: "call", name: "bash", arguments: {}, argumentsError: "truncated json" },
  ];
  rate.start(partial);
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  now = 300;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(3), partial });
  assert.equal(rate.label(), "≈100 t/s");

  // text_end with much larger authoritative tail must NOT inject into rate slope.
  now = 600;
  rate.update({ type: "text_end", contentIndex: 0, content: EXACT_TEN_TOKENS.repeat(100), partial });
  assert.equal(rate.label(), "≈100 t/s");

  // Tool call with argumentsError keeps its streamed delta weight rather than resetting to {}.
  const toolOnly = new TokenRate(() => 0);
  const tp = textResponse();
  const brokenCall: ToolCall = { type: "toolCall", id: "c1", name: "bash", arguments: {}, argumentsError: "invalid" };
  tp.content = [brokenCall];
  toolOnly.start(tp);
  toolOnly.update({ type: "toolcall_delta", contentIndex: 0, delta: '{"command":"echo 中文中文中文"}', partial: tp });
  const beforeEnd = toolOnly.label();
  toolOnly.update({ type: "toolcall_end", contentIndex: 0, toolCall: brokenCall, partial: tp });
  assert.equal(toolOnly.label(), beforeEnd);

  // Old responses cannot revive after finish or reset.
  rate.finish(partial);
  assert.equal(rate.label(), "-- t/s");
  const next = textResponse();
  rate.start(next);
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(50), partial });
  rate.finish(partial);
  assert.equal(rate.label(), "-- t/s");
  rate.reset();
  rate.finish(next);
  assert.equal(rate.label(), "-- t/s");
});

test("late redaction withdraws sampled thinking tokens immediately, keeps silence expiry and blocks calibration", () => {
  let now = 0;
  const cal = new ModelCalibration();
  const rate = new TokenRate(() => now, cal, () => ({ eligible: true, modelHasReasoning: false }));
  const partial = textResponse("", {
    provider: "amazon-bedrock",
    api: "bedrock-converse-stream",
    model: "claude-test",
  });
  partial.content = [
    { type: "text", text: "" },
    { type: "thinking", thinking: "" },
  ];
  rate.start(partial);

  // Stream 10 text tokens and 30 thinking tokens within warmup -> ≈40 tok.
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  now = 50;
  rate.update({ type: "thinking_delta", contentIndex: 1, delta: EXACT_TEN_TOKENS.repeat(3), partial });
  assert.equal(rate.label(), "≈40 tok");

  // Block 1 becomes redacted mid-stream within display throttle window: immediately drops to ≈10 tok.
  partial.content[1] = { type: "thinking", thinking: "[Reasoning redacted]", redacted: true };
  now = 100;
  rate.update({ type: "thinking_delta", contentIndex: 1, delta: "[Reasoning redacted]", partial });
  assert.equal(rate.label(), "≈10 tok");

  // Remaining ≈10 tok still expires to -- t/s after 2000ms silence.
  now = 5100;
  assert.equal(rate.label(), "-- t/s");

  // Subsequent non-redacted text re-baselines cleanly.
  now = 5200;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial });
  assert.equal(rate.label(), "≈20 tok");
  now = 5500;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(3), partial });
  assert.equal(rate.label(), "≈100 t/s");

  partial.usage = { ...partial.usage, output: 150 };
  rate.finish(partial);
  assert.equal(cal.factor(partial), 1, "redacted response must not update calibration");
});

test("equal-length replacement (at text_end or after text_end) and finish model identity drift block calibration", () => {
  let now = 0;
  const cal = new ModelCalibration();
  const rate = new TokenRate(() => now, cal, () => ({ eligible: true, modelHasReasoning: false }));
  const makeMsg = (model: string, output: number) => textResponse("", {
    provider: "openai",
    api: "openai-responses",
    model,
    stopReason: "stop",
    usage: {
      input: 10,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 10 + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });

  // (a) Equal-length replacement at text_end with non-unit ratio (400 / 320 = 1.25).
  const msg = makeMsg("gpt-replace-end", 400);
  const streamed = "a".repeat(400);
  const replaced = "中".repeat(400);
  msg.content = [{ type: "text", text: replaced }];
  rate.start(msg);
  rate.update({ type: "text_delta", contentIndex: 0, delta: streamed, partial: msg });
  assert.equal(rate.label(), "≈96 tok");
  now = 300;
  rate.update({ type: "text_end", contentIndex: 0, content: replaced, partial: msg });
  assert.equal(rate.label(), "≈320 tok");
  rate.finish(msg);
  assert.equal(cal.size(), 0, "equal-length replacement at text_end must not write calibration");

  // (b) Mutation after text_end and before finish must also block calibration.
  const msg2 = makeMsg("gpt-replace-final", 140);
  msg2.content = [{ type: "text", text: streamed }];
  rate.start(msg2);
  rate.update({ type: "text_delta", contentIndex: 0, delta: streamed, partial: msg2 });
  rate.update({ type: "text_end", contentIndex: 0, content: streamed, partial: msg2 });
  msg2.content[0] = { type: "text", text: replaced };
  rate.finish(msg2);
  assert.equal(cal.size(), 0, "post-text_end mutation before finish must not write calibration");

  // (c) Removing a completed text block before finish must also block calibration.
  const msg2b = makeMsg("gpt-delete-block", 140);
  msg2b.content = [{ type: "text", text: streamed }, { type: "text", text: streamed }];
  rate.start(msg2b);
  rate.update({ type: "text_delta", contentIndex: 0, delta: streamed, partial: msg2b });
  rate.update({ type: "text_end", contentIndex: 0, content: streamed, partial: msg2b });
  rate.update({ type: "text_delta", contentIndex: 1, delta: streamed, partial: msg2b });
  rate.update({ type: "text_end", contentIndex: 1, content: streamed, partial: msg2b });
  msg2b.content.pop();
  rate.finish(msg2b);
  assert.equal(cal.size(), 0, "deleted text block before finish must not write calibration");

  // (d) Mutating model identity on shared content array before finish must not write calibration.
  const msg3 = makeMsg("gpt-start-model", 140);
  msg3.content = [{ type: "text", text: streamed }];
  rate.start(msg3);
  rate.update({ type: "text_delta", contentIndex: 0, delta: streamed, partial: msg3 });
  rate.update({ type: "text_end", contentIndex: 0, content: streamed, partial: msg3 });
  msg3.model = "gpt-other-model";
  rate.finish(msg3);
  assert.equal(cal.size(), 0, "changed model identity at finish must not write calibration");
});

test("calibration updates factor for subsequent responses without changing current response rate", () => {
  let now = 0;
  const cal = new ModelCalibration();
  const rate = new TokenRate(() => now, cal, () => ({ eligible: true, modelHasReasoning: false }));
  const makeMsg = (output: number) => textResponse("", {
    provider: "openai",
    api: "openai-responses",
    model: "gpt-cal-test",
    stopReason: "stop",
    usage: {
      input: 10,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 10 + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });

  // Response 1: 100 base tokens, provider reports 150 output -> next factor = 1.5^0.2.
  const first = makeMsg(150);
  first.content = [{ type: "text", text: EXACT_TEN_TOKENS.repeat(10) }];
  rate.start(first);
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(4), partial: first });
  now = 600;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(6), partial: first });
  assert.equal(rate.label(), "≈100 t/s");
  rate.finish(first);
  assert.equal(rate.label(), "-- t/s");
  assert.ok(Math.abs(cal.factor(first) - Math.pow(1.5, 0.2)) < 1e-12);

  // Response 2 uses frozen learned factor (~1.0845) on text deltas -> ~108 t/s.
  const second = makeMsg(150);
  second.content = [{ type: "text", text: "" }];
  now = 1000;
  rate.start(second);
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS, partial: second });
  now = 1300;
  rate.update({ type: "text_delta", contentIndex: 0, delta: EXACT_TEN_TOKENS.repeat(3), partial: second });
  assert.equal(rate.label(), "≈108 t/s");
});

test("installed faux provider (including custom provider/api names and text-only responses) samples accurately without calibration", async () => {
  const { fauxProvider, createModels } = await import("@earendil-works/pi-ai");
  const faux = fauxProvider({ provider: "custom-faux", api: "custom-api", tokenSize: { min: 4, max: 4 } });
  faux.setResponses([
    fauxAssistantMessage([
      { type: "thinking", thinking: EXACT_TEN_TOKENS.repeat(2) },
      { type: "text", text: EXACT_TEN_TOKENS.repeat(4) },
    ]),
    fauxAssistantMessage(EXACT_TEN_TOKENS.repeat(10)),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);

  let now = 0;
  const cal = new ModelCalibration();
  const rate = new TokenRate(() => now, cal, () => ({ eligible: true, modelHasReasoning: false }));
  for (let turn = 0; turn < 2; turn++) {
    const response = models.stream(faux.getModel(), { messages: [] });
    const labels: string[] = [];
    for await (const event of response) {
      if (event.type === "start") rate.start(event.partial);
      else if (event.type === "done") rate.finish(event.message);
      else {
        now += 100;
        rate.update(event);
      }
      if (event.type === "text_delta" || event.type === "thinking_delta") labels.push(rate.label());
    }
    assert.ok(labels.some(label => label.endsWith("tok")), `turn ${turn} expected warmup tok label`);
    assert.ok(labels.some(label => label.endsWith("t/s") && label !== "-- t/s"), `turn ${turn} expected rate label`);
    assert.equal(rate.label(), "-- t/s");
  }
  assert.equal(cal.size(), 0, "custom-named text-only faux provider must not update calibration");
});
