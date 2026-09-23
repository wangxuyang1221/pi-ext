import { expect, test } from "vitest";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { normalizeContext } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { createSessionCoordinator } from "../src/session-coordinator.js";
import { createBranchInputSnapshot, fullInputForBranch, modelKey, NATIVE_COMPACTION_KIND, FAILED_REQUEST_KIND } from "../src/native-compaction.js";

const providerNames = new Set(["openai", "openai-codex", "opencode"]);
const image = { type: "image", data: "AA==", mimeType: "image/png" };
const model = (id = "gpt-5.6-sol") => getBuiltinModel("openai-codex", id)!;
const assistant = (m: any, content: any[]) => ({ role: "assistant", provider: m.provider, api: m.api, model: m.id, content, stopReason: "toolUse", timestamp: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const messageEntries = (messages: any[]) => messages.map((message, i) => ({ id: `message-${i}`, type: "message", message })) as any[];

test("matches provider wire input after overlapping Pi compactions", async () => {
  const m = model();
  const sm = SessionManager.inMemory(process.cwd());
  const first = sm.appendMessage({ role: "user", content: "U1", timestamp: 1 });
  sm.appendCompaction("C1", first, 0);
  sm.appendMessage({ role: "user", content: "U2", timestamp: 2 });
  sm.appendCompaction("C2", first, 0);
  sm.appendMessage({ role: "user", content: "U3", timestamp: 3 });
  let payload: any;
  const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
  await streamSimple(m, { messages: convertToLlm(sm.buildSessionProjection().messages) }, {
    apiKey, onPayload: value => { payload = value; throw new Error("Stop before network"); },
  }).result();
  expect(payload).toBeDefined();
  const view = createBranchInputSnapshot({ branch: sm.getBranch(), tools: [] }).view(m, "pi-context");
  expect(view.items).toEqual(payload.input);
  expect(JSON.stringify(view.items)).not.toContain("C1");
  expect(JSON.stringify(view.items)).toContain("C2");
});

async function replay(m: any, messages: any[], tools: any[] = []) {
  const current = { role: "user", content: [{ type: "text", text: "continue" }], timestamp: 1 };
  let basePayload: any;
  const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
  await streamSimple(m, normalizeContext({ messages: [...messages, current], tools }), {
    apiKey, onPayload: payload => { basePayload = payload; throw new Error("Stop before network"); },
  }).result();
  expect(basePayload).toBeDefined();
  const input = basePayload.input;
  const checkpoint = { type: "compaction", encrypted_content: "opaque" };
  const branch: any[] = [{ id: "checkpoint", type: "custom", customType: NATIVE_COMPACTION_KIND,
    data: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(m), replacementHistory: [checkpoint] } }, ...messageEntries([...messages, current])];
  const coordinator = createSessionCoordinator({ getBranch: () => branch, getAllTools: () => tools.map(({ constrainedSampling: _, ...info }) => info),
    createCheckpoint: async () => { throw new Error("Unexpected compaction"); }, appendCheckpoint: () => { throw new Error("Unexpected checkpoint"); }, appendCheckpointBypass: () => {} });
  const ctx = { model: m, getSystemPrompt: () => "", sessionManager: { getSessionId: () => "test" }, modelRegistry: { find: () => m } } as any;
  const output = await coordinator.prepareRequest(m, ctx, input as any, basePayload);
  expect(output).toEqual([checkpoint, ...input]);
}

test("replays system prompt and tool updates after a legacy checkpoint and tool completion", async () => {
  const m = model();
  const tool = { name: "read", description: "Read", parameters: { type: "object", properties: {} } };
  await replay(m, [
    { role: "user", content: "old history", timestamp: 0 },
    { role: "system", content: "", sections: { policy: "Keep the new instructions." }, toolsAdded: [tool], timestamp: 1 },
    { role: "user", content: "use the tool", timestamp: 2 },
    assistant(m, [{ type: "toolCall", id: "read|fc_1", name: "read", arguments: {} }]),
    { role: "toolResult", toolCallId: "read|fc_1", toolName: "read", content: [{ type: "text", text: "ok" }], timestamp: 3 },
  ]);
});

test("keeps a system update immediately after a checkpoint across successive requests", async () => {
  const m = model();
  const tool = { name: "read", description: "Read", parameters: { type: "object", properties: {} } };
  const messages: any[] = [{ role: "user", content: "old history", timestamp: 0 }];
  const checkpoint = { type: "compaction", encrypted_content: "opaque" };
  const branch: any[] = [...messageEntries(messages), { id: "checkpoint", type: "custom", customType: NATIVE_COMPACTION_KIND,
    data: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(m), replacementHistory: [checkpoint] } }];
  const coordinator = createSessionCoordinator({ getBranch: () => branch, getAllTools: () => [tool],
    appendFailedRequest: data => branch.push({ id: "failed-marker", type: "custom", customType: FAILED_REQUEST_KIND, data }),
    createCheckpoint: async () => { throw new Error("Unexpected compaction"); }, appendCheckpoint: () => { throw new Error("Unexpected checkpoint"); }, appendCheckpointBypass: () => {} });
  const ctx = { model: m, getSystemPrompt: () => "", sessionManager: { getSessionId: () => "test", getBranch: () => branch }, modelRegistry: { find: () => m } } as any;
  const updates = [
    [{ role: "system", content: "", sections: { policy: "Updated instructions" }, toolsAdded: [tool], timestamp: 1 }, { role: "user", content: "read", timestamp: 2 }],
    [assistant(m, [{ type: "toolCall", id: "read|fc_1", name: "read", arguments: {} }]), { role: "toolResult", toolCallId: "read|fc_1", toolName: "read", content: [{ type: "text", text: "ok" }], timestamp: 3 }],
    [{ role: "user", content: "retry", timestamp: 4 }],
    [{ role: "user", content: "retry again", timestamp: 5 }],
  ];
  for (const batch of updates) {
    for (const message of batch) { messages.push(message); branch.push({ id: `entry-${branch.length}`, type: "message", message }); }
    const input = convertResponsesMessages(m, normalizeContext({ messages }), providerNames, {
      includeSystemPrompt: false, supportsMidConvoSystemMessages: true, supportsAdditionalTools: true,
      toolOptions: { strict: null },
    });
    const output = await coordinator.prepareRequest(m, ctx, input as any, { input });
    const expected = input.slice(1).filter(item => !(branch.some(entry => entry.id === "failed-marker") && item.type !== "function_call" && "role" in item && item.role === "user" && JSON.stringify(item).includes('"retry"')));
    expect(output).toEqual([checkpoint, ...expected]);
    expect(branch.find(entry => entry.id === "checkpoint").data.replacementHistory).toEqual([checkpoint]);
    if (batch[0]?.content === "retry") coordinator.recordFailedRequest(ctx, input as any, { phase: "before_provider_request", code: "history_prefix_mismatch", recoveryAttempted: false });
  }
  expect(branch.find(entry => entry.id === "failed-marker").data).not.toHaveProperty("content");
});

