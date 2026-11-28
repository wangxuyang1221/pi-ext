import assert from "node:assert/strict";
import { test } from "vitest";
import { fauxAssistantMessage, type AssistantMessage } from "@earendil-works/pi-ai";

import {
  estimateTextMilliTokens,
  MILLI_TOKENS_PER_TOKEN,
  ModelCalibration,
  scalarMilliTokens,
  ScalarTokenCounter,
} from "../../../shared/ui/token-estimator.js";

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    ...fauxAssistantMessage("text"),
    provider: "openai",
    api: "openai-responses",
    model: "gpt-4.1",
    stopReason: "stop",
    usage: {
      input: 100,
      output: 150,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 250,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    ...overrides,
  };
}

test("scalarMilliTokens classifies ASCII, CJK and multibyte Unicode consistently", () => {
  assert.equal(scalarMilliTokens("a".codePointAt(0)!), 240);
  assert.equal(scalarMilliTokens("Z".codePointAt(0)!), 240);
  assert.equal(scalarMilliTokens("7".codePointAt(0)!), 340);
  assert.equal(scalarMilliTokens(" ".codePointAt(0)!), 120);
  assert.equal(scalarMilliTokens("\n".codePointAt(0)!), 120);
  assert.equal(scalarMilliTokens("{".codePointAt(0)!), 450);
  assert.equal(scalarMilliTokens("中".codePointAt(0)!), 800);
  assert.equal(scalarMilliTokens("あ".codePointAt(0)!), 800);
  assert.equal(scalarMilliTokens("한".codePointAt(0)!), 800);
  assert.equal(scalarMilliTokens("é".codePointAt(0)!), 667);
  assert.equal(scalarMilliTokens("，".codePointAt(0)!), 1000);
  assert.equal(scalarMilliTokens("😀".codePointAt(0)!), 1333);
  assert.equal(scalarMilliTokens(0x20000), 800);
});

test("ScalarTokenCounter produces bit-identical results across arbitrary chunk splits and surrogates", () => {
  const cases = [
    "The client received the next chunk and updated the current rate.",
    "客户端收到下一个片段后，更新当前的输出速率。",
    "const rate = tokens / Math.max(0.25, elapsedMs / 1000);",
    "OK 👍🏽，继续。😀\uD83D",
    "\uD83Dx\uDE00\uD83D\uDE00",
  ];
  for (const input of cases) {
    const expected = estimateTextMilliTokens(input);
    for (let size = 1; size <= input.length; size++) {
      const counter = new ScalarTokenCounter();
      let total = 0;
      for (let i = 0; i < input.length; i += size) {
        total += counter.push(input.slice(i, i + size));
      }
      total += counter.flush();
      assert.equal(total, expected, `chunk size ${size} for ${JSON.stringify(input)}`);
    }
  }
});

test("ModelCalibration learns geometrically from verified text-only completions and rejects polluted samples", () => {
  const cal = new ModelCalibration();
  const baseMessage = assistantMessage({ usage: { ...assistantMessage().usage, output: 150 } });
  const baseTextMilli = 100 * MILLI_TOKENS_PER_TOKEN;

  // Non-reasoning model with Y/E = 1.5 -> k = 1.5^0.2.
  cal.observe({
    message: baseMessage,
    baseTextMilli,
    hasTools: false,
    hasThinking: false,
    hasRedaction: false,
    hasReplacement: false,
    modelHasReasoning: false,
  });
  const expected = Math.pow(1.5, 0.2);
  assert.ok(Math.abs(cal.factor(baseMessage) - expected) < 1e-12);

  // Reasoning model with explicit positive reasoning split uses output - reasoning.
  const reasoningModel = assistantMessage({
    model: "o-reason",
    usage: { ...assistantMessage().usage, output: 350, reasoning: 200 },
  });
  cal.observe({
    message: reasoningModel,
    baseTextMilli,
    hasTools: false,
    hasThinking: false,
    hasRedaction: false,
    hasReplacement: false,
    modelHasReasoning: true,
  });
  assert.ok(Math.abs(cal.factor(reasoningModel) - expected) < 1e-12);

  // Reasoning model reporting reasoning: 0 or undefined must NOT update.
  const ambiguous = assistantMessage({
    model: "o-ambiguous",
    usage: { ...assistantMessage().usage, output: 150, reasoning: 0 },
  });
  cal.observe({
    message: ambiguous,
    baseTextMilli,
    hasTools: false,
    hasThinking: false,
    hasRedaction: false,
    hasReplacement: false,
    modelHasReasoning: true,
  });
  assert.equal(cal.factor(ambiguous), 1);

  // Unknown reasoning capability with undefined reasoning must NOT update.
  const unknownCap = assistantMessage({ model: "unknown-cap" });
  cal.observe({
    message: unknownCap,
    baseTextMilli,
    hasTools: false,
    hasThinking: false,
    hasRedaction: false,
    hasReplacement: false,
    modelHasReasoning: undefined,
  });
  assert.equal(cal.factor(unknownCap), 1);

  // Tools, thinking, redaction, replacement, non-stop, small base, extreme ratio, faux, responseModel mismatch skip.
  const rejects: Array<Parameters<ModelCalibration["observe"]>[0]> = [
    { message: assistantMessage({ model: "m-tools" }), baseTextMilli, hasTools: true, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-think" }), baseTextMilli, hasTools: false, hasThinking: true, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-redact" }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: true, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-replace" }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: true, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-err", stopReason: "error" }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-small" }), baseTextMilli: 63_999, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-extreme", usage: { ...assistantMessage().usage, output: 250 } }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ provider: "faux", model: "m-faux" }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ provider: "pi-virtual", model: "m-virt" }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-mismatch", responseModel: "other-model" }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-frac-reason", usage: { ...assistantMessage().usage, output: 150, reasoning: 2.5 } }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-neg-reason", usage: { ...assistantMessage().usage, output: 150, reasoning: -1 } }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
    { message: assistantMessage({ model: "m-eq-reason", usage: { ...assistantMessage().usage, output: 150, reasoning: 150 } }), baseTextMilli, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false },
  ];
  for (const obs of rejects) {
    cal.observe(obs);
    assert.equal(cal.factor(obs.message), 1, `expected reject for ${obs.message.model}`);
  }
});

test("ModelCalibration clamps factors to [0.67, 1.5] and evicts beyond 16 models", () => {
  const cal = new ModelCalibration();
  const hi = assistantMessage({ model: "clamp-hi", usage: { ...assistantMessage().usage, output: 200 } });
  const lo = assistantMessage({ model: "clamp-lo", usage: { ...assistantMessage().usage, output: 50 } });
  for (let i = 0; i < 30; i++) {
    cal.observe({ message: hi, baseTextMilli: 100_000, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false });
    cal.observe({ message: lo, baseTextMilli: 100_000, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false });
  }
  assert.equal(cal.factor(hi), 1.5);
  assert.equal(cal.factor(lo), 0.67);

  for (let i = 0; i < 20; i++) {
    const msg = assistantMessage({ model: `lru-${i}`, usage: { ...assistantMessage().usage, output: 150 } });
    cal.observe({ message: msg, baseTextMilli: 100_000, hasTools: false, hasThinking: false, hasRedaction: false, hasReplacement: false, modelHasReasoning: false });
  }
  assert.equal(cal.size(), 16);
  assert.equal(cal.factor(hi), 1);
  assert.equal(cal.factor(assistantMessage({ model: "lru-19" })), Math.pow(1.5, 0.2));
});
