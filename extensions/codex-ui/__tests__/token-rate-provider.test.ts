import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider, type AssistantMessage } from "@earendil-works/pi-ai";
import { processResponsesStream } from "../../../node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js";
import { ModelCalibration } from "../../../shared/ui/token-estimator.js";
import { TokenRate } from "../../../shared/ui/token-rate.js";

const TEN_TOKENS = "0123456789" + "abcdefghijklmnopqrst" + "++++";

// Feed the installed OpenAI/Codex Responses normalizer, then drain its real event queue.
// Draining after normalization deliberately exposes mutable partial aliasing.
test("OpenAI Responses normalization works for both queued drain and live streaming without final usage spikes", async () => {
  const text = TEN_TOKENS.repeat(6);
  const thinking = "reasoning ".repeat(4);
  const args = JSON.stringify({ command: "echo 中文" });

  function makeEvents(outputTokens: number) {
    return [
      { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "r" } },
      { type: "response.reasoning_summary_text.delta", output_index: 0, delta: thinking.slice(0, 16) },
      { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "r", summary: [{ text: thinking }], encrypted_content: "hidden".repeat(1000) } },
      { type: "response.output_item.added", output_index: 1, item: { type: "message", id: "m" } },
      { type: "response.output_text.delta", output_index: 1, delta: text.slice(0, 34) },
      { type: "response.output_text.delta", output_index: 1, delta: text.slice(34, 68) },
      { type: "response.output_text.delta", output_index: 1, delta: text.slice(68, 102) },
      { type: "response.output_text.delta", output_index: 1, delta: text.slice(102, 136) },
      { type: "response.output_item.done", output_index: 1, item: { type: "message", id: "m", content: [{ type: "output_text", text }] } },
      { type: "response.output_item.added", output_index: 2, item: { type: "function_call", id: "f", call_id: "c", name: "bash", arguments: "" } },
      { type: "response.function_call_arguments.delta", output_index: 2, delta: args.slice(0, 10) },
      { type: "response.function_call_arguments.done", output_index: 2, arguments: args },
      { type: "response.output_item.done", output_index: 2, item: { type: "function_call", id: "f", call_id: "c", name: "bash", arguments: args } },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 100000, output_tokens: outputTokens, total_tokens: 100000 + outputTokens, output_tokens_details: { reasoning_tokens: Math.floor(outputTokens * 0.8) } } } },
    ];
  }

  // (a) Queued drain at t=0: never fabricates a rate, shows warmup tok, then clears on done.
  const drainStream = createAssistantMessageEventStream();
  const drainOutput = fauxAssistantMessage([]);
  async function* drainRaw() { yield* makeEvents(90_000); }
  drainStream.push({ type: "start", partial: drainOutput });
  await processResponsesStream(drainRaw() as Parameters<typeof processResponsesStream>[0], drainOutput, drainStream, fauxProvider().getModel());
  drainStream.push({ type: "done", reason: "toolUse", message: drainOutput });
  drainStream.end(drainOutput);

  const drainRate = new TokenRate(() => 0);
  const drainLabels: string[] = [];
  for await (const event of drainStream) {
    if (event.type === "start") drainRate.start(event.partial);
    else if (event.type === "done") drainRate.finish(event.message);
    else drainRate.update(event);
    drainLabels.push(drainRate.label());
  }
  assert.ok(drainLabels.some(l => l.endsWith("tok")), `expected tok labels during same-timestamp drain: ${JSON.stringify(drainLabels)}`);
  assert.ok(drainLabels.every(l => l === "-- t/s" || l.endsWith("tok")), "same-timestamp drain must never fabricate t/s");
  assert.equal(drainRate.label(), "-- t/s");

  // (b) Live streaming pace: inflating final usage 1000x produces identical live curve and no end spike.
  async function runLive(outputTokens: number): Promise<string[]> {
    const stream = createAssistantMessageEventStream();
    const output = fauxAssistantMessage([]);
    async function* raw() { yield* makeEvents(outputTokens); }
    stream.push({ type: "start", partial: output });
    const producer = processResponsesStream(raw() as Parameters<typeof processResponsesStream>[0], output, stream, fauxProvider().getModel())
      .then(() => { stream.push({ type: "done", reason: "toolUse", message: output }); stream.end(output); });

    let now = 0;
    const rate = new TokenRate(() => now);
    const observed: string[] = [];
    for await (const event of stream) {
      if (event.type === "start") rate.start(event.partial);
      else if (event.type === "done") rate.finish(event.message);
      else {
        if ("delta" in event) now += 100;
        rate.update(event);
      }
      observed.push(rate.label());
    }
    await producer;
    return observed;
  }

  const normalCurve = await runLive(900);
  const inflatedCurve = await runLive(900_000);
  assert.deepEqual(inflatedCurve, normalCurve);
  assert.ok(normalCurve.some(l => l.endsWith("t/s") && l !== "-- t/s"));
  assert.equal(normalCurve.at(-1), "-- t/s");
});

test("Completions, Anthropic, Google and Bedrock usage patterns never corrupt live curves", () => {
  function runProviderReplay(provider: string, api: string, mutateUsageDuringStream: (msg: AssistantMessage, step: number) => void): string[] {
    let now = 0;
    const cal = new ModelCalibration();
    const rate = new TokenRate(() => now, cal);
    const partial = fauxAssistantMessage([]);
    partial.provider = provider;
    partial.api = api;
    partial.model = "test-model";
    partial.content = [{ type: "text", text: "" }];

    rate.start(partial);
    const labels: string[] = [];
    for (let step = 0; step < 5; step++) {
      now = step * 100;
      mutateUsageDuringStream(partial, step);
      rate.update({ type: "text_delta", contentIndex: 0, delta: TEN_TOKENS, partial });
      labels.push(rate.label());
    }
    mutateUsageDuringStream(partial, 99);
    rate.finish(partial);
    labels.push(rate.label());
    return labels;
  }

  const completions = runProviderReplay("openai", "openai-completions", (msg, step) => {
    if (step === 99) msg.usage = { ...msg.usage, output: 50_000 };
  });
  const anthropic = runProviderReplay("anthropic", "anthropic-messages", (msg, step) => {
    if (step === 0) msg.usage.output = 2;
    if (step === 99) msg.usage.output = 80_000;
  });
  const google = runProviderReplay("google", "google-generative-ai", (msg, step) => {
    msg.usage = { ...msg.usage, output: (step + 1) * 1000, reasoning: (step + 1) * 900 };
  });
  const bedrock = runProviderReplay("amazon-bedrock", "bedrock-converse-stream", (msg, step) => {
    if (step === 99) msg.usage.output = 120_000;
  });

  assert.deepEqual(anthropic, completions);
  assert.deepEqual(google, completions);
  assert.deepEqual(bedrock, completions);
  assert.equal(completions[3], "≈100 t/s");
  assert.equal(completions.at(-1), "-- t/s");
});

test("incremental sampling never reads the accumulated text or serializes args on a delta or frame", () => {
  let now = 0;
  const output = fauxAssistantMessage([]);
  output.content = [{ type: "text", get text(): string { throw new Error("Full text scan"); } }];
  const rate = new TokenRate(() => now);
  rate.start(output);
  for (let i = 0; i < 100_000; i++) {
    now = i;
    rate.update({ type: "text_delta", contentIndex: 0, delta: TEN_TOKENS, partial: output });
    if (i % 32 === 0) rate.label();
  }
  now += 240;
  assert.equal(rate.label(), "≈10k t/s");
  now += 2000;
  assert.equal(rate.label(), "-- t/s");
  rate.reset();
});
