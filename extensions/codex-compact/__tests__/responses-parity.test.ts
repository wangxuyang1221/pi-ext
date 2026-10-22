import { fixtureSnapshot, resolveFixtureHashes } from "./fixtures/compaction-metadata.js";
import { expect, test, vi } from "vitest";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { normalizeContext } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { createSessionCoordinator } from "../src/session-coordinator.js";
import { resolveRequestProjection } from "../src/request-projection.js";
import { createNativeCheckpoint } from "../src/remote-compaction.js";
import { createBranchInputSnapshot, fullInputForBranch, HistoryPrefixMismatchError, modelKey, NATIVE_COMPACTION_KIND, FAILED_REQUEST_KIND } from "../src/native-compaction.js";

const providerNames = new Set(["openai", "openai-codex", "opencode"]);
const image = { type: "image", data: "AA==", mimeType: "image/png" };
const model = (id = "gpt-5.6-sol") => getBuiltinModel("openai-codex", id)!;
const assistant = (m: any, content: any[]) => ({ role: "assistant", provider: m.provider, api: m.api, model: m.id, content, stopReason: "toolUse", timestamp: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const messageEntries = (messages: any[]) => messages.map((message, i) => ({ id: `message-${i}`, type: "message", message })) as any[];

test.each([401, 403, 503])("classifies empty HTTP %i through automatic remote compaction", async status => {
  const m = model();
  const messages = [{ role: "system", content: "head", timestamp: 0 }, { role: "user", content: "history", timestamp: 1 },
    { ...assistant(m, [{ type: "text", text: "done" }]), stopReason: "stop" }, { role: "user", content: "pending", timestamp: 2 }];
  const branch = messageEntries(messages);
  const payload = await providerPayload(m, messages);
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status }));
  const append = vi.fn(), softFailure = vi.fn();
  const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => [],
    shouldAutoCompact: () => true, createCheckpoint: params => createNativeCheckpoint({ ...params, allTools: [], activeToolNames: [] }),
    appendCheckpoint: append, appendCheckpointBypass: vi.fn(), onAutomaticCompactionFailure: softFailure });
  const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
  try {
    const request = coordinator.prepareRequest(m, { model: m, getSystemPrompt: () => "head", sessionManager: { getSessionId: () => "test" },
      modelRegistry: { find: () => m, getApiKeyAndHeaders: async () => ({ ok: true, apiKey }) } } as any, payload.input, payload);
    if (status === 503) await expect(request).resolves.toBeUndefined();
    else await expect(request).rejects.toMatchObject({ compactionHttpStatus: status });
    expect(fetch).toHaveBeenCalledTimes(status === 503 ? 3 : 1);
    expect(append).not.toHaveBeenCalled();
    expect(softFailure).toHaveBeenCalledTimes(status === 503 ? 1 : 0);
  } finally { fetch.mockRestore(); }
});