test.each([true, false])("matches system sections and tool state changes, additional tools: %s", async (additional) => {
  const m = { ...model(), compat: { ...model().compat, supportsAdditionalTools: additional, supportsToolSearch: true } };
  const tool = { name: "read", description: "Read", parameters: { type: "object", properties: {} } };
  for (const update of [
    { sections: { policy: "new", removed: null } },
    { toolsAdded: [tool] },
    { sections: { policy: "new" }, toolsAdded: [tool] },
    { toolsRemoved: [{ name: "read" }] },
    { toolsRemoved: [{ name: "read" }], toolsAdded: [{ ...tool, description: "Changed" }] },
  ]) {
    await replay(m, [
      { role: "system", content: "Initial instructions", timestamp: 0 },
      { role: "user", content: "start", timestamp: 1 },
      { role: "system", content: "", ...update, timestamp: 2 },
      assistant(model("gpt-5.5"), [{ type: "text", text: "response after update" }]),
    ]);
  }
});

test.each(["grammar", "json-schema"])("replays constrained tools declared only in system history: %s", async (kind) => {
  const m = model();
  const tool = { name: "run", description: "Run", parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
    constrainedSampling: kind === "grammar" ? { type: "grammar", variants: { openai_regex: ".*" } } : { type: "json-schema", strict: "prefer" } };
  await replay(m, [
    { role: "user", content: "start", timestamp: 0 },
    { role: "system", content: "", toolsAdded: [tool], timestamp: 1 },
    assistant(m, [{ type: "toolCall", id: "run|ctc_1", name: "run", arguments: { input: "hello" } }]),
    { role: "toolResult", toolCallId: "run|ctc_1", toolName: "run", content: [{ type: "text", text: "ok" }], timestamp: 2 },
  ]);
});

