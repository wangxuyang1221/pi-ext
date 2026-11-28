import assert from "node:assert/strict";
import { test } from "vitest";
import { CodemodeStore } from "../../../shared/ui/codemode-model.js";
import { ResultCache } from "../../../shared/ui/codemode-data.js";

const start = (id: string, name = "codemode", parentToolCallId?: string) => ({ type: "tool_execution_start", toolCallId: id, toolName: name, parentToolCallId, args: name === "codemode" ? { code: "text(1)" } : { path: "a.ts" } });
const end = (id: string, name: string, error: boolean, parentToolCallId?: string) => ({ type: "tool_execution_end", toolCallId: id, toolName: name, parentToolCallId, isError: error, result: { content: [{ type: "text", text: error ? "denied" : "ok" }] } });

test("codemode keeps stable nested order and failed children when the script succeeds", () => {
  const store = new CodemodeStore();
  store.event(start("p"));
  store.event(start("p/1", "read", "p"));
  store.event(start("p/2", "bash", "p"));
  store.event(end("p/2", "bash", true, "p"));
  store.event(end("p/1", "read", false, "p"));
  store.event(end("p", "codemode", false));
  const row = store.get("p");
  assert.ok(row);
  assert.equal(row.status, "completed");
  assert.deepEqual(row.calls.map(call => call.id), ["p/1", "p/2"]);
  assert.equal(row.counts.error, 1);
  assert.equal(row.calls[1].status, "error");
});

test("live snapshots only scan appended tool entries, while tracking model call transitions", () => {
  const store = new CodemodeStore(); store.event(start("p"));
  let reads = 0;
  const calls: unknown[] = [];
  for (let i = 0; i < 100; i++) {
    calls.push({ id: "p/?", get name() { reads++; return "read"; }, args: "{}", status: "running" });
    store.event({ type: "tool_execution_update", toolName: "codemode", toolCallId: "p", partialResult: { details: { calls } } });
  }
  assert.ok(reads <= 200, `Read unchanged tool names ${reads} times`);
  assert.equal(store.get("p")!.calls.length, 0);
  calls.push({ id: "p/models.classify/1", name: "models.classify", args: "provider/model", status: "running" });
  store.event({ type: "tool_execution_update", toolName: "codemode", toolCallId: "p", partialResult: { details: { calls } } });
  calls[100] = { id: "p/models.classify/1", name: "models.classify", args: "provider/model", status: "error", error: "classifier unavailable" };
  store.event({ type: "tool_execution_update", toolName: "codemode", toolCallId: "p", partialResult: { details: { calls } } });
  assert.equal(store.get("p")!.counts.error, 1);
  assert.equal(store.get("p")!.calls[0].model, true);
});

test("restoration preserves nested ancestry, missing arguments and incomplete metadata", () => {
  const store = new CodemodeStore();
  store.rebuild([{ role: "assistant", content: [{ type: "toolCall", id: "p", name: "codemode", arguments: { code: "text(1)" } }] },
    { role: "toolResult", toolCallId: "p", toolName: "codemode", isError: false, content: [], nestedCalls: { complete: false, calls: [
      { id: "p/1", name: "outer", status: "ok", arguments: {} }, { id: "p/1/1", name: "read", status: "error", argumentsBytes: 9000, error: "denied" },
    ] } }]);
  const row = store.get("p")!;
  assert.equal(row.calls[1].parentId, "p/1"); assert.equal(row.calls[1].depth, 1);
  assert.equal(row.incomplete, true); assert.equal(row.calls[1].argsComplete, false);
  assert.equal(row.calls[1].startedAt, undefined); assert.equal(store.results.size, 0);
  store.event(end("p/1/1", "read", false, "p/1"));
  assert.equal(row.calls[1].status, "error");
  store.rebuild([]); assert.equal(store.latest(), undefined); assert.equal(row.evicted, true);
});

test("result and row budgets evict only UI evidence without altering execution results", () => {
  const cache = new ResultCache(4096, 1024);
  const store = new CodemodeStore({ rows: 2, calls: 2 }, cache);
  const input = { content: [{ type: "text", text: "x".repeat(1024 * 1024) }], details: { diff: "large" } };
  for (let i = 0; i < 30; i++) cache.set(String(i), input);
  assert.ok(cache.bytes <= 4096); assert.ok(cache.size < 30); assert.equal(input.content[0].text.length, 1024 * 1024);
  assert.equal(cache.get("29")!.complete, false);
  for (let i = 0; i < 5; i++) { store.event(start(String(i))); for (let j = 0; j < 3; j++) store.event(start(`${i}/${j}`, "read", String(i))); }
  assert.equal(store.size, 2); assert.equal(store.get("4")!.calls.length, 2); assert.equal(store.get("4")!.incomplete, true);
});

