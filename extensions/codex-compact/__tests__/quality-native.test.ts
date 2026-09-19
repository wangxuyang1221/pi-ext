import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, test } from "vitest";
import { LineRpc } from "../../../scripts/codex-compact-quality-rpc.mjs";
import { WorkspaceTools } from "../../../scripts/codex-compact-quality-tools.mjs";
import * as native from "../../../scripts/codex-compact-quality-native.mjs";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function workspace() {
  const root = path.resolve(".tmp/codex-quality");
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, "native-test-"));
  directories.push(directory);
  fs.writeFileSync(path.join(directory, "source.txt"), "before");
  return { directory, tools: new WorkspaceTools(directory, ["source.txt"]) };
}

test("native tools bind writes to the current thread and turn and retain operation outcomes", () => {
  const { directory, tools } = workspace();
  const records: any[] = [];
  expect(typeof native.createCliToolHandler).toBe("function");
  const handler = native.createCliToolHandler({ tools, currentTurn: () => ({ threadId: "t", turnId: "u" }), record: (row: any) => records.push(row) });
  const signal = new AbortController().signal;
  const params = { threadId: "t", turnId: "u", callId: "a", namespace: null, tool: "read_file", arguments: { path: "source.txt" } };
  expect(handler(params, signal)).toEqual({ contentItems: [{ type: "inputText", text: "before" }], success: true });
  expect(handler({ ...params, callId: "b", tool: "replace_text", arguments: { path: "source.txt", old_text: "before", new_text: "after" } }, signal).success).toBe(true);
  expect(fs.readFileSync(path.join(directory, "source.txt"), "utf8")).toBe("after");
  expect(handler({ ...params, callId: "c", arguments: { path: "../outside" } }, signal).success).toBe(false);
  expect(records).toHaveLength(3);
  expect(records.map((row) => row.event.status)).toEqual(["ok", "ok", "error"]);
  expect(records[1].callId).toBe("b");
});

test("native tools reject stale, duplicate, namespaced, malformed and aborted calls before side effects", () => {
  const { directory, tools } = workspace();
  const handler = native.createCliToolHandler({ tools, currentTurn: () => ({ threadId: "t", turnId: "u" }) });
  const controller = new AbortController();
  const params = { threadId: "t", turnId: "u", callId: "a", namespace: null, tool: "replace_text", arguments: { path: "source.txt", old_text: "before", new_text: "after" } };
  for (const override of [
    { threadId: "other" }, { turnId: "old" }, { namespace: "elsewhere" }, { callId: "" },
    { tool: "shell" }, { arguments: null }, { arguments: { ...params.arguments, command: "rm" } },
    { arguments: { ...params.arguments, new_text: 42 } },
  ]) expect(() => handler({ ...params, ...override }, controller.signal)).toThrow();
  expect(tools.events).toHaveLength(0);
  expect(fs.readFileSync(path.join(directory, "source.txt"), "utf8")).toBe("before");
  expect(handler(params, controller.signal).success).toBe(true);
  expect(() => handler({ ...params, arguments: { path: "source.txt", old_text: "after", new_text: "twice" } }, controller.signal)).toThrow("Duplicate tool call");
  controller.abort(new Error("Session closed"));
  expect(() => handler({ ...params, callId: "b" }, controller.signal)).toThrow("Session closed");
  expect(tools.events).toHaveLength(1);
  expect(fs.readFileSync(path.join(directory, "source.txt"), "utf8")).toBe("after");
});

test("native turn failures retain partial responses and ignore foreign completion events", async () => {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  const client = new LineRpc(child);
  child.stdin.on("data", (bytes: Buffer) => {
    const request = JSON.parse(bytes.toString());
    const emit = (row: any) => child.stdout.write(JSON.stringify(row) + "\n");
    emit({ id: request.id, result: { turn: { id: "u" } } });
    emit({ method: "turn/completed", params: { threadId: "other", turn: { id: "u", status: "completed" } } });
    emit({ method: "rawResponse/completed", params: { threadId: "t", turnId: "u", responseId: "r", usage: null } });
    emit({ method: "error", params: { threadId: "t", turnId: "u", willRetry: true } });
    emit({ method: "turn/completed", params: { threadId: "t", turn: { id: "u", status: "failed", error: { message: "request failed" } } } });
  });
  try {
    const turn = await native.runNativeCliTurn(client, { threadId: "t", text: "task", timeoutMs: 1000 });
    expect(turn.status).toBe("failed");
    expect(turn.responses).toEqual([{ threadId: "t", turnId: "u", responseId: "r", usage: null }]);
    expect(turn.tokenUsage).toBeNull();
    expect(turn.compactions).toBe(0);
  } finally { client.dispose(); }
});

test("native sessions start with controlled tools and use turn scheduling without manual compaction", async () => {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  const sent: any[] = [];
  const client = new LineRpc(child, { record: (row: any) => { if (row.direction === "send") sent.push(row.row); } });
  child.stdin.on("data", (bytes: Buffer) => {
    const request = JSON.parse(bytes.toString());
    const emit = (row: any) => child.stdout.write(JSON.stringify(row) + "\n");
    if (request.method === "initialize") emit({ id: request.id, result: {} });
    if (request.method === "thread/start") emit({ id: request.id, result: { model: "gpt-5.6-sol", reasoningEffort: "medium", thread: { id: "t" } } });
    if (request.method === "turn/start") {
      emit({ method: "turn/started", params: { threadId: "t", turn: { id: "u", status: "inProgress" } } });
      emit({ method: "rawResponse/completed", params: { threadId: "foreign", turnId: "u", responseId: "foreign", usage: { totalTokens: 999 } } });
      emit({ method: "item/completed", params: { threadId: "t", turnId: "u", item: { type: "contextCompaction", id: "c" } } });
      emit({ method: "rawResponse/completed", params: { threadId: "t", turnId: "u", responseId: "r", usage: { totalTokens: 246000 } } });
      emit({ method: "thread/tokenUsage/updated", params: { threadId: "t", turnId: "u", tokenUsage: { last: { totalTokens: 246000 }, modelContextWindow: 258400 } } });
      emit({ method: "item/completed", params: { threadId: "t", turnId: "u", item: { type: "agentMessage", text: "ACK" } } });
      emit({ method: "turn/completed", params: { threadId: "t", turn: { id: "u", status: "completed" } } });
      emit({ id: request.id, result: { turn: { id: "u" } } });
    }
  });
  try {
    expect(typeof native.startNativeCliSession).toBe("function");
    const session = await native.startNativeCliSession(client, { cwd: "/owned", instructions: "instructions", timeoutMs: 1000 });
    expect(session.threadId).toBe("t");
    const start = sent.find((row) => row.method === "thread/start").params;
    expect(start).toMatchObject({ sandbox: "read-only", approvalPolicy: "never", experimentalRawEvents: true });
    expect(start.dynamicTools.map((tool: any) => tool.name)).toEqual(["read_file", "replace_text"]);
    expect(start.dynamicTools[0].inputSchema.required).toEqual(["path"]);
    const turn = await native.runNativeCliTurn(client, { threadId: session.threadId, text: "source quote", timeoutMs: 1000 });
    expect(turn).toMatchObject({ status: "completed", answer: "ACK", turnId: "u", compactions: 1 });
    expect(turn.responses.map((row: any) => row.responseId)).toEqual(["r"]);
    expect(turn.tokenUsage.last.totalTokens).toBe(246000);
    expect(sent.map((row) => row.method)).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
  } finally { client.dispose(); }
});