test.each([[false, "normal"], [true, "normal"], [true, "hidden"], [true, "forced"], [true, "both"]] as const)("sanitizes a complete provider payload before projection with checkpoint=%s and %s", async (checkpoint, mode) => {
  const m = { ...model(), compat: { supportsAdditionalTools: true, supportsMidConvoSystemMessages: true } };
  const tools = ["visible", "hidden"].map(name => ({ name, description: name, parameters: { type: "object", properties: {} } }));
  const sm = SessionManager.inMemory(process.cwd());
  sm.appendMessage({ role: "system", content: "head", toolsAdded: tools, timestamp: 0 } as any);
  if (checkpoint) {
    sm.appendMessage({ role: "user", content: "old", timestamp: 1 });
    sm.appendCustomEntry(NATIVE_COMPACTION_KIND, { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(m),
      replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }] });
  }
  const failed = sm.appendMessage({ role: "user", content: "same", timestamp: 2 });
  sm.appendCustomEntry(FAILED_REQUEST_KIND, { kind: FAILED_REQUEST_KIND, entryId: failed });
  const second = sm.appendMessage({ role: "user", content: "same", timestamp: 3 });
  sm.appendCustomEntry(FAILED_REQUEST_KIND, { kind: FAILED_REQUEST_KIND, entryId: second });
  sm.appendMessage({ role: "user", content: "same", timestamp: 3 });
  const hidden = mode === "hidden" || mode === "both", forced = mode === "forced" || mode === "both";
  const messages = convertToLlm(sm.buildSessionProjection().messages).map(message => message.role === "system" ? { ...message,
    ...(forced ? { content: "Forced prompt" } : {}), toolsAdded: message.toolsAdded?.filter(tool => !hidden || tool.name !== "hidden") } : message);
  const payload = await providerPayload(m, messages);
  const compact = vi.fn();
  const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => sm.getBranch(), getAllTools: () => tools as any,
    createCheckpoint: compact, appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn() });
  const output = await coordinator.prepareRequest(m, { model: m, getSystemPrompt: () => "head", sessionManager: sm, modelRegistry: { find: () => m } } as any, payload.input, payload);
  expect(output).toEqual([...(checkpoint ? [{ type: "compaction", encrypted_content: "opaque" }] : []),
    { role: "user", content: [{ type: "input_text", text: "same" }] }]);
  expect(compact).not.toHaveBeenCalled();
  expect(payload.input.filter((item: any) => item.role === "user" && item.content[0].text === "same")).toHaveLength(3);
  await expect(coordinator.recoverCurrentModel(m, { model: m, getSystemPrompt: () => "head", sessionManager: sm, modelRegistry: { find: () => m } } as any, payload, payload.input)).resolves.toBeUndefined();
  const changed = structuredClone(payload);
  changed.input.at(-1).content[0].text = "unauthorized edit";
  await expect(coordinator.prepareRequest(m, { model: m, getSystemPrompt: () => "head", sessionManager: sm, modelRegistry: { find: () => m } } as any, changed.input, changed)).rejects.toThrow();
});

test.each(["prepare", "recover"])("rejects changed raw failed-request evidence during %s", async entry => {
  for (const phase of ["metadata", "remote success", "remote error", "remote fallback"]) for (const change of ["failed user", "marker", "new marker"]) {
    const m = model(), old = model("gpt-5.5");
    const messages = [{ role: "system", content: "head", timestamp: 0 }, { role: "user", content: "history", timestamp: 1 },
      { ...assistant(old, [{ type: "text", text: "done" }]), stopReason: "stop" },
      { role: "user", content: "failed", timestamp: 2 }, { role: "user", content: "current", timestamp: 3 }];
    const branch = messageEntries(messages);
    branch.splice(3, 0, { id: "checkpoint", type: "custom", customType: NATIVE_COMPACTION_KIND,
      data: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(old), compHash: "2911", replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }] } });
    const marker = { id: "marker", type: "custom", customType: FAILED_REQUEST_KIND, data: { kind: FAILED_REQUEST_KIND, entryId: "message-3" } };
    branch.splice(5, 0, marker);
    const payload = await providerPayload(m, messages);
    const mutate = () => {
      if (change === "failed user") (branch.find(item => item.id === "message-3") as any).message.content = "edited failed input";
      else if (change === "marker") marker.data.entryId = "changed-target";
      else branch.push({ ...marker, id: "new-marker" });
    };
    const remoteError = Object.assign(new Error("remote failed"), { retryWithCurrentModel: phase === "remote fallback" });
    const compact = vi.fn(async () => { mutate(); if (phase === "remote error" || phase === "remote fallback") throw remoteError;
      return { details: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(m), replacementHistory: [{ type: "compaction", encrypted_content: "new" }] } }; });
    const append = vi.fn(), bypass = vi.fn();
    const coordinator = createSessionCoordinator({ resolveCompactionHashes: async () => { if (phase === "metadata") mutate(); return fixtureSnapshot; },
      getBranch: () => branch, getAllTools: () => [], createCheckpoint: compact as any, appendCheckpoint: append, appendCheckpointBypass: bypass });
    const ctx = { model: m, getSystemPrompt: () => "head", sessionManager: { getSessionId: () => "test" },
      modelRegistry: { find: (_provider: string, id: string) => [m, old].find(selected => selected.id === id) } } as any;
    const result = entry === "prepare" ? coordinator.prepareRequest(m, ctx, payload.input, payload) : coordinator.recoverCurrentModel(m, ctx, payload, payload.input);
    if (phase === "remote error") await expect(result, `${entry}/${phase}/${change}`).rejects.toBe(remoteError);
    else await expect(result, `${entry}/${phase}/${change}`).rejects.toThrow(/changed/);
    expect(compact).toHaveBeenCalledTimes(phase === "metadata" ? 0 : 1);
    expect(append).not.toHaveBeenCalled();
    expect(bypass).not.toHaveBeenCalled();
  }
});

