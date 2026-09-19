import { expect, test } from "vitest";
import * as cli from "../../../scripts/codex-compact-quality-cli.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fingerprintWorkspace } from "../../../scripts/codex-compact-quality-tools.mjs";

const history = [{ type: "message", role: "user", content: [{ type: "input_text", text: "task" }] }];
function rollout() {
  return [
    { type: "session_meta", payload: { id: "thread-1", cli_version: "0.154.0", base_instructions: { text: "instructions" } } },
    { type: "response_item", payload: { ...history[0], id: "generated-id" } },
    { type: "compacted", payload: { compaction_response_id: "response-1", replacement_history: [{ type: "compaction", encrypted_content: "test-only-opaque-data" }], latest_token_usage_record: { thread_id: "thread-1", response_id: "response-1", usage: { input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 0, output_tokens: 10, total_tokens: 110 } } } },
  ];
}
const expected = { threadId: "thread-1", history, instructions: "instructions" };

test("extracts a pinned native checkpoint only after checking imported history and usage provenance", () => {
  expect(typeof cli.extractCliCheckpoint).toBe("function");
  const result = cli.extractCliCheckpoint(rollout(), expected);
  expect(result.replacementHistory).toEqual([{ type: "compaction", encrypted_content: "test-only-opaque-data" }]);
  expect(result.usage).toEqual({ input: 100, uncachedInput: 40, cachedInput: 60, cacheWriteInput: 0, output: 10, total: 110 });
  expect(result.source).toBe("actual-codex-cli-0.154.0");
});

