import { expect, test } from "vitest";
import * as importer from "../../../scripts/codex-compact-quality-history.mjs";

test("imports native-tool archives with auditable derived pairing and explicit reasoning projections", () => {
  const messages = [{ role: "system", content: "Historical runtime instructions" }, { role: "user", content: "Fix the code" },
    { role: "assistant", content: "Inspect the file", reasoning_content: "A prior hypothesis, not verified", tool_calls: [
      { type: "function", id: "source-call-1", function: { name: "execute_bash", arguments: '{"command":"cat source.py"}' } }
    ] }, { role: "tool", content: "source content" }, { role: "assistant", content: "Need a minimal fix", reasoning_content: "Preserve compatibility" }];
  const saved = structuredClone(messages);
  const result = importer.importOpenSweMessages(messages, { reasoningPolicy: "retain-as-quoted-text" });
  expect(result.history.map((item: any) => item.type)).toEqual(["message", "message", "message", "message", "function_call", "function_call_output", "message", "message"]);
  expect(result.history[4]).toEqual({ type: "function_call", call_id: "source-call-1", name: "execute_bash", arguments: '{"command":"cat source.py"}' });
  expect(result.history[5]).toEqual({ type: "function_call_output", call_id: "source-call-1", output: "source content" });
  expect(result.history[2].content[0].text).toContain(messages[2].reasoning_content);
  expect(result.derivedToolAssociations).toEqual([{ sourceMessageIndex: 3, callId: "source-call-1", rule: "single-pending-call" }]);
  expect(result.history.some((item: any) => item.type === "reasoning")).toBe(false);
  expect(result.originalActiveInputVerified).toBe(false);
  expect(result.omittedFields).toEqual([]);
  expect(result.completeBoundaries).toEqual([2, 4, 5]);
  const without = importer.importOpenSweMessages(messages, { reasoningPolicy: "exclude-archive-reasoning" });
  expect(without.history).toHaveLength(6);
  expect(without.omittedFields.map((row: any) => row.sourceMessageIndex)).toEqual([2, 4]);
  expect(without.sourceSha256).toBe(result.sourceSha256);
  expect(without.reasoningPolicy).not.toBe(result.reasoningPolicy);
  expect(messages).toEqual(saved);
  expect(importer.importOpenSweMessages(messages, { reasoningPolicy: "retain-as-quoted-text" })).toEqual(result);
  expect(() => importer.importOpenSweMessages(messages)).toThrow(/reasoning policy/i);
});

test("rejects lossy native-tool imports and never guesses ambiguous output associations", () => {
  const base: any[] = [{ role: "system", content: "environment" }, { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [{ type: "function", id: "a", function: { name: "execute_bash", arguments: "invalid-json-is-historical-evidence" } }] },
    { role: "tool", content: "Malformed arguments were rejected by the historical tool" }];
  const options = { reasoningPolicy: "retain-as-quoted-text" };
  const imported = importer.importOpenSweMessages(base, options);
  expect(imported.history[2].arguments).toBe("invalid-json-is-historical-evidence");
  for (const mutate of [
    (rows: any[]) => rows[2].new_instruction_field = "must not silently disappear",
    (rows: any[]) => rows[2].tool_calls[0].function.new_argument_metadata = "must not disappear",
    (rows: any[]) => rows[2].think = "not-a-boolean",
    (rows: any[]) => rows[3].role = "developer",
    (rows: any[]) => rows[3].content = [{ type: "image" }],
    (rows: any[]) => rows[2].reasoning_content = { text: "unsupported" },
    (rows: any[]) => rows[1].tool_calls = rows[2].tool_calls,
    (rows: any[]) => rows.pop(),
    (rows: any[]) => rows.splice(2, 1),
    (rows: any[]) => rows[3].tool_call_id = "unknown",
    (rows: any[]) => rows[2].tool_calls.push({ ...rows[2].tool_calls[0] }),
    (rows: any[]) => rows[2].tool_calls.push({ ...rows[2].tool_calls[0], id: "b" }),
    (rows: any[]) => rows.push({ role: "system", content: "replacement environment" }),
  ]) {
    const rows = structuredClone(base); mutate(rows); expect(() => importer.importOpenSweMessages(rows, options)).toThrow();
  }
  const parallel = structuredClone(base);
  parallel[2].tool_calls.push({ type: "function", id: "b", function: { name: "read_file", arguments: '{}' } });
  parallel[3].tool_call_id = "b";
  parallel.push({ role: "tool", content: "first call output", tool_call_id: "a" });
  const paired = importer.importOpenSweMessages(parallel, options);
  expect(paired.derivedToolAssociations).toEqual([]);
  expect(paired.history.filter((item: any) => item.type === "function_call_output").map((item: any) => item.call_id)).toEqual(["b", "a"]);
});