test("uses the observed hidden projection for automatic compaction before the first checkpoint", async () => {
  const m = { ...model(), compat: { supportsAdditionalTools: true, supportsMidConvoSystemMessages: true } };
  const tools = ["visible", "hidden"].map(name => ({ name, description: name, parameters: { type: "object", properties: {} } }));
  const messages: any[] = [{ role: "system", content: "head", toolsAdded: tools.slice(0, 1), timestamp: 0 },
    { role: "user", content: "old", timestamp: 1 }, assistant(m, [{ type: "text", text: "answer" }]),
    { role: "system", content: "later", toolsAdded: tools.slice(1), timestamp: 2 }, { role: "user", content: "pending", timestamp: 3 }];
  const payload = await providerPayload(m, messages.map(message => message.role === "system" ? { ...message, toolsAdded: message.toolsAdded?.filter((tool: any) => tool.name === "visible") } : message));
  const branch = messageEntries(messages);
  const inputs: any[] = [];
  const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => tools as any,
    shouldAutoCompact: () => true, createCheckpoint: async ({ input }) => { inputs.push(input); return { details: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(m), replacementHistory: [{ type: "compaction", encrypted_content: "new" }] } }; },
    appendCheckpoint: data => branch.push({ id: "checkpoint", type: "custom", customType: NATIVE_COMPACTION_KIND, data }), appendCheckpointBypass: vi.fn() });
  const output = await coordinator.prepareRequest(m, { model: m, getSystemPrompt: () => "head", sessionManager: { getSessionId: () => "test" }, modelRegistry: { find: () => m } } as any, payload.input, payload);
  expect(inputs).toHaveLength(1);
  expect(JSON.stringify(inputs[0])).not.toContain("pending");
  expect(output?.filter(item => item.role === "user")).toEqual([payload.input.at(-1)]);
});

test("rejects unobservable hidden redeclaration policies even when forced collapse matches the wire", async () => {
  const m = { ...model(), compat: { supportsAdditionalTools: true, supportsMidConvoSystemMessages: true } };
  const tool = { name: "hidden", description: "hidden", parameters: { type: "object", properties: {} } };
  const messages: any[] = [{ role: "system", content: "head", toolsAdded: [tool], timestamp: 0 },
    { role: "user", content: "old", timestamp: 0 },
    { role: "system", content: "", toolsAdded: [{ ...tool, description: "changed" }], timestamp: 0 },
    { role: "user", content: "new", timestamp: 0 }];
  const payload = await providerPayload(m, messages.filter(message => message.role !== "system").toSpliced(0, 0, { role: "system", content: "head", timestamp: 0 }));
  expect(() => resolveRequestProjection(messageEntries(messages), m, [tool] as any, payload.input, payload)).toThrow();
});

test("retains a complete crossing tool group without resurrecting held pre-checkpoint systems", () => {
  const m = model();
  const messages: any[] = [
    { role: "system", content: "head", timestamp: 0 },
    { role: "user", content: "old task", timestamp: 0 },
    assistant(m, ["a", "b"].map(id => ({ type: "toolCall", id: `${id}|fc_${id}`, name: "read", arguments: {} }))),
    { role: "toolResult", toolCallId: "a|fc_a", toolName: "read", content: [{ type: "text", text: "A" }], timestamp: 0 },
    { role: "system", content: "already covered", timestamp: 0 },
    { role: "toolResult", toolCallId: "b|fc_b", toolName: "read", content: [{ type: "text", text: "B" }], timestamp: 0 },
    { role: "user", content: "continue", timestamp: 0 },
  ];
  const branch = messageEntries(messages);
  const opaque = { type: "compaction", encrypted_content: "opaque" };
  branch.splice(5, 0, { id: "checkpoint", type: "custom", customType: NATIVE_COMPACTION_KIND,
    data: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(m), replacementHistory: [opaque] } });
  const view = createBranchInputSnapshot({ branch, tools: [] }).view(m, "effective");
  const full = createBranchInputSnapshot({ branch, tools: [] }).view(m, "full-history");
  expect(view.items).toEqual([opaque, ...full.items.filter(item => item.type === "function_call" || item.type === "function_call_output" || (item.role === "user" && JSON.stringify(item).includes("continue")))]);
  expect([...view.userSources.values()]).toEqual(["message-6"]);
});

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

