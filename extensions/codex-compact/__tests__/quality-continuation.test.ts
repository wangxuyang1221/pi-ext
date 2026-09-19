import { expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as continuation from "../../../scripts/codex-compact-quality-continuation.mjs";
import { continuationTools, creationContinuationTools, fingerprintWorkspace } from "../../../scripts/codex-compact-quality-tools.mjs";

const wire = (items: unknown[]) => [...items.map(item => ({ type: "response.output_item.done", item })), { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } }].map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
const message = { type: "message", role: "assistant", content: [{ type: "output_text", text: "已修改。" }] };
function fixture() {
  const parent = path.join(process.cwd(), ".tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "quality-continuation-"));
  const sourceWorkspace = path.join(root, "source"); fs.mkdirSync(sourceWorkspace); fs.writeFileSync(path.join(sourceWorkspace, "code.txt"), "before");
  const directory = path.join(root, "job"); fs.mkdirSync(directory);
  return { root, options: { directory, sourceWorkspace, expectedWorkspaceFingerprint: fingerprintWorkspace(sourceWorkspace), initialHistory: [], instructions: "继续任务。", request: "修改 code.txt。", allowedPaths: ["code.txt"] } };
}

test("creates its temporary parent in a clean working directory", () => {
  const parent = path.join(process.cwd(), ".tmp");
  fs.mkdirSync(parent, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(parent, "quality-continuation-isolation-"));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(sandbox);
  try {
    expect(fs.existsSync(path.join(sandbox, ".tmp"))).toBe(false);
    const { root, options } = fixture();
    expect(path.dirname(root)).toBe(path.join(sandbox, ".tmp"));
    expect(fs.readFileSync(path.join(options.sourceWorkspace, "code.txt"), "utf8")).toBe("before");
  } finally {
    cwd.mockRestore();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("continues from an isolated copy using real controlled file tools and retained request evidence", async () => {
  expect(typeof continuation.runContinuation).toBe("function");
  const { root, options } = fixture();
  try {
    let calls = 0;
    const result = await continuation.runContinuation({ ...options, send: async ({ body }: any) => {
      calls++;
      expect(body.model).toBe("gpt-5.6-sol"); expect(body.reasoning.effort).toBe("medium");
      expect(body.tools).toEqual(continuationTools);
      if (calls === 1) return { ok: true, status: 200, wire: wire([{ type: "function_call", call_id: "edit-1", name: "replace_text", arguments: JSON.stringify({ path: "code.txt", old_text: "before", new_text: "after" }) }]) };
      expect(body.input.at(-1)).toEqual({ type: "function_call_output", call_id: "edit-1", output: "Replacement applied." });
      return { ok: true, status: 200, wire: wire([message]) };
    } });
    expect(result.requests).toBe(2); expect(result.changedPaths).toEqual(["code.txt"]);
    expect(result.scopePassed).toBe(true); expect(result.humanReview).toBe("pending");
    expect(result.usageRecords.map((row: any) => row.usage.input)).toEqual([100, 100]);
    expect(fs.readFileSync(path.join(options.sourceWorkspace, "code.txt"), "utf8")).toBe("before");
    expect(fs.readFileSync(path.join(result.workspacePath, "code.txt"), "utf8")).toBe("after");
    expect(fs.existsSync(path.join(options.directory, "continuation/response-0.sse"))).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(options.directory, "continuation/configuration.json"), "utf8"));
    expect(config).not.toHaveProperty("createPaths");
    expect(config.tools).toEqual(continuationTools);
    await expect(continuation.runContinuation({ ...options, send: async () => { throw new Error("Must not run"); } })).rejects.toThrow();
    expect(calls).toBe(2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("rejects invalid creation scopes and tool profiles without copying the workspace or sending a request", async () => {
  const { root, options } = fixture();
  try {
    let calls = 0;
    for (const override of [
      { createPaths: ["new.txt"] }, { createPaths: null }, { createPaths: "code.txt" },
      { createPaths: ["code.txt", "code.txt"] }, { toolDefinitions: creationContinuationTools },
      { createPaths: ["code.txt"], toolDefinitions: continuationTools },
    ]) {
      await expect(continuation.runContinuation({ ...options, ...override, send: async () => { calls++; throw new Error("Unexpected transport"); } })).rejects.toThrow(/creation permissions|tool definitions/);
      expect(calls).toBe(0);
      expect(fs.readdirSync(options.directory)).toEqual([]);
      expect(fingerprintWorkspace(options.sourceWorkspace)).toEqual(options.expectedWorkspaceFingerprint);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("opts into scoped file creation and asset copies without changing the shared baseline", async () => {
  const { root, options } = fixture();
  try {
    const bytes = Buffer.from([0, 255, 7]);
    fs.writeFileSync(path.join(options.sourceWorkspace, "icon.bin"), bytes);
    const createPaths = ["new-skin/src/client.ts", "new-skin/assets/icon.bin"];
    let calls = 0;
    const result = await continuation.runContinuation({ ...options, expectedWorkspaceFingerprint: fingerprintWorkspace(options.sourceWorkspace),
      allowedPaths: [...options.allowedPaths, ...createPaths], createPaths, captureFinalState: true, send: async ({ body }: any) => {
        calls++;
        expect(body.tools.map((tool: any) => tool.name)).toEqual(["read_file", "replace_text", "write_file", "copy_file"]);
        if (calls === 1) return { ok: true, status: 200, wire: wire([
          { type: "function_call", call_id: "create", name: "write_file", arguments: JSON.stringify({ path: createPaths[0], content: "export const title = 'prototype';" }) },
          { type: "function_call", call_id: "copy", name: "copy_file", arguments: JSON.stringify({ source_path: "icon.bin", path: createPaths[1] }) },
        ]) };
        expect(body.input.slice(-2).map((item: any) => item.output)).toEqual(["File created.", "File copied."]);
        return { ok: true, status: 200, wire: wire([message]) };
      } });
    expect(calls).toBe(2);
    expect(result.changedPaths.sort()).toEqual([...createPaths].sort());
    expect(result.scopePassed).toBe(true);
    expect(result.humanReview).toBe("pending");
    expect(fs.existsSync(path.join(options.sourceWorkspace, "new-skin"))).toBe(false);
    expect(fs.readFileSync(path.join(result.workspacePath, createPaths[1]))).toEqual(bytes);
    expect(result.finalState.workspaceFingerprint).toEqual(fingerprintWorkspace(result.workspacePath));
    const config = JSON.parse(fs.readFileSync(path.join(options.directory, "continuation/configuration.json"), "utf8"));
    expect(config.createPaths).toEqual(createPaths);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("captures the complete verified continuation state for a later compaction without changing the baseline", async () => {
  const { root, options } = fixture();
  try {
    const checkpoint = { type: "compaction", encrypted_content: "first-checkpoint" };
    const result = await continuation.runContinuation({ ...options, initialHistory: [checkpoint], captureFinalState: true,
      send: async ({ body }: any) => ({ ok: true, status: 200, wire: wire(body.input.some((item: any) => item.type === "function_call_output") ? [message] : [
        { type: "function_call", call_id: "chain-edit", name: "replace_text", arguments: JSON.stringify({ path: "code.txt", old_text: "before", new_text: "after" }) }
      ]) }) });
    expect(result.finalState).toBeDefined();
    const history = JSON.parse(fs.readFileSync(result.finalState.historyPath, "utf8"));
    expect(history).toHaveLength(5);
    expect(history[0]).toEqual(checkpoint);
    expect(history[2].call_id).toBe("chain-edit");
    expect(history[3]).toEqual({ type: "function_call_output", call_id: "chain-edit", output: "Replacement applied." });
    expect(history[4]).toEqual(message);
    expect(result.finalState.workspaceFingerprint).toEqual(fingerprintWorkspace(result.workspacePath));
    expect(result.finalState.workspacePath).toBe(result.workspacePath);
    expect(result.finalState.historySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(path.join(options.sourceWorkspace, "code.txt"), "utf8")).toBe("before");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("retains failed HTTP evidence and never retries it silently", async () => {
  const { root, options } = fixture();
  try {
    let calls = 0;
    await expect(continuation.runContinuation({ ...options, send: async () => { calls++; return { ok: false, status: 503, wire: "unavailable" }; } })).rejects.toThrow("HTTP 503");
    expect(calls).toBe(1);
    expect(fs.readFileSync(path.join(options.directory, "continuation/response-0.sse"), "utf8")).toBe("unavailable");
    expect(fs.existsSync(path.join(options.directory, "continuation/result.json"))).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("passes a real per-request abort signal without substituting an observation deadline", async () => {
  const { root, options } = fixture();
  try {
    let calls = 0;
    await expect(continuation.runContinuation({ ...options, requestTimeoutMs: 20, send: async ({ signal }: any) => {
      calls++;
      return await new Promise((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); signal.throwIfAborted(); });
    } })).rejects.toThrow();
    expect(calls).toBe(1);
    expect(fs.existsSync(path.join(options.directory, "continuation/request-0.json"))).toBe(true);
    expect(fs.existsSync(path.join(options.directory, "continuation/result.json"))).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("validates all output tool calls before applying the first edit", async () => {
  const { root, options } = fixture();
  try {
    const edit = { type: "function_call", call_id: "edit-1", name: "replace_text", arguments: JSON.stringify({ path: "code.txt", old_text: "before", new_text: "after" }) };
    await expect(continuation.runContinuation({ ...options, send: async () => ({ ok: true, status: 200, wire: wire([edit, { ...edit, call_id: "bad", name: "shell" }]) }) })).rejects.toThrow(/Unsupported/);
    expect(fs.readFileSync(path.join(options.directory, "continuation/workspace/code.txt"), "utf8")).toBe("before");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("rejects a symlink source root rather than modifying the shared baseline through the copy", async () => {
  const { root, options } = fixture();
  try {
    const alias = path.join(root, "alias"); fs.symlinkSync(options.sourceWorkspace, alias);
    let calls = 0;
    await expect(continuation.runContinuation({ ...options, sourceWorkspace: alias, send: async () => { calls++; return { ok: true, status: 200, wire: wire([message]) }; } })).rejects.toThrow(/symlink/i);
    expect(calls).toBe(0);
    expect(fs.readFileSync(path.join(options.sourceWorkspace, "code.txt"), "utf8")).toBe("before");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