test("matches a model that folds system updates into its leading instructions", async () => {
  const m = { ...model(), compat: { ...model().compat, supportsMidConvoSystemMessages: false } };
  await replay(m, [
    { role: "system", content: "Initial", sections: { policy: "old" }, timestamp: 0 },
    { role: "user", content: "start", timestamp: 1 },
    { role: "system", content: "Updated", sections: { policy: "new" }, timestamp: 2 },
    assistant(model("gpt-5.5"), [{ type: "text", text: "answer" }]),
  ]);
});

test.each([10, 100])("reuses each input view for %i messages", (count) => {
  const m = model();
  const branch = messageEntries(Array.from({ length: count }, (_, i) => ({ role: "user", content: [{ type: "text", text: `history-${i}` }], timestamp: i })));
  const snapshot = createBranchInputSnapshot({ branch, tools: [] });
  const first = snapshot.view(m, "full-history");
  expect(snapshot.view(m, "full-history")).toBe(first);
  expect(snapshot.view(m, "effective")).toBe(snapshot.view(m, "pi-context"));
  expect(first.userSources.size).toBe(count);
});

test("replays grammar calls and outputs from Pi payload metadata omitted by getAllTools", async () => {
  const m = model();
  const tool = { name: "grammar", description: "Synthetic grammar", parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] }, constrainedSampling: { type: "grammar", variants: { openai_regex: ".*" } } };
  await replay(m, [assistant(m, [{ type: "toolCall", id: "call|ctc_1", namespace: "functions", name: "grammar", arguments: { input: "hello" } }]),
    { role: "toolResult", toolCallId: "call|ctc_1", toolName: "grammar", content: [{ type: "text", text: "ok" }], timestamp: 0 }], [tool]);
});

test("does not infer current grammar configuration from an old custom-tool id", async () => {
  const m = model();
  await replay(m, [assistant(m, [{ type: "toolCall", id: "call|ctc_1", name: "removed-tool", arguments: { input: "hello" } }]),
    { role: "toolResult", toolCallId: "call|ctc_1", toolName: "removed-tool", content: [{ type: "text", text: "ok" }], timestamp: 0 }]);
});

test.each(["gpt-5.6-sol", "gpt-5.5"])("pairs orphaned grammar calls for source model %s", async (source) => {
  const m = model();
  const tool = { name: "grammar", description: "Synthetic grammar", parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] }, constrainedSampling: { type: "grammar", variants: { openai_regex: ".*" } } };
  await replay(m, [assistant(model(source), [{ type: "toolCall", id: "call:1|ctc_1", name: "grammar", arguments: { input: "hello" } }])], [tool]);
});