async function providerPayload(m: any, messages: any[], tools: any[] = []) {
  let payload: any;
  const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network is forbidden"));
  try {
    await streamSimple(m, normalizeContext({ messages, tools }), {
      apiKey, onPayload: value => { payload = value; throw new Error("Stop before network"); },
    }).result();
    expect(payload).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    return payload;
  } finally {
    fetch.mockRestore();
  }
}

test.each(["native", "ordinary-then-custom", "overlap"])("preserves Pi system projection and sources after %s checkpoint", async (shape) => {
  const m = model();
  const sm = SessionManager.inMemory(process.cwd());
  sm.appendMessage({ role: "system", content: "", sections: { rules: "Old rules" }, timestamp: 0 });
  sm.appendMessage({ role: "user", content: "earlier", timestamp: 1 });
  const kept = sm.appendMessage({ role: "user", content: "retained", timestamp: 2 });
  sm.appendMessage({ role: "system", content: "", sections: { rules: "New rules" }, timestamp: 3 });
  sm.appendMessage({ role: "user", content: "also retained", timestamp: 4 });
  const details = { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(m), replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }] };
  sm.appendCompaction("summary", kept, 100, shape === "native" ? details : undefined);
  if (shape === "overlap") sm.appendCompaction("new summary", kept, 100);
  if (shape !== "native") sm.appendCustomEntry(NATIVE_COMPACTION_KIND, details);
  sm.appendMessage({ role: "user", content: "continue", timestamp: 5 });
  const projection = sm.buildSessionProjection();
  const expected = await providerPayload(m, convertToLlm(projection.messages.filter(message => message.role !== "compactionSummary")));
  const view = createBranchInputSnapshot({ branch: sm.getBranch(), tools: [] }).view(m, "pi-context");
  expect(view.items).toEqual(expected.input);
  expect([...view.userSources.values()]).toEqual(projection.entries.filter(entry => entry.messages.some(message => message.role === "user")).map(entry => entry.sourceEntry.id));
});

test.each(["orphan", "real", "partial", "two-systems"])("orders pending calls before held systems: %s", async (shape) => {
  for (const search of [false, true]) {
    const m = { ...model(), compat: { ...model().compat, supportsAdditionalTools: !search, supportsToolSearch: search } };
    const tool = (name: string) => ({ name, description: name, parameters: { type: "object", properties: {} } });
    const call = (id: string) => ({ type: "toolCall", id, name: "read", arguments: {} });
    const messages: any[] = [
      { role: "system", content: "head", toolsAdded: [tool("read")] },
      { role: "user", content: "task", timestamp: 0 },
      assistant(m, [call("call|fc_1"), ...(shape === "partial" ? [call("other|fc_2")] : [])]),
      { role: "system", content: "update", toolsAdded: [tool("late")] },
    ];
    if (shape !== "orphan") messages.push({ role: "toolResult", toolCallId: "call|fc_1", toolName: "read", content: [{ type: "text", text: "ok" }], timestamp: 1 });
    if (shape === "two-systems") messages.push({ role: "system", content: "second update", toolsAdded: [tool("later")] });
    messages.push({ role: "user", content: "continue", timestamp: 2 }, assistant(m, [{ type: "text", text: "answer" }]));
    const payload = await providerPayload(m, messages);
    const view = createBranchInputSnapshot({ branch: messageEntries(messages), tools: [] }).view(m, "full-history");
    expect(view.items).toEqual(payload.input);
    expect([...view.userSources.values()]).toEqual(["message-1", `message-${messages.length - 2}`]);
  }
});

