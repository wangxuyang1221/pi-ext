import { expect, test } from "vitest";
import * as response from "../../../scripts/codex-compact-quality-response.mjs";

const usage = { input_tokens: 100, output_tokens: 10, total_tokens: 110 };
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const done = (output: unknown[]) => event({ type: "response.completed", response: { status: "completed", usage, output } });
const message = { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "finished" }] };

test("reads actual empty-completion output with item-done fallback and cache-inclusive usage", () => {
  expect(typeof response.parseContinuationResponse).toBe("function");
  const wire = event({ type: "response.output_item.done", item: message }) + done([]) + "data: [DONE]\n\n";
  const parsed = response.parseContinuationResponse(wire, ["read_file"]);
  expect(parsed.items).toEqual([message]); expect(parsed.answer).toBe("finished");
  expect(parsed.calls).toEqual([]); expect(parsed.usage.input).toBe(100);
});

test("fails closed on empty, incomplete, duplicated and error-bearing terminal responses", () => {
  for (const wire of [
    done([]),
    done([message]) + done([message]),
    event({ type: "response.completed", response: { status: "incomplete", output: [message], usage } }),
    event({ type: "error", error: "provider failed" }) + done([message]),
    event({ type: "response.failed" }) + done([message]),
    event({ type: "response.completed", response: { status: "completed", error: { message: "failed" }, output: [message], usage } }),
  ]) expect(() => response.parseContinuationResponse(wire, ["read_file"])).toThrow();
});

test("validates the entire tool batch before execution and rejects unsupported output items", () => {
  const call = { type: "function_call", status: "completed", call_id: "call-1", name: "read_file", arguments: '{"path":"zarr/util.py"}' };
  expect(response.parseContinuationResponse(done([call]), ["read_file"]).calls).toEqual([call]);
  for (const items of [
    [call, call], [call, { ...call, call_id: "call-2", name: "shell" }],
    [{ ...call, arguments: "not-json" }], [{ ...call, arguments: "[]" }], [{ ...call, call_id: "" }],
    [{ ...message, status: "in_progress" }], [{ type: "web_search_call" }, message],
  ]) expect(() => response.parseContinuationResponse(done(items), ["read_file"])).toThrow();
});