test("accepts only documented empty response metadata omissions when importing a previous continuation", () => {
  const previous: any[] = [
    { type: "reasoning", id: "r1", summary: [{ type: "summary_text", text: "Keep the constraint" }], content: [], encrypted_content: "private-checkpoint" },
    { type: "function_call", id: "f1", call_id: "call1", name: "read_file", arguments: '{"path":"source.txt"}', status: "completed" },
    { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Evidence retained", annotations: [], logprobs: [] }] },
  ];
  const serialized = structuredClone(previous);
  delete serialized[0].content; delete serialized[1].status; delete serialized[2].status;
  delete serialized[2].content[0].annotations; delete serialized[2].content[0].logprobs;
  const rows = [rollout()[0], ...serialized.map(payload => ({ type: "response_item", payload })), rollout()[2]];
  const result = cli.extractCliCheckpoint(rows, { ...expected, history: previous });
  expect(result.importNormalizations).toHaveLength(5);
  expect(result.importNormalizations).toContainEqual({ index: 0, field: "content", reason: "empty-reasoning-content" });
  expect(previous[0].content).toEqual([]);
  for (const mutate of [
    (items: any[]) => items[0].content.push({ type: "reasoning_text", text: "Important evidence" }),
    (items: any[]) => items[0].encrypted_content = "changed-checkpoint",
    (items: any[]) => items[1].arguments = '{"path":"other.txt"}',
    (items: any[]) => items[1].status = "incomplete",
    (items: any[]) => items[2].content[0].annotations.push({ type: "url_citation", url: "https://example.com/evidence" }),
    (items: any[]) => items[2].content[0].text = "Changed evidence",
    (items: any[]) => items[2].new_unknown_field = "must not silently disappear",
  ]) {
    const items = structuredClone(previous); mutate(items);
    let observed: any;
    try { cli.extractCliCheckpoint(rows, { ...expected, history: items }); } catch (error) { observed = error; }
    expect(observed).toBeInstanceOf(Error);
    expect(observed.message).toMatch(/imported history mismatch/);
    expect(observed.message).not.toContain("private-checkpoint");
    expect(observed.message).not.toContain("Evidence retained");
    expect(observed.message).not.toContain("Important evidence");
  }
});

test("compacts once and accepts only its own canonical completion before archiving", async () => {
  expect(typeof cli.compactCliSession).toBe("function");
  const calls: string[] = [];
  const events: any[] = [];
  const client = {
    events,
    send: (row: any) => calls.push(row.method),
    request: async (method: string) => {
      calls.push(method);
      if (method === "thread/resume") return { model: "gpt-5.6-sol", reasoningEffort: "medium", thread: { id: "thread-1" } };
      if (method === "thread/compact/start") events.push(
        { method: "item/completed", params: { threadId: "other", item: { type: "contextCompaction" } } },
        { method: "item/completed", params: { threadId: "thread-1", item: { type: "contextCompaction" } } }
      );
      return {};
    },
    waitFor: async (predicate: (event: any) => boolean, after: number) => events.slice(after).find(predicate),
  };
  const result = await cli.compactCliSession(client, { history, instructions: "instructions", cwd: process.cwd(), executionTimeoutMs: 1000 });
  expect(result.threadId).toBe("thread-1");
  expect(result.compactionElapsedMs).toBeGreaterThanOrEqual(0);
  expect(calls).toEqual(["initialize", "initialized", "thread/resume", "thread/compact/start", "thread/archive"]);
});

test("re-polls the same thread after an observation timeout without resubmitting compaction", async () => {
  const calls: string[] = [];
  let waits = 0;
  const client = {
    events: [], send: () => {},
    request: async (method: string) => { calls.push(method); return { model: "gpt-5.6-sol", reasoningEffort: "medium", thread: { id: "thread-1" } }; },
    waitFor: async () => {
      if (++waits === 1) throw new Error("RPC notification wait timed out; process state is unchanged");
      return { method: "item/completed", params: { threadId: "thread-1", item: { type: "contextCompaction" } } };
    },
  };
  await cli.compactCliSession(client, { history, instructions: "instructions", cwd: process.cwd(), executionTimeoutMs: 1000 });
  expect(waits).toBe(2);
  expect(calls.filter(method => method === "thread/compact/start")).toHaveLength(1);
});

test("cleans credential copies and verifies group shutdown when the CLI exits before initialization", async () => {
  expect(typeof cli.runCliCompaction).toBe("function");
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-cli-exit-"));
  try {
    const executable = path.join(root, "fake-cli");
    fs.writeFileSync(executable, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.154.0"; else exit 2; fi\n', { mode: 0o755 });
    const credentialFile = path.join(root, "credential.json"); fs.writeFileSync(credentialFile, '{"test_only":true}');
    const directory = path.join(root, "job"); fs.mkdirSync(directory);
    const sourceWorkspace = path.join(root, "workspace"); fs.mkdirSync(sourceWorkspace);
    await expect(cli.runCliCompaction({ directory, executable, binarySha256: createHash("sha256").update(fs.readFileSync(executable)).digest("hex"), credentialFile, sourceWorkspace, expectedWorkspaceFingerprint: fingerprintWorkspace(sourceWorkspace), history, instructions: "instructions", executionTimeoutMs: 1000 })).rejects.toThrow();
    expect(fs.existsSync(path.join(directory, "cli/codex-home/auth.json"))).toBe(false);
    const cleanup = JSON.parse(fs.readFileSync(path.join(directory, "cli/cleanup.json"), "utf8"));
    expect(cleanup.groupStopped).toBe(true);
    expect(() => process.kill(-cleanup.pid, 0)).toThrow();
    expect(fs.existsSync(path.join(directory, "cli/failure.json"))).toBe(true);
    const other = path.join(root, "bad-fingerprint"); fs.mkdirSync(other);
    await expect(cli.runCliCompaction({ directory: other, executable, binarySha256: "0".repeat(64), credentialFile, sourceWorkspace, expectedWorkspaceFingerprint: fingerprintWorkspace(sourceWorkspace), history, instructions: "instructions" })).rejects.toThrow(/fingerprint/);
    expect(fs.existsSync(path.join(other, "cli"))).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("does not compact with a mismatched model or archive a terminal failure as success", async () => {
  for (const mismatch of [true, false]) {
    const calls: string[] = [];
    const client = { events: [], send: () => {},
      request: async (method: string) => { calls.push(method); return { model: mismatch ? "other-model" : "gpt-5.6-sol", reasoningEffort: "medium", thread: { id: "thread-1" } }; },
      waitFor: async () => ({ method: "error", params: { threadId: "thread-1", willRetry: false } }),
    };
    await expect(cli.compactCliSession(client, { history, instructions: "instructions", cwd: process.cwd(), executionTimeoutMs: 1000 })).rejects.toThrow();
    expect(calls).not.toContain("thread/archive");
    if (mismatch) expect(calls).not.toContain("thread/compact/start");
  }
});

test("rejects changed histories, duplicate checkpoints and absent response provenance", () => {
  for (const mutate of [
    (rows: any) => rows[0].payload.cli_version = "different",
    (rows: any) => rows[0].payload.base_instructions.text = "changed",
    (rows: any) => rows[1].payload.content = [],
    (rows: any) => rows.push(structuredClone(rows[2])),
    (rows: any) => rows[2].payload.replacement_history = [],
    (rows: any) => rows[2].payload.latest_token_usage_record.thread_id = "other-thread",
    (rows: any) => { delete rows[2].payload.compaction_response_id; delete rows[2].payload.latest_token_usage_record.response_id; },
  ]) { const rows = structuredClone(rollout()); mutate(rows); expect(() => cli.extractCliCheckpoint(rows, expected)).toThrow(); }
  const rows = structuredClone(rollout());
  expect(() => cli.extractCliCheckpoint(rows, { ...expected, history: [{ ...history[0], id: "original-id" }] })).toThrow();
});
