// Native scheduling experiment helpers; never imported by the extension.
import assert from "node:assert/strict";
import { continuationTools } from "./codex-compact-quality-tools.mjs";

export function createCliToolHandler({ tools, currentTurn, record = () => {} }) {
  const seen = new Set();
  return (params, signal) => {
    signal.throwIfAborted();
    const turn = currentTurn();
    assert.ok(turn?.threadId && turn?.turnId && params?.threadId === turn.threadId && params?.turnId === turn.turnId, "Stale or foreign tool call");
    assert.ok(params.namespace == null && typeof params.callId === "string" && params.callId.length > 0, "Invalid tool identity");
    assert.ok(["read_file", "replace_text"].includes(params.tool), "Unsupported native tool");
    const keys = params.tool === "read_file" ? ["path"] : ["path", "old_text", "new_text"];
    assert.ok(params.arguments && !Array.isArray(params.arguments) && Object.keys(params.arguments).length === keys.length && keys.every(key => typeof params.arguments[key] === "string"), "Invalid native tool arguments");
    assert.ok(!seen.has(params.callId), "Duplicate tool call");
    seen.add(params.callId);
    const text = tools.execute(params.tool, params.arguments);
    const event = tools.events.at(-1);
    record({ ...turn, callId: params.callId, event });
    return { contentItems: [{ type: "inputText", text }], success: event.status === "ok" };
  };
}

function deadline(timeoutMs) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, "Invalid native CLI deadline");
  const end = performance.now() + timeoutMs;
  return () => {
    const remaining = Math.ceil(end - performance.now());
    assert.ok(remaining > 0, "Native CLI execution deadline exceeded");
    return remaining;
  };
}

export async function startNativeCliSession(client, { cwd, instructions, timeoutMs = 300_000 }) {
  const remaining = deadline(timeoutMs);
  await client.request("initialize", { clientInfo: { name: "codex_compact_quality_native", version: "1" }, capabilities: { experimentalApi: true } }, remaining());
  client.send({ method: "initialized", params: {} });
  const started = await client.request("thread/start", {
    model: "gpt-5.6-sol", cwd, sandbox: "read-only", approvalPolicy: "never",
    baseInstructions: instructions, developerInstructions: "", config: { model_reasoning_effort: "medium" },
    experimentalRawEvents: true,
    dynamicTools: continuationTools.map(tool => ({ type: "function", name: tool.name, description: tool.description, inputSchema: tool.parameters })),
  }, remaining());
  assert.equal(started.model, "gpt-5.6-sol", "Native CLI model mismatch");
  assert.equal(started.reasoningEffort, "medium", "Native CLI effort mismatch");
  assert.ok(typeof started.thread?.id === "string" && started.thread.id, "Missing native CLI thread ID");
  return { threadId: started.thread.id, started };
}

/** Executes an ordinary turn. No compaction, window or threshold override is sent. */
export async function runNativeCliTurn(client, { threadId, text, timeoutMs = 300_000 }) {
  const remaining = deadline(timeoutMs);
  assert.ok(typeof threadId === "string" && threadId && typeof text === "string" && text, "Invalid native CLI turn");
  const cursor = client.events.length;
  const started = performance.now();
  const response = await client.request("turn/start", { threadId, input: [{ type: "text", text }] }, remaining());
  const turnId = response.turn?.id;
  assert.ok(typeof turnId === "string" && turnId, "Missing native CLI turn ID");
  const belongs = row => row.params?.threadId === threadId && (row.params.turnId ?? row.params.turn?.id) === turnId;
  const terminal = row => belongs(row) && (row.method === "turn/completed" || (row.method === "error" && row.params.willRetry !== true));
  let completion;
  while (!completion) {
    try { completion = await client.waitFor(terminal, cursor, Math.min(30_000, remaining())); }
    catch (error) {
      if (error.message !== "RPC notification wait timed out; process state is unchanged") throw error;
      remaining();
    }
  }
  const events = client.events.slice(cursor).filter(belongs);
  return {
    threadId, turnId, status: completion.params.turn?.status ?? "failed", completion,
    elapsedMs: performance.now() - started,
    compactions: events.filter(row => row.method === "item/completed" && row.params.item?.type === "contextCompaction").length,
    responses: events.filter(row => row.method === "rawResponse/completed").map(row => row.params),
    tokenUsage: events.findLast(row => row.method === "thread/tokenUsage/updated")?.params.tokenUsage ?? null,
    answer: events.filter(row => row.method === "item/completed" && row.params.item?.type === "agentMessage").map(row => row.params.item.text ?? "").join("\n"),
  };
}
