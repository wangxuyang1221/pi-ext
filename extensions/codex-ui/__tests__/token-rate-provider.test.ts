import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { processResponsesStream } from "../../../node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js";
import { TokenRate } from "../src/token-rate.js";

// Feed the installed OpenAI/Codex Responses normalizer, then drain its real event queue.
// Draining after normalization deliberately exposes mutable partial aliasing.
test("OpenAI Responses normalization feeds visible text, reasoning and tool arguments without final usage", async () => {
  const stream = createAssistantMessageEventStream();
  const output = fauxAssistantMessage([]);
  const text = "abcdefgh".repeat(10), thinking = "reasoning ".repeat(4);
  const args = JSON.stringify({ command: "echo 中文" });
  const events = [
    { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "r" } },
    { type: "response.reasoning_summary_text.delta", output_index: 0, delta: thinking.slice(0, 16) },
    { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "r", summary: [{ text: thinking }], encrypted_content: "hidden".repeat(1000) } },
    { type: "response.output_item.added", output_index: 1, item: { type: "message", id: "m" } },
    { type: "response.output_text.delta", output_index: 1, delta: text.slice(0, 24) },
    { type: "response.output_item.done", output_index: 1, item: { type: "message", id: "m", content: [{ type: "output_text", text }] } },
    { type: "response.output_item.added", output_index: 2, item: { type: "function_call", id: "f", call_id: "c", name: "bash", arguments: "" } },
    { type: "response.function_call_arguments.delta", output_index: 2, delta: args.slice(0, 10) },
    { type: "response.function_call_arguments.done", output_index: 2, arguments: args },
    { type: "response.output_item.done", output_index: 2, item: { type: "function_call", id: "f", call_id: "c", name: "bash", arguments: args } },
    { type: "response.completed", response: { status: "completed", usage: { input_tokens: 100000, output_tokens: 90000, total_tokens: 190000, output_tokens_details: { reasoning_tokens: 80000 } } } },
  ];
  async function* raw() { yield* events; }
  stream.push({ type: "start", partial: output });
  // The external provider boundary deliberately supplies the selected SDK event shapes.
  await processResponsesStream(raw() as Parameters<typeof processResponsesStream>[0], output, stream, fauxProvider().getModel());
  stream.push({ type: "done", reason: "toolUse", message: output }); stream.end(output);
  const rate = new TokenRate(() => 0);
  for await (const event of stream) {
    if (event.type === "start") rate.start(event.partial);
    else if (event.type === "done") rate.finish(event.message);
    else rate.update(event);
  }
  assert.equal(rate.label(), `≈${Math.round((text.length + thinking.length + args.length) / 8)} t/s`);
});

test("incremental sampling never reads the accumulated text or serializes args on a delta or frame", () => {
  let now = 0;
  const output = fauxAssistantMessage([]);
  output.content = [{ type: "text", get text(): string { throw new Error("Full text scan"); } }];
  const rate = new TokenRate(() => now); rate.start(output);
  for (let i = 0; i < 100000; i++) {
    now = i;
    rate.update({ type: "text_delta", contentIndex: 0, delta: "abcdefgh", partial: output });
    if (i % 32 === 0) rate.label();
  }
  assert.equal(rate.label(), "≈2000 t/s");
  now += 2000; assert.equal(rate.label(), "-- t/s");
  rate.reset();
});