test.each(["hidden", "forced", "both"])("replays a strictly matched %s projection without replacing the checkpoint", async (mode) => {
  const m = { ...model(), compat: { ...model().compat, supportsAdditionalTools: true, supportsMidConvoSystemMessages: true } };
  const tool = (name: string) => ({ name, description: name, parameters: { type: "object", properties: {} } });
  const tools = [tool("visible"), tool("hidden"), tool("late")];
  const sm = SessionManager.inMemory(process.cwd());
  sm.appendMessage({ role: "system", content: "Initial", toolsAdded: tools.slice(0, 2), timestamp: 0 } as any);
  const kept = sm.appendMessage({ role: "user", content: "old", timestamp: 1 });
  sm.appendMessage(assistant(m, [{ type: "text", text: "old answer" }]) as any);
  const checkpoint = { type: "compaction", encrypted_content: "opaque" };
  sm.appendCompaction("summary", kept, 100, { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(m), replacementHistory: [checkpoint] });
  sm.appendMessage({ role: "system", content: "Late instruction", toolsAdded: [tools[2]], timestamp: 3 } as any);
  sm.appendMessage({ role: "user", content: "continue", timestamp: 4 });
  let messages: any[] = sm.buildSessionProjection().messages.filter(message => message.role !== "compactionSummary");
  if (mode !== "forced") messages = messages.map(message => message.role === "system" ? { ...message, toolsAdded: message.toolsAdded?.filter((tool: any) => tool.name === "visible") } : message);
  if (mode !== "hidden") messages = [{ role: "system", content: "Forced", toolsAdded: mode === "both" ? [tools[0]] : tools, timestamp: 0 }, ...messages.filter(message => message.role !== "system")];
  const payload = await providerPayload(m, messages);
  const compact = vi.fn();
  const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => sm.getBranch(), getAllTools: () => tools as any,
    createCheckpoint: compact, appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn() });
  const ctx = { model: m, getSystemPrompt: () => mode === "hidden" ? "Initial" : "Forced", sessionManager: sm, modelRegistry: { find: () => m } } as any;
  const actual = await coordinator.prepareRequest(m, ctx, payload.input, payload);
  const suffix = payload.input.slice(payload.input.findIndex((item: any) => item.role === "assistant") + 1);
  expect(actual).toEqual([checkpoint, ...suffix]);
  expect(compact).not.toHaveBeenCalled();
  const manual = await coordinator.prepareCompactionPlan(m, ctx);
  expect(manual.basePayload.tools).toEqual(payload.tools ?? []);
  expect(manual.basePayload.instructions).toBe(payload.instructions);
  for (const mutate of [
    (p: any) => { p.input.find((item: any) => item.role === "user").content[0].text = "tampered"; },
    (p: any) => { p.tools[0].description = "tampered"; },
    (p: any) => { p.input.splice(p.input.findIndex((item: any) => item.role === "user"), 1); },
  ]) {
    const bad = structuredClone(payload); mutate(bad);
    await expect(coordinator.prepareRequest(m, ctx, bad.input, bad)).rejects.toThrow();
  }
});

async function replay(m: any, messages: any[], tools: any[] = []) {
  const current = { role: "user", content: [{ type: "text", text: "continue" }], timestamp: 1 };
  const basePayload = await providerPayload(m, [...messages, current], tools);
  const input = basePayload.input;
  const checkpoint = { type: "compaction", encrypted_content: "opaque" };
  const branch: any[] = [{ id: "checkpoint", type: "custom", customType: NATIVE_COMPACTION_KIND,
    data: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(m), replacementHistory: [checkpoint] } }, ...messageEntries([...messages, current])];
  const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => tools.map(({ constrainedSampling: _, ...info }) => info),
    createCheckpoint: async () => { throw new Error("Unexpected compaction"); }, appendCheckpoint: () => { throw new Error("Unexpected checkpoint"); }, appendCheckpointBypass: () => {} });
  const ctx = { model: m, getSystemPrompt: () => "", sessionManager: { getSessionId: () => "test" }, modelRegistry: { find: () => m } } as any;
  const original = structuredClone(branch);
  const output = await coordinator.prepareRequest(m, ctx, input as any, basePayload);
  expect(output).toEqual([checkpoint, ...input]);
  expect(branch).toEqual(original);
  return { branch, original, coordinator, ctx, input, basePayload, output, checkpoint };
}