test("persisted unfinished metadata does not downgrade an observed cancellation", () => {
  const store = new CodemodeStore(); store.event(start("p")); store.event(start("p/1", "bash", "p"));
  store.event({ ...end("p", "codemode", true), result: { content: [{ type: "text", text: "Script error:\nScript aborted: signal" }], details: { calls: [{ id: "p/1", name: "bash", args: "{}", status: "cancelled" }] } } });
  store.message({ role: "toolResult", toolName: "codemode", toolCallId: "p", isError: true, content: [{ type: "text", text: "Script error:\nScript aborted: signal" }], nestedCalls: { complete: false, calls: [{ id: "p/1", name: "bash", arguments: {}, status: "unfinished" }] } });
  assert.equal(store.get("p")!.calls[0].status, "cancelled");
  assert.equal(store.get("p")!.counts.cancelled, 1);
});

test("printed diagnostics cannot override the final script error", () => {
  const store = new CodemodeStore(); store.event(start("p"));
  store.event({ ...end("p", "codemode", true), result: { content: [{ type: "text", text: "Script failed\nWall time 1 seconds\nOutput:\nScript error:\nScript timed out: fake output\nScript error:\nError: actual failure" }] } });
  assert.equal(store.get("p")!.status, "failed");
});

test("only host codemode diagnostic framing classifies timeout and interruption", () => {
  const store = new CodemodeStore();
  for (const [id, text, status] of [["a", "Script error:\nScript timed out: deadline", "timed_out"], ["b", "Script error:\nScript aborted: signal", "interrupted"], ["c", "Script timed out: user text", "failed"]]) {
    store.event(start(id));
    store.event({ ...end(id, "codemode", true), result: { content: [{ type: "text", text }] } });
    assert.equal(store.get(id)!.status, status);
  }
});

test("models.generateImages tracks public model-ref metadata and rebuilds scripts with third options arg", () => {
  const store = new CodemodeStore();
  store.event({
    type: "tool_execution_start",
    toolName: "codemode",
    toolCallId: "img-live",
    args: { code: 'await models.generateImages({ provider: "radius", id: "image-1" }, { input: [{ type: "text", text: "logo" }] }, { aspectRatio: "16:9", size: "2K" })' },
  });
  store.event({
    type: "tool_execution_update",
    toolName: "codemode",
    toolCallId: "img-live",
    partialResult: { details: { calls: [{ id: "img-live/models.generateImages/1", name: "models.generateImages", args: "radius/image-1", status: "running" }] } },
  });
  assert.equal(store.get("img-live")!.calls[0]!.model, true);
  assert.equal(store.get("img-live")!.calls[0]!.args.preview, "radius/image-1");

  store.event({
    type: "tool_execution_end",
    toolName: "codemode",
    toolCallId: "img-live",
    isError: false,
    result: {
      content: [{ type: "text", text: "Script completed\nWall time 0.4s\nOutput:\ngenerated 1 image" }],
      details: {
        calls: [
          { id: "img-live/models.generateImages/1", name: "models.generateImages", args: "radius/image-1", status: "ok", durationMs: 320 },
          { id: "img-live/models.generateImages/2", name: "models.generateImages", args: "openrouter/img-fail", status: "error", error: "provider error" },
        ],
      },
    },
  });
  const live = store.get("img-live")!;
  assert.equal(live.counts.ok, 1);
  assert.equal(live.counts.error, 1);
  assert.equal(live.calls[1]!.error, "provider error");

  store.rebuild([
    {
      role: "assistant",
      content: [{
        type: "toolCall",
        id: "img-hist",
        name: "codemode",
        arguments: { code: 'await models.generateImages({ provider: "radius", id: "image-1" }, { input: [{ type: "text", text: "logo" }] }, { aspectRatio: "1:1", size: "1K" })' },
      }],
    },
    {
      role: "toolResult",
      toolCallId: "img-hist",
      toolName: "codemode",
      isError: false,
      content: [{ type: "text", text: "ok" }],
      details: { calls: [{ id: "img-hist/models.generateImages/1", name: "models.generateImages", args: "radius/image-1", status: "ok" }] },
    },
  ]);
  const rebuilt = store.get("img-hist")!;
  assert.equal(rebuilt.calls.length, 1);
  assert.equal(rebuilt.calls[0]!.model, true);
  assert.match(rebuilt.code, /aspectRatio/);
});