test("checks archived tool names against explicit call IDs without dropping conflicting metadata", () => {
  const messages: any[] = [{ role: "system", content: "environment", name: null }, { role: "user", content: "task", name: null },
    { role: "assistant", content: null, name: null, tool_calls: [{ type: "function", id: "a", function: { name: "execute_bash", arguments: "{}" } }] },
    { role: "tool", content: "observation", name: "execute_bash", tool_call_id: "a" }];
  const options = { reasoningPolicy: "exclude-archive-reasoning" };
  const result = importer.importOpenSweMessages(messages, options);
  expect(result.derivedToolAssociations).toEqual([]);
  expect(result.history.at(-1)).toEqual({ type: "function_call_output", call_id: "a", output: "observation" });
  for (const mutate of [
    (rows: any[]) => rows[3].name = "different_tool",
    (rows: any[]) => rows[3].name = 123,
    (rows: any[]) => rows[3].name = "",
    (rows: any[]) => rows[1].name = "another_user",
    (rows: any[]) => rows[1].tool_call_id = "a",
  ]) {
    const rows = structuredClone(messages); mutate(rows);
    expect(() => importer.importOpenSweMessages(rows, options)).toThrow();
  }
});

test("imports historical observations as tool results rather than user instructions", () => {
  expect(typeof importer.importSwePrefix).toBe("function");
  const input = [
    { role: "system", text: null, system_prompt: "Legacy editor interface." },
    { role: "user", text: "Fix the failing task." },
    { role: "ai", text: "Inspect the source.\n\n```\nopen source.py\n```" },
    { role: "user", text: "[File: /repo/source.py]\n1:broken()" },
  ];
  const { history, provenance } = importer.importSwePrefix(input);
  expect(history.map((item: any) => item.type)).toEqual(["message", "message", "message", "function_call", "function_call_output"]);
  expect(history[3].name).toBe("historical_shell");
  expect(JSON.parse(history[3].arguments)).toEqual({ command: "open source.py" });
  expect(history[4].call_id).toBe(history[3].call_id);
  expect(history[4].output).toBe(input[3].text);
  expect(provenance[4].sourceMessageIndex).toBe(3);
});

test("rejects incomplete turns and ambiguous action code blocks", () => {
  const prefix = [{ role: "system", system_prompt: "legacy" }, { role: "user", text: "task" }];
  expect(() => importer.importSwePrefix([...prefix, { role: "ai", text: "```\nread source\n```" }])).toThrow("complete");
  for (const text of ["no action", "```\nfirst\n```\n```\nsecond\n```", "```python\nrun()\n```", "```\nread source\n```\nafterward\n```incomplete"]) {
    expect(() => importer.importSwePrefix([...prefix, { role: "ai", text }, { role: "user", text: "observation" }])).toThrow("action");
  }
});

test("preserves trailing assistant prose around a single historical action without treating it as another command", () => {
  const input = [{ role: "system", system_prompt: "legacy" }, { role: "user", text: "task" },
    { role: "ai", text: 'Search for the source.\n\n```\nsearch_dir "CPUtime" .\n```\nPlease wait while searching...' },
    { role: "user", text: "Found 4 matches." }];
  const { history, provenance } = importer.importSwePrefix(input);
  expect(history.map((item: any) => item.type)).toEqual(["message", "message", "message", "function_call", "message", "function_call_output"]);
  expect(history[2].content[0].text).toBe("Search for the source.");
  expect(JSON.parse(history[3].arguments).command).toBe('search_dir "CPUtime" .');
  expect(history[4].content[0].text).toBe("Please wait while searching...");
  expect(history[5].output).toBe(input[3].text);
  expect(history[5].call_id).toBe(history[3].call_id);
  expect(provenance[4].sourceMessageIndex).toBe(2);
  expect(provenance[4].transformation).toBe("historical_trailing_commentary");
});

test("does not mutate source messages and gives repeatable action identifiers", () => {
  const source = [{ role: "system", system_prompt: "legacy" }, { role: "user", text: "task" },
    { role: "ai", text: "```bash\nopen source.py\n```" }, { role: "user", text: "contents" }];
  const saved = structuredClone(source);
  expect(importer.importSwePrefix(source)).toEqual(importer.importSwePrefix(source));
  expect(source).toEqual(saved);
});
