import { afterEach, expect, test, vi } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import codexCompactionExtension from "../src/index.js";
import { fixtureSnapshot } from "./fixtures/compaction-metadata.js";
import { modelKey, NATIVE_COMPACTION_KIND } from "../src/native-compaction.js";

const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
const response = () => new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"new"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n');
const metadataResponse = () => new Response(JSON.stringify({ models: [
  { slug: "gpt-5.5", comp_hash: "2911" }, { slug: "gpt-5.6-sol", comp_hash: "3000" },
] }));
const user = (id: string, text: string) => ({ id, type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: 0 } });

function setup(automatic = false) {
  const old = { ...getBuiltinModel("openai-codex", "gpt-5.5")!, contextWindow: 100_000 };
  const target = automatic ? { ...old, contextWindow: 1000 } : { ...getBuiltinModel("openai-codex", "gpt-5.6-sol")! };
  const next = getBuiltinModel("openai-codex", "gpt-6-astra")!;
  let selected: Model<any> = target;
  const branch: any[] = [user("retained", "retained task"), {
    id: "checkpoint", type: "compaction", summary: "Codex encrypted compaction item.", firstKeptEntryId: "retained", tokensBefore: 1000,
    details: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(old), compHash: fixtureSnapshot.hashFor(old), replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }] },
  }];
  if (automatic) branch.push(user("large", "x".repeat(8000)));
  branch.push(user("current", "continue"));
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  let controller = new AbortController();
  const ctx = {
    cwd: process.cwd(), isProjectTrusted: () => false, hasUI: false,
    get model() { return selected; }, get signal() { return controller.signal; },
    thinkingLevel: "high", getSystemPrompt: () => "",
    abort: vi.fn(() => controller.abort()),
    sessionManager: { getSessionId: () => "session", getBranch: () => branch, getEntries: () => branch },
    modelRegistry: {
      find: (provider: string, id: string) => getBuiltinModel(provider, id),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey, baseUrl: "https://chatgpt.com/backend-api" }),
    },
  };
  const appendEntry = vi.fn((customType, data) => branch.push({ id: `appended-${branch.length}`, type: "custom", customType, data }));
  codexCompactionExtension({ on: (name: string, handler: any) => handlers.set(name, handler), getAllTools: () => [], getActiveTools: () => [], appendEntry } as never);
  const emit = (name: string, event: any = {}) => handlers.get(name)?.(event, ctx);
  const select = async (model: Model<any>) => {
    const previousModel = selected;
    selected = model;
    branch.push({ id: `model-${branch.length}`, type: "model_change", provider: model.provider, modelId: model.id });
    await emit("model_select", { model, previousModel });
  };
  const payload = { model: target.id, input: branch.filter(e => e.type === "message").map(e => ({ role: "user", content: [{ type: "input_text", text: e.message.content[0].text }] })) };
  return { emit, ctx, old, target, next, select, appendEntry, payload, freshSignal: () => { controller = new AbortController(); return controller.signal; } };
}

afterEach(() => vi.unstubAllGlobals());

test("preserves turn state across tool iterations and retries, not across delivered user messages", async () => {
  const f = setup();
  const headers = () => {
    const event = { headers: {} as Record<string, string> };
    f.emit("before_provider_headers", event);
    return event.headers["x-codex-turn-state"];
  };
  await f.emit("message_start", { message: { role: "user", content: "first" } });
  f.emit("after_provider_response", { headers: { "x-codex-turn-state": "ts-1" } });
  f.emit("turn_end", { message: { stopReason: "toolUse" } });
  f.emit("turn_start");
  expect(headers()).toBe("ts-1");
  f.emit("after_provider_response", { headers: { "x-codex-turn-state": "ts-2" } });
  f.emit("agent_end");
  f.freshSignal();
  f.emit("agent_start");
  f.emit("turn_start");
  expect(headers()).toBe("ts-1");
  // Queueing alone is not delivery. A handled/transformed input must not reset state.
  f.emit("input", { text: "queued", streamingBehavior: "followUp" });
  expect(headers()).toBe("ts-1");
  f.emit("message_start", { message: { role: "user", content: "queued" } });
  expect(headers()).toBeUndefined();
  f.emit("after_provider_response", { headers: { "x-codex-turn-state": "ts-3" } });
  f.emit("input", { text: "steer", streamingBehavior: "steer" });
  expect(headers()).toBe("ts-3");
  f.emit("message_start", { message: { role: "user", content: "steer" } });
  expect(headers()).toBeUndefined();
});