test("drops cross-model thinking without shifting visible text IDs during checkpoint replay", async () => {
  await replay(model(), [
    { role: "user", content: "start", timestamp: 0 },
    assistant(model("gpt-5.5"), [
      { type: "thinking", thinking: "Private reasoning from the previous model" },
      { type: "text", text: "Visible answer" },
    ]),
  ]);
});

const reasoning = { type: "reasoning", id: "rs_kept", summary: [], encrypted_content: "opaque-reasoning" };
const thinkingCases = [
  ["readable", { type: "thinking", thinking: "Old private reasoning" }],
  ["signed", { type: "thinking", thinking: "Old signed reasoning", thinkingSignature: JSON.stringify(reasoning) }],
  ["only", { type: "thinking", thinking: "No visible answer" }],
  ["empty", { type: "thinking", thinking: "" }],
  ["redacted", { type: "thinking", thinking: "Redacted reasoning", redacted: true, thinkingSignature: JSON.stringify(reasoning) }],
] as const;

for (const identity of ["model", "provider", "api"] as const) {
  test.each(thinkingCases)(`drops ${identity}-mismatched %s thinking in replay and manual compaction`, async (kind, block) => {
    const target = model();
    const source = { ...target, [identity === "model" ? "id" : identity]: `other-${identity}` };
    const content: any[] = [block];
    if (kind !== "only") content.push({ type: "text", text: "Visible answer" }, { type: "text", text: "More text" });
    const result = await replay(target, [
      { role: "user", content: "start", timestamp: 0 },
      assistant(source, content),
      assistant(target, [{ type: "text", text: "Following answer" }]),
    ]);
    const { branch, original, coordinator, ctx, input, output, basePayload } = result;
    expect(fullInputForBranch({ branch, model: target, tools: [] })).toEqual(input);
    expect(await coordinator.prepareCompaction(target, ctx, false, undefined, basePayload)).toEqual(output);
    expect(input.filter((item: any) => item.role === "assistant").map((item: any) => item.id))
      .toEqual(kind === "only" ? ["msg_pi_1"] : ["msg_pi_1", "msg_pi_1_1", "msg_pi_2"]);
    expect(branch).toEqual(original);
  });
}

test.each(["readable", "empty", "redacted"])("preserves same-model encrypted reasoning with %s thinking", async (kind) => {
  const target = model();
  const { branch, original, coordinator, ctx, input, output, basePayload } = await replay(target, [
    assistant(target, [{ type: "thinking", thinking: kind === "empty" ? "" : "Current reasoning",
      ...(kind === "redacted" ? { redacted: true } : {}), thinkingSignature: JSON.stringify(reasoning) },
    { type: "text", text: "Visible answer" }]),
  ]);
  expect(input[0]).toEqual(reasoning);
  expect(input[1].id).toBe("msg_pi_0");
  expect(fullInputForBranch({ branch, model: target, tools: [] })).toEqual(input);
  expect(await coordinator.prepareCompaction(target, ctx, false, undefined, basePayload)).toEqual(output);
  expect(branch).toEqual(original);
});