test.each(["gpt-5.6-sol", "gpt-5.5"])("pairs function calls and results for source model %s", async (source) => {
  const m = model();
  await replay(m, [assistant(model(source), [{ type: "toolCall", id: "call:1|fc_1", namespace: "functions", name: "read", arguments: {} }]),
    { role: "toolResult", toolCallId: "call:1|fc_1", toolName: "read", content: [{ type: "text", text: "ok" }], timestamp: 0 }]);
});

test.each([true, false])("replays cross-model deferred namespaces and tool definitions, additional tools: %s", async (additional) => {
  const m = { ...model(), compat: { ...model().compat, supportsAdditionalTools: additional, supportsToolSearch: true } };
  const source = model("gpt-5.5");
  const tools = ["load", "read"].map(name => ({ name, description: name, parameters: { type: "object", properties: {} } }));
  await replay(m, [
    assistant(source, [{ type: "toolCall", id: "load|fc_1", name: "load", arguments: {} }]),
    { role: "toolResult", toolCallId: "load|fc_1", toolName: "load", content: [{ type: "text", text: "loaded" }], addedToolNames: ["read"], timestamp: 0 },
    assistant(source, [{ type: "toolCall", id: "read|fc_2", name: "read", namespace: "functions", arguments: {} }]),
    { role: "toolResult", toolCallId: "read|fc_2", toolName: "read", content: [{ type: "text", text: "ok" }], timestamp: 0 },
  ], tools);
});

test.each([
  ["openai", "gpt-5.5", "call_load|fc_1"],
  ["openai", "gpt-5.5", "call:load|item:1"],
  ["openai-codex", "gpt-5.6-sol", "call:load|item:1"],
])("replays normalized deferred tool search behind a valid checkpoint: %s %s %s", async (provider, sourceId, id) => {
  const target = model("gpt-5.5");
  const source = getBuiltinModel(provider, sourceId)!;
  const tools = ["load", "read"].map(name => ({ name, description: name, parameters: { type: "object", properties: {} } }));
  expect(target.compat?.supportsToolSearch).toBe(true);
  expect(target.compat?.supportsAdditionalTools).not.toBe(true);
  await replay(target, [
    assistant(source, [{ type: "toolCall", id, name: "load", arguments: {} }]),
    { role: "toolResult", toolCallId: id, toolName: "load", content: [{ type: "text", text: "loaded" }], addedToolNames: ["read"], timestamp: 0 },
  ], tools);
});

test.each(["x".repeat(80), '{"id":"not-a-v1-signature"}', '"literal"'])("matches Pi text signature IDs: %s", async (textSignature) => {
  const m = model();
  await replay(m, [assistant(m, [{ type: "text", text: "answer", textSignature }])]);
});

test("matches Pi's removal of unpaired surrogates without changing valid emoji", async () => {
  const m = model();
  await replay(m, [{ role: "user", content: [{ type: "text", text: "before\uD800😀after\uDC00" }], timestamp: 0 },
    assistant(m, [{ type: "text", text: "answer\uD800😀" }])]);
});

test("preserves same-model tool namespaces", async () => {
  const m = model();
  await replay(m, [assistant(m, [{ type: "toolCall", id: "call|fc_1", namespace: "functions", name: "read", arguments: {} }]),
    { role: "toolResult", toolCallId: "call|fc_1", toolName: "read", content: [{ type: "text", text: "ok" }], timestamp: 0 }]);
});

test("replays a non-vision tool image using the actual Pi converter payload", async () => {
  const m = model("gpt-5.3-codex-spark");
  await replay(m, [assistant(m, [{ type: "toolCall", id: "call|fc_1", name: "read", arguments: {} }]),
    { role: "toolResult", toolCallId: "call|fc_1", toolName: "read", content: [image, image, { type: "text", text: "caption" }], timestamp: 0 }]);
});

test("replays a non-vision user image using the actual Pi converter payload", async () => {
  await replay(model("gpt-5.3-codex-spark"), [{ role: "user", content: [image, image, { type: "text", text: "caption" }, image], timestamp: 0 }]);
});