test("does not retain state after settling or accept responses from an aborted provider", () => {
  const f = setup();
  const headers = () => {
    const event = { headers: {} as Record<string, string> };
    f.emit("before_provider_headers", event);
    return event.headers["x-codex-turn-state"];
  };
  for (let i = 0; i < 20; i++) {
    f.emit("message_start", { message: { role: "user", content: `user-${i}` } });
    expect(headers()).toBeUndefined();
    f.emit("after_provider_response", { headers: { "x-codex-turn-state": `ts-${i}` } });
    expect(headers()).toBe(`ts-${i}`);
  }
  f.emit("agent_settled");
  expect(headers()).toBeUndefined();
  f.ctx.abort();
  f.emit("after_provider_response", { headers: { "x-codex-turn-state": "aborted" } });
  expect(headers()).toBeUndefined();
  f.freshSignal();
  f.emit("after_provider_response", { headers: { "x-codex-turn-state": "fresh" } });
  expect(headers()).toBe("fresh");
  f.emit("session_shutdown");
  expect(headers()).toBeUndefined();
});

test("ignores a compaction response carrying state from a previous user message", async () => {
  const f = setup();
  let release!: () => void;
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => init?.method === "GET" ? metadataResponse() : new Promise<Response>((resolve) => {
    release = () => {
      const result = response();
      result.headers.set("x-codex-turn-state", "stale");
      resolve(result);
    };
  }));
  const request = f.emit("session_before_compact", {
    preparation: { firstKeptEntryId: "retained", tokensBefore: 1000 }, reason: "manual", willRetry: false, signal: new AbortController().signal,
  });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  f.emit("message_start", { message: { role: "user", content: "new user" } });
  release();
  await request;
  const event = { headers: {} as Record<string, string> };
  f.emit("before_provider_headers", event);
  expect(event.headers["x-codex-turn-state"]).toBeUndefined();
});

test.each([
  { automatic: false, failed: false }, { automatic: false, failed: true },
  { automatic: true, failed: false }, { automatic: true, failed: true },
])("cancels stale provider preparation: %j", async ({ automatic, failed }) => {
  const fixture = setup(automatic);
  if (!automatic) await fixture.emit("model_select", { model: fixture.target, previousModel: fixture.old });
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pendingResponse = new Promise<void>(resolve => { release = resolve; });
  let remoteSignal: AbortSignal | undefined;
  const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
    if (init.method === "GET") return metadataResponse();
    remoteSignal = init.signal ?? undefined;
    started(); await pendingResponse;
    if (failed) throw new Error("HTTP 503");
    return response();
  });
  vi.stubGlobal("fetch", fetchMock);
  const providerSignal = fixture.ctx.signal;
  const request = fixture.emit("before_provider_request", { payload: fixture.payload });
  await ready;
  await fixture.select(fixture.next);
  const abortedAtSwitch = providerSignal.aborted;
  release();
  await request;
  expect(abortedAtSwitch).toBe(true);
  expect(fixture.ctx.abort).toHaveBeenCalledTimes(1);
  expect(fixture.appendEntry).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(remoteSignal?.aborted).toBe(true);
  fixture.freshSignal();
  const resumed = await fixture.emit("before_provider_request", { payload: { ...fixture.payload, model: fixture.next.id } });
  expect(resumed.input).toContainEqual({ type: "compaction", encrypted_content: "opaque" });
  expect(fixture.ctx.signal.aborted).toBe(false);
  expect(fixture.ctx.abort).toHaveBeenCalledTimes(1);
});

test("a late old response cannot commit or abort a newer transition after repeated model switches", async () => {
  const f = setup();
  await f.emit("model_select", { model: f.target, previousModel: f.old });
  const releases: Array<() => void> = [];
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => init?.method === "GET" ? metadataResponse()
    : new Promise<Response>((resolve) => releases.push(() => resolve(response()))));
  const first = f.emit("before_provider_request", { payload: f.payload });
  await vi.waitFor(() => expect(releases).toHaveLength(1));
  await f.select(f.next);
  await f.select(f.target);
  f.freshSignal();
  const second = f.emit("before_provider_request", { payload: f.payload });
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  releases[0]!();
  await first;
  expect(f.ctx.signal.aborted).toBe(false);
  expect(f.ctx.abort).toHaveBeenCalledTimes(1);
  expect(f.appendEntry).not.toHaveBeenCalled();
  releases[1]!();
  const payload = await second;
  expect(payload.input.some((item: any) => item.type === "compaction")).toBe(true);
  expect(f.appendEntry).toHaveBeenCalledTimes(1);
  expect(f.appendEntry.mock.calls[0]![1].modelKey).toBe(modelKey(f.target));
});
