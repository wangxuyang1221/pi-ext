// Shared fixed-boundary continuation; native end-to-end runs use separate drivers.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { assertRunDirectory } from "./codex-compact-quality-runner.mjs";
import { WorkspaceTools, continuationTools, creationContinuationTools, validateCreatePaths, fingerprintWorkspace } from "./codex-compact-quality-tools.mjs";
import { parseContinuationResponse } from "./codex-compact-quality-response.mjs";

export async function runContinuation({ directory, sourceWorkspace, expectedWorkspaceFingerprint,
  initialHistory, instructions, request, allowedPaths, send, signal = /** @type {AbortSignal | undefined} */ (undefined), requestTimeoutMs = 300_000,
  model = "gpt-5.6-sol", effort = "medium", toolDefinitions = /** @type {typeof continuationTools | undefined} */ (undefined), createPaths = /** @type {string[]} */ ([]), captureFinalState = false }) {
  validateCreatePaths(allowedPaths, createPaths);
  allowedPaths = [...allowedPaths]; createPaths = [...createPaths];
  const supportedTools = createPaths.length ? creationContinuationTools : continuationTools;
  toolDefinitions = structuredClone(toolDefinitions ?? supportedTools);
  assert.deepEqual(toolDefinitions.map(tool => tool.name).sort(), supportedTools.map(tool => tool.name).sort(), "Unsupported tool definitions");
  directory = path.join(assertRunDirectory(directory), "continuation");
  sourceWorkspace = assertRunDirectory(sourceWorkspace);
  fs.mkdirSync(directory);
  assert.deepEqual(fingerprintWorkspace(sourceWorkspace), expectedWorkspaceFingerprint, "Source workspace changed");
  const workspacePath = path.join(directory, "workspace");
  fs.cpSync(sourceWorkspace, workspacePath, { recursive: true });
  assert.deepEqual(fingerprintWorkspace(workspacePath), expectedWorkspaceFingerprint, "Copied workspace changed");
  const toolRuntime = new WorkspaceTools(workspacePath, allowedPaths, { createPaths });
  const history = structuredClone(initialHistory);
  const inputHistorySha256 = createHash("sha256").update(JSON.stringify(history)).digest("hex");
  let input = [...history, { type: "message", role: "user", content: [{ type: "input_text", text: request }] }];
  const sessionId = randomUUID();
  const started = performance.now();
  const usageRecords = [];
  const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  save("configuration.json", { model, effort, inputHistorySha256, instructions, request, allowedPaths, ...(createPaths.length ? { createPaths } : {}), requestTimeoutMs, expectedWorkspaceFingerprint, tools: toolDefinitions });
  while (true) {
    signal?.throwIfAborted();
    const index = usageRecords.length;
    const body = { model, instructions, input, store: false, stream: true, tools: toolDefinitions,
      tool_choice: "auto", parallel_tool_calls: true, include: ["reasoning.encrypted_content"],
      reasoning: { effort, summary: "auto" }, text: { verbosity: "low" }, prompt_cache_key: sessionId };
    save(`request-${index}.json`, body);
    const requestStarted = performance.now();
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const response = await send({ body, sessionId, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    fs.writeFileSync(path.join(directory, `response-${index}.sse`), response.wire, { flag: "wx", mode: 0o600 });
    if (!response.ok) throw new Error(`Continuation HTTP ${response.status}`);
    const parsed = parseContinuationResponse(response.wire, toolDefinitions.map(tool => tool.name));
    const usage = { request: index, elapsedMs: performance.now() - requestStarted, usage: parsed.usage };
    save(`usage-${index}.json`, usage); usageRecords.push(usage);
    input = [...input, ...parsed.items];
    if (!parsed.calls.length) {
      const after = fingerprintWorkspace(workspacePath);
      const changedPaths = Object.keys({ ...expectedWorkspaceFingerprint, ...after }).filter(name => expectedWorkspaceFingerprint[name] !== after[name]);
      /** @type {{status: string, answer: string, requests: number, usageRecords: unknown[], tools: unknown[],
       * changedPaths: string[], scopePassed: boolean, elapsedMs: number, inputHistorySha256: string,
       * workspacePath: string, humanReview: string,
       * finalState?: {historyPath: string, historySha256: string, workspacePath: string, workspaceFingerprint: Record<string,string>}}} */
      const result = { status: "completed", answer: parsed.answer, requests: usageRecords.length, usageRecords,
        tools: toolRuntime.events, changedPaths, scopePassed: changedPaths.every(name => allowedPaths.includes(name)),
        elapsedMs: performance.now() - started, inputHistorySha256, workspacePath, humanReview: "pending" };
      if (captureFinalState) {
        save("final-history.json", input);
        result.finalState = { historyPath: path.join(directory, "final-history.json"),
          historySha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
          workspacePath, workspaceFingerprint: after };
      }
      save("result.json", result);
      return result;
    }
    for (const call of parsed.calls) {
      signal?.throwIfAborted();
      const output = toolRuntime.execute(call.name, JSON.parse(call.arguments));
      save(`tool-${index}-${toolRuntime.events.length - 1}.json`, toolRuntime.events.at(-1));
      input.push({ type: "function_call_output", call_id: call.call_id, output });
    }
  }
}