test("keeps mixed-model history aligned across a checkpoint and successive requests after a model switch", async () => {
  const previous = model("gpt-5.6-sol");
  const target = model("gpt-5.6-terra");
  const signed = (text: string) => [{ type: "thinking", thinking: "Private reasoning", thinkingSignature: JSON.stringify(reasoning) }, { type: "text", text }];
  const prefix = [
    { role: "user", content: "Before checkpoint", timestamp: 0 },
    assistant(previous, signed("Previous model before checkpoint")),
    assistant(target, signed("Target model before checkpoint")),
  ];
  const messages: any[] = [...prefix];
  const checkpoint = { type: "compaction", encrypted_content: "opaque-checkpoint" };
  const branch: any[] = [...messageEntries(prefix), { id: "checkpoint", type: "custom", customType: NATIVE_COMPACTION_KIND,
    data: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(previous), compHash: "3000", replacementHistory: [checkpoint] } }];
  const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => [],
    createCheckpoint: async () => { throw new Error("Unexpected compaction for compatible model hashes"); },
    appendCheckpoint: () => { throw new Error("Unexpected checkpoint"); }, appendCheckpointBypass: () => {} });
  const ctx = { model: previous, getSystemPrompt: () => "", sessionManager: { getSessionId: () => "thinking-switch", getBranch: () => branch },
    modelRegistry: { find: (_provider: string, id: string) => model(id) } } as any;
  const batches = [
    [assistant(previous, signed("Previous model after checkpoint")), { role: "user", content: "First request", timestamp: 1 }],
    [assistant(previous, signed("Last answer before switching")), { role: "user", content: "Switch model", timestamp: 2 }],
    [assistant(target, signed("First answer after switching")), { role: "user", content: "Continue again", timestamp: 3 }],
  ];
  for (const [index, batch] of batches.entries()) {
    if (index === 1) {
      ctx.model = target;
      await coordinator.selectModel({ model: target, previousModel: previous }, ctx);
    }
    for (const message of batch) {
      messages.push(message);
      branch.push({ id: `entry-${branch.length}`, type: "message", message });
    }
    const original = structuredClone(branch);
    const payload = await providerPayload(ctx.model, messages);
    const prefixPayload = await providerPayload(ctx.model, prefix);
    const expected = [checkpoint, ...payload.input.slice(prefixPayload.input.length)];
    expect(fullInputForBranch({ branch, model: ctx.model, tools: [] })).toEqual(payload.input);
    expect(await coordinator.prepareRequest(ctx.model, ctx, payload.input, payload)).toEqual(expected);
    expect(await coordinator.prepareCompaction(ctx.model, ctx, false, undefined, payload)).toEqual(expected);
    expect(expected.at(-1)).toEqual(payload.input.at(-1));
    expect(branch).toEqual(original);
  }
});

test("still rejects ordinary history tampering after dropping cross-model thinking", async () => {
  const target = model();
  const { coordinator, ctx, input, basePayload, branch, original } = await replay(target, [
    { role: "user", content: "Original user request", timestamp: 0 },
    assistant(model("gpt-5.5"), [{ type: "thinking", thinking: "Old reasoning" }, { type: "text", text: "Visible answer" }]),
  ]);
  const tampered = structuredClone(input);
  tampered[0].content[0].text = "Changed user request";
  await expect(coordinator.prepareRequest(target, ctx, tampered, { ...basePayload, input: tampered }))
    .rejects.toBeInstanceOf(HistoryPrefixMismatchError);
  expect(branch).toEqual(original);
});

test("visits mixed thinking and text blocks linearly without reconverting cached views", () => {
  const visits = [32, 64].map(count => {
    let accesses = 0;
    const messages = [model("gpt-5.5"), model()].map(source => assistant(source,
      Array.from({ length: count }, (_, index) => ({
        get type() { accesses++; return index % 2 === 0 ? "thinking" : "text"; },
        thinking: "Private reasoning", text: `Visible ${index}`,
        ...(index % 2 === 0 ? { thinkingSignature: JSON.stringify(reasoning) } : {}),
      }))));
    const snapshot = createBranchInputSnapshot({ branch: messageEntries(messages), tools: [] });
    const target = model();
    const first = snapshot.view(target, "full-history");
    const measured = accesses;
    expect(first.items).toHaveLength(count * 3 / 2);
    expect(snapshot.view(target, "full-history")).toBe(first);
    expect(accesses).toBe(measured);
    expect(measured).toBeGreaterThan(0);
    expect(measured).toBeLessThanOrEqual(count * 12);
    return measured;
  });
  expect(visits[1]).toBe(visits[0]! * 2);
});

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
  const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => [tool],
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

test.each(["same", "model", "provider", "api"])("validates grammar item IDs from %s identity", async (identity) => {
  const m = model();
  const source = identity === "same" ? m : { ...m, [identity === "model" ? "id" : identity]: `other-${identity}` };
  const tool = { name: "grammar", description: "Grammar", parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] }, constrainedSampling: { type: "grammar", variants: { openai_regex: ".*" } } };
  for (const suffix of ["fc_wrong", "ctc_valid", "wrong", ""]) {
    const id = suffix ? `call|${suffix}` : "call";
    await replay(m, [assistant(source, [{ type: "toolCall", id, name: "grammar", arguments: { input: "hello" } }]),
      { role: "toolResult", toolCallId: id, toolName: "grammar", content: [{ type: "text", text: "ok" }], timestamp: 0 }], [tool]);
  }
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
