import { expect, test, vi } from "vitest";
import { CodexError, createTransport, runResponsesSearch } from "../src/codex.ts";

function search(body: string | ReadableStream<Uint8Array>, onTextDelta?: (delta: string) => void) {
  const transport = createTransport({
    token: "token", accountId: "account", baseUrl: "https://example.test/backend",
    fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
  });
  return runResponsesSearch({ query: "q", model: "m", transport, externalWebAccess: true, onTextDelta });
}

function frame(type: string, data: Record<string, unknown>, named = false): string {
  return `${named ? `event: ${type}\r\n` : ""}data: ${JSON.stringify({ type, ...data })}\r\n\r\n`;
}

test.each([false, true])("collects text, citations, calls and usage from SSE with event lines=%s", async named => {
  const body = [
    frame("response.created", { response: { id: "search-response" } }, named),
    frame("response.output_text.delta", { delta: "Streaming answer" }, named),
    frame("response.output_item.done", { item: { id: "call-1", type: "web_search_call", status: "completed", action: { type: "search", query: "q" } } }, named),
    frame("response.output_item.done", { item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Final answer", annotations: [
      { type: "url_citation", url: "https://example.test/doc", title: "Source", start_index: 0, end_index: 5 },
    ] }] } }, named),
    frame("response.completed", { response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } }, named),
  ].join("");
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
    controller.close();
  } });
  const onTextDelta = vi.fn();
  await expect(search(stream, onTextDelta)).resolves.toEqual({
    responseId: "search-response", model: "m", text: "Final answer",
    searchCalls: [{ id: "call-1", status: "completed", query: "q", actionType: "search", url: undefined }],
    citations: [{ url: "https://example.test/doc", title: "Source", startIndex: 0, endIndex: 5 }],
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  });
  expect(onTextDelta).toHaveBeenCalledExactlyOnceWith("Streaming answer");
});

test.each([
  ["response.failed", { response: { error: { message: "Rate limit exceeded", code: "rate_limit_exceeded" } } }, "rate_limit", "Rate limit exceeded"],
  ["error", { message: "Unauthorized request", code: "unauthorized" }, "auth", "Unauthorized request"],
  ["error", { error: { message: "Connection lost" } }, "transport", "Connection lost"],
  ["response.incomplete", { response: { incomplete_details: { reason: "max_output_tokens" } } }, "unknown", "max_output_tokens"],
  ["response.incomplete", { response: {} }, "unknown", "Codex web search failed"],
  ["error", {}, "unknown", "Codex web search failed"],
] as const)("rejects %s instead of returning partial results", async (type, data, kind, message) => {
  const body = frame("response.output_text.delta", { delta: "Partial answer" }, true) + frame(type, data, true);
  await expect(search(body)).rejects.toMatchObject({ name: "CodexError", kind, message: expect.stringContaining(message) });
});

test.each(["", "data: [DONE]\n\n"])("rejects EOF without completion, including marker %j", async ending => {
  const body = frame("response.output_text.delta", { delta: "Partial answer" }, true) + ending;
  await expect(search(body)).rejects.toMatchObject({ name: "CodexError", kind: "transport", message: expect.stringContaining("completed") });
});

test("cancels the response body after completion without waiting for EOF", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(frame("response.completed", { response: {} }, true)));
  }, cancel });
  await expect(search(body)).resolves.toMatchObject({ text: "" });
  expect(cancel).toHaveBeenCalledOnce();
});

test("preserves cancellation while reading the stream", async () => {
  const error = new DOMException("Search cancelled", "AbortError");
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(error); } });
  await expect(search(body)).rejects.toBe(error);
  expect(error).not.toBeInstanceOf(CodexError);
});
