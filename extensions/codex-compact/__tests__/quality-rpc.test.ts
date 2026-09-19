import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import * as rpc from "../../../scripts/codex-compact-quality-rpc.mjs";

test("keeps notifications arriving before the request response", async () => {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  expect(typeof rpc.LineRpc).toBe("function");
  const client = new rpc.LineRpc(child);
  const pending = client.request("thread/compact/start", { threadId: "t" }, 1000);
  child.stdout.write(JSON.stringify({ method: "item/completed", params: { item: { type: "contextCompaction" } } }) + "\n");
  child.stdout.write('{"id":1,"result":{}}\n');
  await pending;
  const event = await client.waitFor((row: any) => row.method === "item/completed", 0, 1000);
  expect(event.params.item.type).toBe("contextCompaction");
  client.dispose();
});

test("observation timeouts do not discard a live session or later notifications", async () => {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  const client = new rpc.LineRpc(child);
  await expect(client.waitFor((row: any) => row.method === "done", 0, 5)).rejects.toThrow("process state is unchanged");
  child.stdout.write('{"method":"done","params":{"value":7}}\n');
  expect((await client.waitFor((row: any) => row.method === "done", 0, 100)).params.value).toBe(7);
  client.dispose();
});

test("server requests are rejected rather than mistaken for client replies", async () => {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  const records: any[] = [];
  const client = new rpc.LineRpc(child, { record: (row: any) => records.push(row) });
  const pending = client.request("thread/compact/start", {}, 100);
  child.stdout.write('{"id":1,"method":"approval/request","params":{}}\n');
  child.stdout.write('{"id":1,"result":{"accepted":true}}\n');
  expect(await pending).toEqual({ accepted: true });
  expect(records.some((record) => record.direction === "send" && record.row.error?.code === -32601)).toBe(true);
  client.dispose();
});

test("dispatches only explicitly registered server methods without consuming client replies", async () => {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  const records: any[] = [];
  const calls: any[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = new rpc.LineRpc(child, {
    record: (row: any) => records.push(row),
    serverHandlers: {
      "item/tool/call": async (params: any, signal: AbortSignal) => {
        calls.push({ params, signal });
        await gate;
        return { contentItems: [{ type: "inputText", text: "contents" }], success: true };
      },
    },
  });
  const pending = client.request("turn/start", {}, 1000);
  child.stdout.write('{"id":1,"method":"item/tool/call","params":{"callId":"call-1"}}\n');
  child.stdout.write('{"id":"approval","method":"approval/request","params":{}}\n');
  child.stdout.write('{"id":1,"result":{"turnId":"turn-1"}}\n');
  expect(await pending).toEqual({ turnId: "turn-1" });
  expect(calls).toHaveLength(1);
  expect(calls[0].signal.aborted).toBe(false);
  expect(records.find((row) => row.direction === "send" && row.row.id === "approval")?.row.error.code).toBe(-32601);
  expect(records.some((row) => row.direction === "send" && row.row.result)).toBe(false);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  expect(records.find((row) => row.direction === "send" && row.row.result)?.row).toEqual({
    id: 1, result: { contentItems: [{ type: "inputText", text: "contents" }], success: true },
  });
  client.dispose();
});

test("aborts active server work and never starts queued work after disposal", async () => {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  const records: any[] = [];
  const calls: AbortSignal[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = new rpc.LineRpc(child, {
    record: (row: any) => records.push(row),
    serverHandlers: { "item/tool/call": async (_: any, signal: AbortSignal) => {
      calls.push(signal);
      await gate;
      if (signal.aborted) throw signal.reason;
      return { success: true };
    } },
  });
  child.stdout.write('{"id":"a","method":"item/tool/call","params":{}}\n');
  child.stdout.write('{"id":"b","method":"item/tool/call","params":{}}\n');
  await new Promise((resolve) => setImmediate(resolve));
  expect(calls).toHaveLength(1);
  client.dispose();
  expect(calls[0].aborted).toBe(true);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  expect(calls).toHaveLength(1);
  expect(records.filter((row) => row.direction === "send")).toEqual([]);
});

test("duplicate server request IDs fail closed instead of applying a write twice", async () => {
  for (const completed of [false, true]) {
    const child = new EventEmitter() as any;
    child.stdin = new PassThrough(); child.stdout = new PassThrough();
    let executions = 0;
    const client = new rpc.LineRpc(child, {
      serverHandlers: { "item/tool/call": async () => { executions++; return { success: true }; } },
    });
    child.stdout.write('{"id":"write-1","method":"item/tool/call","params":{}}\n');
    if (completed) await new Promise((resolve) => setImmediate(resolve));
    child.stdout.write('{"id":"write-1","method":"item/tool/call","params":{}}\n');
    await expect(client.waitFor(() => false, 0, 100)).rejects.toThrow("Duplicate server request ID");
    await new Promise((resolve) => setImmediate(resolve));
    expect(executions).toBe(completed ? 1 : 0);
    client.dispose();
  }
});

test("server work has a finite deadline and handler failures abort the session", async () => {
  for (const hangs of [true, false]) {
    const child = new EventEmitter() as any;
    child.stdin = new PassThrough(); child.stdout = new PassThrough();
    let signal: AbortSignal | undefined;
    const client = new rpc.LineRpc(child, {
      serverRequestTimeoutMs: 10,
      serverHandlers: { "item/tool/call": async (_: any, current: AbortSignal) => {
        signal = current;
        if (hangs) return new Promise(() => {});
        throw new Error("Tool execution failed");
      } },
    });
    const pending = expect(client.request("turn/start", {}, 1000)).rejects.toThrow(hangs ? "Server request timed out" : "Tool execution failed");
    child.stdout.write('{"id":"tool","method":"item/tool/call","params":{}}\n');
    await pending;
    expect(signal?.aborted).toBe(true);
    client.dispose();
  }
});

test("terminal process exit rejects pending calls and notification waits", async () => {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  const client = new rpc.LineRpc(child);
  const reply = expect(client.request("request", {}, 1000)).rejects.toThrow("CLI exited");
  const event = expect(client.waitFor(() => false, 0, 1000)).rejects.toThrow("CLI exited");
  child.emit("exit", 1, null);
  await Promise.all([reply, event]);
  expect(client.pending.size).toBe(0);
  expect(client.waiters.size).toBe(0);
  client.dispose();
});

test("malformed and excessive captures fail closed", async () => {
  for (const [line, maxBytes, message] of [["not json", 100, "Unexpected"], ['{"method":"notice"}', 4, "capture limit"]] as const) {
    const child = new EventEmitter() as any;
    child.stdin = new PassThrough(); child.stdout = new PassThrough();
    const client = new rpc.LineRpc(child, { maxBytes });
    const pending = expect(client.request("request", {}, 1000)).rejects.toThrow(message);
    child.stdout.write(line + "\n");
    await pending;
    client.dispose();
  }
});
