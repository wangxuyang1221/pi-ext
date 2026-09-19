import { expect, test, vi } from "vitest";
import * as native from "../src/native-compaction.js";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { createSessionCoordinator } from "../src/session-coordinator.js";
import { fullInputForBranch, modelKey, NATIVE_COMPACTION_KIND } from "../src/native-compaction.js";

const providerNames = new Set(["openai", "openai-codex", "opencode"]);
const image = { type: "image", data: "AA==", mimeType: "image/png" };
const model = (id = "gpt-5.6-sol") => getBuiltinModel("openai-codex", id)!;
const assistant = (m: any, content: any[]) => ({ role: "assistant", provider: m.provider, api: m.api, model: m.id, content, stopReason: "toolUse", timestamp: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const messageEntries = (messages: any[]) => messages.map((message, i) => ({ id: `message-${i}`, type: "message", message })) as any[];

async function replay(m: any, messages: any[], tools: any[] = []) {
  const current = { role: "user", content: [{ type: "text", text: "continue" }], timestamp: 1 };
  let basePayload: any;
  const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
  await streamSimple(m, { messages: [...messages, current], tools } as any, {
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

test.each([10, 100])("does not rebuild identical raw history views for %i messages", async (count) => {
  const spy = vi.spyOn(native, "fullInputForBranch");
  try {
    await replay(model(), Array.from({ length: count }, (_, i) => ({ role: "user", content: [{ type: "text", text: `history-${i}` }], timestamp: i })));
    expect(spy).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
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
