import { fixtureToolInfo } from "../../../test-support/tool-info.js";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:timers/promises", () => ({
	setTimeout: (ms: number, value?: unknown, options?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
		const signal = options?.signal;
		if (signal?.aborted) return reject(signal.reason);
		const timer = globalThis.setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve(value);
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	}),
}));

import { createNativeCheckpoint } from "../src/remote-compaction.js";
import { convertToLlm, SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { projectBranchMessages } from "../src/session-projection.js";
import { compactionInputPlan, isTerminalCompactionFailure, UnprovenPreservedInputError } from "../src/native-compaction.js";
import { approximateResponseItemTokens, isContextWindowCompactionError, compactionFailureClassification, estimateCompactionWindowPrefillTokens, buildCodexHeaders, buildCompactionRequestBody, buildReplacementHistory, buildToolPayload, callRemoteCompaction, createBranchInputSnapshot, effectiveInputForBranch, findNativeCheckpoint, fullInputForBranch, modelKey, NATIVE_COMPACTION_BYPASS_KIND, NATIVE_COMPACTION_BYPASS_VERSION, NATIVE_COMPACTION_KIND, NATIVE_COMPACTION_VERSION, parseNativeCompactionDetails, piContextInputForBranch, retainRecentMessages, trimFunctionCallHistoryToFitContextWindow } from "../src/native-compaction.js";

afterEach(() => vi.useRealTimers());

type RemoteRequest = Parameters<typeof callRemoteCompaction>[0];
const remoteModel = { id: "gpt", provider: "openai-codex", api: "openai-codex-responses" } as import("@earendil-works/pi-ai").Model<"openai-codex-responses">;
const remoteRequest = (overrides: Partial<RemoteRequest> = {}): RemoteRequest => ({
	url: "https://example.test/compact",
	headers: new Headers(),
	body: {},
	model: remoteModel,
	...overrides,
});

const sseHeaders = { "content-type": "text/event-stream" };

function sse(data: string): Response {
	return new Response(data, { headers: sseHeaders });
}

async function captureFailure(operation: Promise<unknown>): Promise<unknown> {
	try {
		await operation;
	} catch (error) {
		return error;
	}
	return undefined;
}

describe("Codex compaction history", () => {
	test("classifies only the typed unproven pending input diagnostic", () => {
		expect(compactionFailureClassification(new UnprovenPreservedInputError())).toBe("preserved_input_source_unproven");
		expect(compactionFailureClassification(Object.assign(new Error("unknown"), { code: "preserved_input_source_unproven" }))).toBe("compaction_failed");
	});
	test.each([401, 403])("preserves typed HTTP %i failure even with an empty body", async status => {
		const fetch = vi.fn(async () => new Response("", { status }));
		vi.stubGlobal("fetch", fetch);
		try {
			const error = await captureFailure(callRemoteCompaction(remoteRequest()));
			expect(error).toMatchObject({ compactionHttpStatus: status, compactionTerminalReason: status === 401 ? "authentication" : "permission", retryWithCurrentModel: false });
			expect(isTerminalCompactionFailure(error)).toBe(true);
			expect(Object.keys(error as Error)).not.toContain("compactionHttpStatus");
			expect(fetch).toHaveBeenCalledTimes(1);
		} finally { vi.unstubAllGlobals(); }
	});
	test.each([401, 403])("keeps HTTP %i terminal after its body deadline and releases resources", async status => {
		vi.useFakeTimers();
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("partial")); }, cancel });
		const fetch = vi.fn(async () => new Response(body, { status }));
		vi.stubGlobal("fetch", fetch);
		try {
			const result = captureFailure(callRemoteCompaction(remoteRequest()));
			await vi.advanceTimersByTimeAsync(300_001);
			const error = await result;
			expect(error).toMatchObject({ compactionHttpStatus: status, retryWithCurrentModel: false });
			expect(isTerminalCompactionFailure(error)).toBe(true);
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(cancel).toHaveBeenCalledTimes(1);
			expect(body.locked).toBe(false);
			expect(vi.getTimerCount()).toBe(0);
		} finally { vi.unstubAllGlobals(); }
	});
	test("migrates a uniquely proven legacy pending suffix without retaining it as history", () => {
		const sm = SessionManager.inMemory(process.cwd());
		const earlier = sm.appendMessage({ role: "user", content: "earlier", timestamp: 0 });
		const pending = sm.appendMessage({ role: "user", content: "pending", timestamp: 1 });
		const custom = sm.appendCustomMessageEntry("note", "complete suffix", false);
		const original = createBranchInputSnapshot({ branch: sm.getBranch(), tools: [] }).view(remoteModel, "full-history");
		const details = { kind: NATIVE_COMPACTION_KIND, version: NATIVE_COMPACTION_VERSION, modelKey: modelKey(remoteModel),
			replacementHistory: [original.items[0]!, { type: "compaction", encrypted_content: "opaque" }], preservedInput: original.items.slice(1) };
		sm.appendCompaction("legacy", earlier, 100, details);
		const tail = sm.appendCustomMessageEntry("note", "live tail", false);
		const snapshot = createBranchInputSnapshot({ branch: sm.getBranch(), tools: [] });
		const plan = compactionInputPlan(snapshot, remoteModel);
		expect(plan.input).toEqual(details.replacementHistory);
		expect(plan.preservedInput).toEqual([...details.preservedInput, snapshot.view(remoteModel, "effective").items.at(-1)]);
		expect(plan.preservedInputSources).toEqual([pending, custom, tail]);
		expect(details).not.toHaveProperty("preservedInputSources");
	});
	test.each(["truncated", "duplicate", "missing suffix", "edited", "conflicting sources", "stale sources"])("rejects unproven pending input with %s", kind => {
		const sm = SessionManager.inMemory(process.cwd());
		if (kind === "duplicate") sm.appendMessage({ role: "user", content: "pending", timestamp: 0 });
		const pending = sm.appendMessage({ role: "user", content: "pending", timestamp: 1 });
		sm.appendCustomMessageEntry("note", "suffix", false);
		const original = createBranchInputSnapshot({ branch: sm.getBranch(), tools: [] }).view(remoteModel, "full-history");
		const preservedInput = original.items.slice(kind === "duplicate" ? 1 : 0);
		if (kind === "edited" || kind === "stale sources") sm.appendContextEdit(pending, { content: "changed" });
		sm.appendCompaction("legacy", pending, 100, { kind: NATIVE_COMPACTION_KIND, version: NATIVE_COMPACTION_VERSION, modelKey: modelKey(remoteModel),
			replacementHistory: [...(kind === "truncated" ? [{ role: "user", content: [{ type: "input_text", text: "pend..." }] }] : []), { type: "compaction", encrypted_content: "opaque" }],
			preservedInput: kind === "missing suffix" ? preservedInput.slice(0, 1) : preservedInput,
			...(kind === "conflicting sources" ? { preservedInputSources: ["another", null] } : kind === "stale sources" ? { preservedInputSources: [pending, null] } : {}) });
		const branch = sm.getBranch();
		const before = structuredClone(branch);
		expect(findNativeCheckpoint(branch, modelKey(remoteModel)).status).toBe("valid");
		expect(() => compactionInputPlan(createBranchInputSnapshot({ branch, tools: [] }), remoteModel)).toThrowError(expect.objectContaining({ code: "preserved_input_source_unproven" }));
		expect(branch).toEqual(before);
	});
	test.each([1000, 2000, 4000])("indexes legacy occurrences with bounded conversion and identity work for %i users", count => {
		const sm = SessionManager.inMemory(process.cwd());
		for (let index = 0; index < count; index++) sm.appendMessage({ role: "user", content: `unique-${index}`, timestamp: index });
		const branch = sm.getBranch();
		const original = createBranchInputSnapshot({ branch, tools: [] }).view(remoteModel, "full-history");
		sm.appendCompaction("legacy", branch[0]!.id, 100, { kind: NATIVE_COMPACTION_KIND, version: NATIVE_COMPACTION_VERSION, modelKey: modelKey(remoteModel),
			replacementHistory: [...original.items.slice(0, -1), { type: "compaction", encrypted_content: "opaque" }], preservedInput: original.items.slice(-1) });
		const convert = vi.fn(convertToLlm);
		const snapshot = createBranchInputSnapshot({ branch: sm.getBranch(), tools: [], convertMessages: convert });
		const encode = vi.spyOn(JSON, "stringify");
		try {
			const plan = compactionInputPlan(snapshot, remoteModel);
			expect(plan.preservedInputSources).toEqual([branch.at(-1)!.id]);
			expect(convert.mock.calls.length).toBeLessThanOrEqual(3 * (count + 1));
			const itemCalls = encode.mock.calls.filter(([value]) => value && typeof value === "object" && (value as { role?: string }).role === "user");
			expect(itemCalls).toHaveLength(2 * count);
			expect(new Set(itemCalls.map(([value]) => value)).size).toBe(itemCalls.length);
		} finally { encode.mockRestore(); }
	});
	test("round trips optional source coverage and rejects malformed mappings", () => {
		const details = { kind: NATIVE_COMPACTION_KIND, version: NATIVE_COMPACTION_VERSION, modelKey: modelKey(remoteModel),
			replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
			preservedInput: [{ role: "user", content: [{ type: "input_text", text: "same" }] }, { role: "user", content: [{ type: "input_text", text: "same" }] }] };
		expect(parseNativeCompactionDetails(details)?.preservedInputSources).toBeUndefined();
		const covered = { ...details, preservedInputSources: ["first", "second"] };
		expect(parseNativeCompactionDetails(JSON.parse(JSON.stringify(covered)))).toEqual(covered);
		for (const sources of [null, [], ["first"], ["first", 2], ["first", ""], {}]) {
			expect(parseNativeCompactionDetails({ ...details, preservedInputSources: sources })).toBeUndefined();
		}
		expect(parseNativeCompactionDetails({ ...details, preservedInputSources: ["first", null] })?.preservedInputSources).toEqual(["first", null]);
	});
	test.each(["oversized", "broken"])("keeps an incomplete %s error body non-fallback and releases its reader", async kind => {
		vi.useFakeTimers();
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				if (kind === "broken") controller.error(new Error("socket lost"));
				else controller.enqueue(new TextEncoder().encode('{"error":{"code":"model_not_found","padding":"' + "x".repeat(1024 * 1024)));
			}, cancel,
		});
		const fetchMock = vi.fn(async () => new Response(body, { status: 403 }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			const error = await captureFailure(callRemoteCompaction(remoteRequest()));
			expect(error).toMatchObject({ retryWithCurrentModel: false });
			expect(error).toMatchObject({ compactionHttpStatus: 403, compactionTerminalReason: "permission" });
			expect(isTerminalCompactionFailure(error)).toBe(true);
			expect(String(error)).toContain("403");
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(body.locked).toBe(false);
			if (kind === "oversized") expect(cancel).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
		} finally { vi.unstubAllGlobals(); }
	});
	test("matches Pi context and attributes only the newest overlapping summary", () => {
		const sm = SessionManager.inMemory(process.cwd());
		const first = sm.appendMessage({ role: "user", content: "U1", timestamp: 1 });
		const oldSummary = sm.appendCompaction("C1", first, 0);
		const second = sm.appendMessage({ role: "user", content: "U2", timestamp: 2 });
		const newSummary = sm.appendCompaction("C2", first, 0);
		const third = sm.appendMessage({ role: "user", content: "U3", timestamp: 3 });
		const snapshot = createBranchInputSnapshot({ branch: sm.getBranch(), tools: [] });
		const view = snapshot.view(remoteModel, "pi-context");
		expect(view.items).toEqual(piContextInputForBranch({ branch: sm.getBranch(), model: remoteModel, tools: [] }));
		expect(JSON.stringify(view.items)).not.toContain("C1");
		expect(JSON.stringify(view.items)).toContain("C2");
		expect([...view.userSources.values()]).toEqual([newSummary, first, second, third]);
		expect([...view.userSources.values()]).not.toContain(oldSummary);
		expect(snapshot.view(remoteModel, "effective")).toBe(view);
		const excludedFirstKept = snapshot.view(remoteModel, "pi-context", { excludeEntryId: first });
		expect(JSON.stringify(excludedFirstKept.items)).toContain("C2");
		expect([...excludedFirstKept.userSources.values()]).not.toContain(first);
		expect([...excludedFirstKept.userSources.values()]).toContain(third);
		expect(snapshot.projection.piContext().some((entry) => entry.sourceEntry.id === first)).toBe(true);
	});
	test("keeps separate source ids when raw entries share one user message object", () => {
		const shared = { role: "user", content: "shared", timestamp: 1 };
		const branch = [
			{ id: "first", parentId: null, type: "message", message: shared },
			{ id: "second", parentId: "first", type: "message", message: shared },
		] as SessionEntry[];
		const view = createBranchInputSnapshot({ branch, tools: [] }).view(remoteModel, "full-history");
		expect([...view.userSources]).toEqual([[0, "first"], [1, "second"]]);
		expect(branch[0]?.type === "message" && branch[0].message).toBe(shared);
		expect(branch[1]?.type === "message" && branch[1].message).toBe(shared);
	});
	test("does not invent source ids for a native prefix and offsets the live tail", () => {
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "old", timestamp: 1 });
		sm.appendCustomEntry(NATIVE_COMPACTION_KIND, {
			kind: NATIVE_COMPACTION_KIND, version: NATIVE_COMPACTION_VERSION, modelKey: modelKey(remoteModel),
			replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
			preservedInput: [{ role: "user", content: [{ type: "input_text", text: "persisted" }] }],
		});
		const tail = sm.appendMessage({ role: "user", content: "live", timestamp: 2 });
		const view = createBranchInputSnapshot({ branch: sm.getBranch(), tools: [] }).view(remoteModel, "effective");
		expect(view.items).toHaveLength(3);
		expect([...view.userSources]).toEqual([[2, tail]]);
		expect(Object.keys(view.items[2]!)).not.toContain("sourceEntryId");
	});
	test("maps custom user output without assigning an index to an empty user", () => {
		const sm = SessionManager.inMemory(process.cwd());
		const first = sm.appendMessage({ role: "user", content: "first", timestamp: 1 });
		const empty = sm.appendMessage({ role: "user", content: [], timestamp: 2 });
		const custom = sm.appendCustomMessageEntry("note", "custom", false);
		const view = createBranchInputSnapshot({ branch: sm.getBranch(), tools: [] }).view(remoteModel, "full-history");
		expect([...view.userSources.values()]).toEqual([first, custom]);
		expect([...view.userSources.values()]).not.toContain(empty);
		expect(view.items.filter((item) => item.role === "user")).toHaveLength(2);
	});
	test("serializes each semantic snapshot view once and keeps model compat distinct", () => {
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "current", timestamp: 1 });
		const branch = sm.getBranch();
		const spy = vi.fn(convertToLlm);
		const lookupSpy = vi.fn(findNativeCheckpoint);
		const snapshot = createBranchInputSnapshot({ branch, tools: [], convertMessages: spy, lookupCheckpoint: lookupSpy });
		const first = snapshot.view(remoteModel, "full-history");
		expect(lookupSpy).toHaveBeenCalledTimes(1);
		const afterFirst = spy.mock.calls.length;
		expect(afterFirst).toBeGreaterThan(0);
		expect(snapshot.view(remoteModel, "full-history")).toBe(first);
		expect(snapshot.view(remoteModel, "pi-context")).toBe(first);
		expect(snapshot.view(remoteModel, "effective")).toBe(first);
		expect(spy).toHaveBeenCalledTimes(afterFirst);
		expect(lookupSpy).toHaveBeenCalledTimes(1);
		const excluded = snapshot.view(remoteModel, "full-history", { excludeEntryId: branch[0]!.id });
		const afterExclude = spy.mock.calls.length;
		expect(excluded.items).toEqual([]);
		expect(snapshot.view(remoteModel, "full-history", { excludeEntryId: branch[0]!.id })).toBe(excluded);
		expect(spy).toHaveBeenCalledTimes(afterExclude);
		const sameModel = { ...remoteModel };
		expect(snapshot.view(sameModel, "full-history")).toBe(first);
		expect(spy).toHaveBeenCalledTimes(afterExclude);
		const differentCompat = { ...remoteModel, compat: { supportsDeveloperRole: false } };
		expect(snapshot.view(differentCompat, "full-history")).not.toBe(first);
		expect(spy.mock.calls.length).toBeGreaterThan(afterExclude);
		expect(lookupSpy).toHaveBeenCalledTimes(1);
		snapshot.view({ ...remoteModel, id: "other-model" }, "full-history");
		expect(lookupSpy).toHaveBeenCalledTimes(2);
		const newId = sm.appendMessage({ role: "user", content: "later", timestamp: 2 });
		expect(snapshot.view(remoteModel, "full-history")).toBe(first);
		expect([...first.userSources.values()]).not.toContain(newId);
		expect([...createBranchInputSnapshot({ branch: sm.getBranch(), tools: [] }).view(remoteModel, "full-history").userSources.values()]).toContain(newId);
	});
	test("matches Pi projection for repeated user, assistant, and tool-result edits", () => {
		const sm = SessionManager.inMemory(process.cwd());
		const user = sm.appendMessage({ role: "user", content: "original user", timestamp: 1 });
		const assistant = sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "original assistant" }], timestamp: 2, provider: "openai-codex", api: "openai-codex-responses", model: "gpt", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } } as never);
		const tool = sm.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "original tool" }], isError: false, timestamp: 3 });
		sm.appendContextEdit(user, { content: "first revision" });
		sm.appendContextEdit(user, { content: "final revision" });
		sm.appendContextEdit(assistant, null);
		sm.appendContextEdit(tool, { content: "revised tool" });
		const branch = sm.getBranch();
		expect(projectBranchMessages(branch).flat()).toEqual(sm.buildSessionProjection().messages);
		expect(JSON.stringify(projectBranchMessages(branch).flat())).toContain("final revision");
		expect(JSON.stringify(projectBranchMessages(branch).flat())).toContain("revised tool");
		expect(JSON.stringify(projectBranchMessages(branch).flat())).not.toContain("original assistant");
		expect(JSON.stringify(branch)).toContain("original assistant");
	});
	test("marks authentication failures fail-closed", async () => {
		await expect(createNativeCheckpoint({
			ctx: {
				getSystemPrompt: () => "",
				sessionManager: { getSessionId: () => "auth-failure" },
				modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false, error: "403" }) },
			} as never,
			model: { id: "gpt", provider: "openai-codex", api: "openai-codex-responses" } as never,
			input: [],
			allTools: [],
			activeToolNames: [],
		})).rejects.toMatchObject({ retryWithCurrentModel: false });
	});

	test("builds the Codex allowlisted request shape", () => {
		const body = buildCompactionRequestBody({
			basePayload: {
				instructions: "rewritten instructions",
				tools: [{ type: "custom_tool", name: "grammar_tool" }],
				tool_choice: { type: "custom" },
				temperature: 0,
			},
			model: { id: "gpt", provider: "openai-codex", api: "openai-codex-responses" } as never,
			input: [],
			instructions: "instructions",
			tools: [{ type: "function", name: "wrong-tool" }],
			sessionId: "session",
		});
		expect(body.instructions).toBe("rewritten instructions");
		expect(body.tools).toEqual([{ type: "custom_tool", name: "grammar_tool" }]);
		expect(body.tool_choice).toBe("auto");
		expect(body.temperature).toBeUndefined();
	});

	test("uses SSE and retains the V2 feature token", () => {
		const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } })).toString("base64url")}.c`;
		const headers = buildCodexHeaders({
			apiKey,
			headers: { "x-codex-beta-features": "other,remote_compaction_v2", "x-remove": null },
			sessionId: "session",
			turnState: "sticky",
		});
		expect(headers.get("accept")).toBe("text/event-stream");
		expect(headers.get("x-codex-beta-features")).toBe("other,remote_compaction_v2");
		expect(headers.get("x-codex-turn-state")).toBe("sticky");
		expect(headers.get("x-remove")).toBeNull();
	});

	test("reserves the stable prefix before sending remote compaction", async () => {
		let requestUrl: string | undefined;
		let requestBody: Record<string, unknown> | undefined;
		const basePayload = {
			model: "previous",
			reasoning: { effort: "low" },
			service_tier: "priority",
			text: { verbosity: "high" },
			temperature: 0,
		};
		const originalBasePayload = structuredClone(basePayload);
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			requestUrl = url;
			requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response([
				'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
				'data: {"type":"response.completed","response":{"id":"response"}}',
			].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } });
		});
		try {
			const checkpoint = await createNativeCheckpoint({
				ctx: {
					getSystemPrompt: () => "i".repeat(400),
					thinkingLevel: "high",
					modelRegistry: {
						getApiKeyAndHeaders: async () => ({
							ok: true,
							apiKey: `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } })).toString("base64url")}.c`,
							headers: {},
							baseUrl: "https://auth.example/backend-api",
						}),
					},
					sessionManager: { getSessionId: () => "session" },
				} as never,
				model: { id: "gpt", provider: "openai-codex", api: "openai-codex-responses", reasoning: true, contextWindow: 160 } as never,
				compHash: "opaque-current",
				input: [{ type: "function_call_output", call_id: "1", output: "x".repeat(400) }],
				basePayload,
				allTools: [],
				activeToolNames: [],
			});
			expect(requestUrl).toBe("https://auth.example/backend-api/codex/responses");
			expect(basePayload).toEqual(originalBasePayload);
			expect(checkpoint.details).not.toHaveProperty("strategy");
			expect(checkpoint.details.compHash).toBe("opaque-current");
			expect(requestBody).not.toHaveProperty("compHash");
			expect(parseNativeCompactionDetails(checkpoint.details)).toBeDefined();
			expect(requestBody?.reasoning).toEqual({ effort: "high", summary: "auto" });
			expect(requestBody?.input).toEqual(expect.arrayContaining([
				expect.objectContaining({ type: "compaction_trigger" }),
			]));
			const output = (requestBody?.input as Array<{ type?: string; output?: string }>).find((item) => item.type === "function_call_output");
			expect(output?.output?.length).toBeLessThan(400);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	test("persists only an explicit nonblank checkpoint hash", async () => {
		const fetch = vi.fn(async () => new Response([
			'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
			'data: {"type":"response.completed","response":{"id":"response"}}',
		].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));
		vi.stubGlobal("fetch", fetch);
		const params = {
			ctx: {
				getSystemPrompt: () => "instructions",
				modelRegistry: { getApiKeyAndHeaders: async () => ({
					ok: true,
					apiKey: `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } })).toString("base64url")}.c`,
					headers: {},
					baseUrl: "https://chatgpt.com/backend-api",
				}) },
				sessionManager: { getSessionId: () => "session" },
			} as never,
			model: { id: "gpt-5.5", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 100_000 } as never,
			input: [] as never,
			allTools: [],
			activeToolNames: [],
		};
		try {
			expect((await createNativeCheckpoint(params)).details.compHash).toBeUndefined();
			expect((await createNativeCheckpoint({ ...params, compHash: "  " })).details.compHash).toBeUndefined();
			expect((await createNativeCheckpoint({ ...params, compHash: 12 as never })).details.compHash).toBeUndefined();
			expect((await createNativeCheckpoint({ ...params, compHash: " opaque " })).details.compHash).toBe(" opaque ");
			expect(fetch).toHaveBeenCalledTimes(4);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	test("omits input-declared deferred tools from generated compaction tools", async () => {
		let requestBody: Record<string, unknown> | undefined;
		vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response([
				'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
				'data: {"type":"response.completed","response":{"id":"response"}}',
			].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } });
		});
		const deferredTools = [
			{
				type: "function",
				name: "lazy",
				description: "lazy tool",
				parameters: { type: "object", properties: {} },
				strict: null,
			},
			{
				type: "function",
				name: "searched",
				description: "searched tool",
				parameters: { type: "object", properties: {} },
				defer_loading: true,
			},
		];
		const input = [
			{ type: "additional_tools", role: "developer", tools: [deferredTools[0]] },
			{ type: "tool_search_output", call_id: "search", execution: "client", status: "completed", tools: [deferredTools[1]] },
		];
		try {
			await createNativeCheckpoint({
				ctx: {
					getSystemPrompt: () => "instructions",
					modelRegistry: {
						getApiKeyAndHeaders: async () => ({
							ok: true,
							apiKey: `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } })).toString("base64url")}.c`,
							headers: {},
							baseUrl: "https://auth.example/backend-api",
						}),
					},
					sessionManager: { getSessionId: () => "session" },
				} as never,
				model: {
					id: "gpt",
					provider: "openai-codex",
					api: "openai-codex-responses",
					contextWindow: 100_000,
					compat: { supportsAdditionalTools: true },
				} as never,
				input: input as never,
				allTools: [
					{ name: "lazy", description: "lazy tool", parameters: { type: "object", properties: {} } },
					{ name: "searched", description: "searched tool", parameters: { type: "object", properties: {} } },
					{ name: "immediate", description: "immediate tool", parameters: { type: "object", properties: {} } },
				] as never,
				activeToolNames: ["lazy", "searched", "immediate"],
			});
			expect(requestBody?.tools).toEqual([
				{ type: "function", name: "immediate", description: "immediate tool", parameters: { type: "object", properties: {} }, strict: null },
			]);
			expect(requestBody?.input).toEqual(expect.arrayContaining(input));
		} finally {
			vi.unstubAllGlobals();
		}
	});

	test("preserves eligible response.failed details for model fallback", async () => {
		let calls = 0;
		const body = "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"context_length_exceeded\",\"message\":\"too large\"}}}\n\ndata: [DONE]\n\n";
		await expect(callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return sse(body);
			},
		}))).rejects.toThrow("context_length_exceeded");
		expect(calls).toBe(1);
	});
	test.each([
		{
			name: "missing-model HTTP 404",
			response: () => new Response(JSON.stringify({ error: { code: "model_not_found" } }), { status: 404 }),
			expectedFallback: true,
			expectedCalls: 1,
		},
		{
			name: "code-only context failure",
			response: () => sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"invalid_prompt\"}}}\n\ndata: [DONE]\n\n"),
			expectedFallback: true,
			expectedCalls: 1,
		},
		{
			name: "missing-model SSE failure",
			response: () => sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"model_not_found\"}}}\n\ndata: [DONE]\n\n"),
			expectedFallback: true,
			expectedCalls: 1,
		},
	])("allows $name to fall back", async ({ response, expectedFallback, expectedCalls }) => {
		let calls = 0;
		const failure = await callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return response();
			},
		})).catch(error => error);
		expect(failure).toMatchObject({ retryWithCurrentModel: expectedFallback });
		expect(calls).toBe(expectedCalls);
	});

	test("retries transient response.failed errors and preserves details", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const promise = callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"internal_server_error\",\"message\":\"busy\"}}}\n\ndata: [DONE]\n\n");
			},
		}));
		const failure = expect(promise).rejects.toMatchObject({ message: expect.stringContaining("busy"), retryWithCurrentModel: false });
		await vi.runAllTimersAsync();
		await failure;
		expect(calls).toBe(3);
	});

	test("carries response turn state into a retry after SSE failure", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const requestHeaders: Headers[] = [];
		const onTurnState = vi.fn();
		const promise = callRemoteCompaction(remoteRequest({
			onTurnState,
			fetchImpl: async (_url, init) => {
				calls++;
				requestHeaders.push(new Headers(init?.headers));
				if (calls === 1) {
					return new Response(
						'data: {"type":"response.failed","response":{"error":{"code":"internal_server_error","message":"busy"}}}\n\n',
						{ headers: { ...sseHeaders, "x-codex-turn-state": "sticky-after-headers" } },
					);
				}
				return sse([
					'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
					'data: {"type":"response.completed","response":{"id":"response"}}',
				].join("\n\n") + "\n\n");
			},
		}));
		await vi.runAllTimersAsync();
		await expect(promise).resolves.toMatchObject({ compactionItem: { encrypted_content: "opaque" } });
		expect(calls).toBe(2);
		expect(requestHeaders[1]?.get("x-codex-turn-state")).toBe("sticky-after-headers");
		expect(onTurnState).toHaveBeenCalledWith("sticky-after-headers");
		expect(onTurnState).toHaveBeenCalledTimes(1);
	});

	test("uses the SSE retry-after hint", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const promise = callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"try again in 5s\"}}}\n\ndata: [DONE]\n\n");
			},
		}));
		const failure = promise.catch(error => error);
		await vi.advanceTimersByTimeAsync(4_999);
		expect(calls).toBe(1);
		await vi.runAllTimersAsync();
		expect(await failure).toMatchObject({ retryWithCurrentModel: false });
		expect(calls).toBe(3);
	});

	test.each([
		["content_filter", false, 3],
		["new_protocol_reason", false, 3],
		["server_error", false, 3],
	] as const)("handles incomplete reason %s", async (reason, expectedFallback, expectedCalls) => {
		vi.useFakeTimers();
		let calls = 0;
		const promise = callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return sse(`data: ${JSON.stringify({ type: "response.incomplete", response: { incomplete_details: { reason } } })}\n\n`);
			},
		}));
		const failure = promise.catch(error => error);
		await vi.runAllTimersAsync();
		const error = await failure;
		expect(error).toMatchObject({ retryWithCurrentModel: expectedFallback });
		expect(calls).toBe(expectedCalls);
	});

	test("retries a response.failed content filter stream", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const failure = callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"content_filter\",\"message\":\"blocked by policy\"}}}\n\ndata: [DONE]\n\n");
			},
		})).catch((error) => error);
		await vi.runAllTimersAsync();
		expect(await failure).toMatchObject({ retryWithCurrentModel: false });
		expect(calls).toBe(3);
	});

	test("does not treat a protocol incomplete response as context overflow", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const failure = callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return sse('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"new_protocol_reason","message":"context_length_exceeded"}}}\n\n');
			},
		})).catch((error) => error);
		await vi.runAllTimersAsync();
		const error = await failure;
		expect(calls).toBe(3);
		expect(isContextWindowCompactionError(error)).toBe(false);
	});

	test("marks an incomplete context overflow for automatic retry only", async () => {
		vi.useFakeTimers();
		const failure = callRemoteCompaction(remoteRequest({
			fetchImpl: async () => sse('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"context_length_exceeded"}}}\n\n'),
		})).catch((error) => error);
		await vi.runAllTimersAsync();
		const error = await failure;
		expect(isContextWindowCompactionError(error)).toBe(true);
	});

	test("does not switch models for usage-limit SSE errors", async () => {
		let calls = 0;
		let failure: unknown;
		try {
			await callRemoteCompaction(remoteRequest({
				fetchImpl: async () => {
					calls++;
					return sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"usage_limit_reached\",\"message\":\"try another model\"}}}\n\ndata: [DONE]\n\n");
				},
			}));
		} catch (error) {
			failure = error;
		}
		expect(calls).toBe(3);
		expect(failure).toMatchObject({ retryWithCurrentModel: false });
	});

	test("does not treat an eligible SSE code with a quota message as overflow or fallback", async () => {
		let calls = 0;
		const failure = await captureFailure(callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"context_length_exceeded\",\"message\":\"quota exhausted\"}}}\n\ndata: [DONE]\n\n");
			},
		})));

		expect(calls).toBe(1);
		expect(failure).toMatchObject({ retryWithCurrentModel: false });
		expect(isContextWindowCompactionError(failure)).toBe(false);
	});

	test("maps HTTP usage errors and transient overloads separately", async () => {
		vi.useFakeTimers();
		for (const [status, body, expectedCalls, expectedFallback] of [
			[429, { error: { type: "usage_limit_reached", message: "try another model" } }, 1, false],
			[429, { error: { code: "insufficient_quota", message: "quota exceeded" } }, 1, false],
			[429, { error: { code: "rate_limit_reached", message: "slow down" } }, 3, true],
			[503, { error: { code: "server_is_overloaded", message: "busy" } }, 3, true],
		] as const) {
			let calls = 0;
			let failure: unknown;
			const promise = callRemoteCompaction(remoteRequest({
				fetchImpl: async () => {
					calls++;
					return new Response(JSON.stringify(body), { status });
				},
			}));
			const settled = promise.then(() => undefined, (error) => { failure = error; });
			await vi.runAllTimersAsync();
			await settled;
			expect(calls).toBe(expectedCalls);
			expect((failure as { retryWithCurrentModel?: boolean }).retryWithCurrentModel).toBe(expectedFallback);
		}
	});

	test.each([
		{
			name: "unknown HTTP 4xx code",
			response: () => new Response(JSON.stringify({ error: { code: "future_protocol_code" } }), { status: 400 }),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "unknown HTTP 5xx code",
			response: () => new Response(JSON.stringify({ error: { code: "future_protocol_code" } }), { status: 500 }),
			expectedFallback: false,
			expectedCalls: 3,
		},
		{
			name: "message-only HTTP protocol failure",
			response: () => new Response("protocol failure", { status: 500 }),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "canceled HTTP error",
			response: () => new Response(JSON.stringify({ error: { code: "canceled" } }), { status: 400 }),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "message-only HTTP usage limit",
			response: () => new Response(JSON.stringify({ error: { message: "usage limit reached" } }), { status: 429 }),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "message-only HTTP quota reached",
			response: () => new Response(JSON.stringify({ error: { message: "quota reached" } }), { status: 429 }),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "message-only HTTP quota exhausted",
			response: () => new Response(JSON.stringify({ error: { message: "quota exhausted" } }), { status: 429 }),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "quota response.failed error",
			response: () => sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"insufficient_quota\",\"message\":\"quota exceeded\"}}}\n\ndata: [DONE]\n\n"),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "policy response.failed error",
			response: () => sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"invalid_prompt\",\"message\":\"policy violation\"}}}\n\ndata: [DONE]\n\n"),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "machine-readable SSE error",
			response: () => sse("data: {\"type\":\"error\",\"code\":\"invalid_api_key\",\"message\":\"invalid request\"}\n\ndata: [DONE]\n\n"),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "malformed SSE data",
			response: () => sse([
				'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
				"data: {bad",
				'data: {"type":"response.completed"}',
			].join("\n\n") + "\n\n"),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "non-object SSE data",
			response: () => sse([
				'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
				"data: null",
				'data: {"type":"response.completed"}',
			].join("\n\n") + "\n\n"),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "missing response output item",
			response: () => sse([
				'data: {"type":"response.output_item.done"}',
				'data: {"type":"response.completed"}',
			].join("\n\n") + "\n\n"),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "null response output item",
			response: () => sse([
				'data: {"type":"response.output_item.done","item":null}',
				'data: {"type":"response.completed"}',
			].join("\n\n") + "\n\n"),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "non-object response output item after compaction",
			response: () => sse([
				'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
				'data: {"type":"response.output_item.done","item":"not-an-object"}',
				'data: {"type":"response.completed"}',
			].join("\n\n") + "\n\n"),
			expectedFallback: false,
			expectedCalls: 1,
		},
		{
			name: "unknown SSE message-only error",
			response: () => sse('data: {"type":"future.error","message":"unknown"}\n\n'),
			expectedFallback: false,
			expectedCalls: 3,
		},
		{
			name: "unknown SSE error event",
			response: () => sse('data: {"type":"future.error","code":"future_protocol_code","message":"unknown"}\n\n'),
			expectedFallback: false,
			expectedCalls: 3,
		},
		{
			name: "unknown SSE code",
			response: () => sse('data: {"type":"error","code":"new_protocol_code","message":"invalid request"}\n\n'),
			expectedFallback: false,
			expectedCalls: 3,
		},
	])("handles $name", async ({ response, expectedFallback, expectedCalls }) => {
		vi.useFakeTimers();
		let calls = 0;
		const promise = callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return response();
			},
		}));
		const failure = promise.catch(error => error);
		await vi.runAllTimersAsync();
		expect(await failure).toMatchObject({ retryWithCurrentModel: expectedFallback });
		expect(calls).toBe(expectedCalls);
	});

	test("accepts empty framing, DONE, and unknown SSE events", async () => {
		const result = await callRemoteCompaction(remoteRequest({
			fetchImpl: async () => sse([
				"",
				'data: {"type":"future.event","payload":"ignored"}',
				"data: [DONE]",
				'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
				'data: {"type":"response.completed","response":{"id":"response"}}',
			].join("\n\n") + "\n\n"),
		}));
		expect(result.compactionItem).toEqual({ type: "compaction", encrypted_content: "opaque" });
	});

	test("rejects a completed SSE response without an id", async () => {
		const failure = await captureFailure(callRemoteCompaction(remoteRequest({
			fetchImpl: async () => new Response([
				'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
				'data: {"type":"response.completed","response":{}}',
			].join("\n\n") + "\n\n", { headers: sseHeaders }),
		})));
		expect(failure).toMatchObject({
			message: "OpenAI Codex returned a malformed response.completed response.",
			retryWithCurrentModel: false,
		});
	});

	test.each([
		{
			name: "missing response tier falls back to request flex",
			modelId: "gpt",
			requestTier: "flex",
			responseTier: undefined,
			expectedCost: { input: 30, output: 10, cacheRead: 15, cacheWrite: 5, total: 60 },
		},
		{
			name: "response default keeps request priority for gpt-5.5",
			modelId: "gpt-5.5",
			requestTier: "priority",
			responseTier: "default",
			expectedCost: { input: 150, output: 50, cacheRead: 75, cacheWrite: 25, total: 300 },
		},
		{
			name: "explicit response flex overrides request priority",
			modelId: "gpt-5.5",
			requestTier: "priority",
			responseTier: "flex",
			expectedCost: { input: 30, output: 10, cacheRead: 15, cacheWrite: 5, total: 60 },
		},
		{
			name: "missing request and response tiers stay standard",
			modelId: "gpt",
			requestTier: undefined,
			responseTier: undefined,
			expectedCost: { input: 60, output: 20, cacheRead: 30, cacheWrite: 10, total: 120 },
		},
		{
			name: "explicit response priority uses the 2x multiplier for gpt",
			modelId: "gpt",
			requestTier: undefined,
			responseTier: "priority",
			expectedCost: { input: 120, output: 40, cacheRead: 60, cacheWrite: 20, total: 240 },
		},
	] as const)("applies service tier cost rules: $name", async ({ modelId, requestTier, responseTier, expectedCost }) => {
		const usage = {
			input_tokens: 100,
			output_tokens: 20,
			total_tokens: 120,
			input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
		};
		const body = [
			`data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "compaction", encrypted_content: "opaque" } })}`,
			`data: ${JSON.stringify({
				type: "response.completed",
				response: { id: "response", usage, ...(responseTier === undefined ? {} : { service_tier: responseTier }) },
			})}`,
		].join("\n\n") + "\n\n";
		const result = await callRemoteCompaction(remoteRequest({
			model: {
				id: modelId,
				provider: "openai-codex",
				api: "openai-codex-responses",
				cost: { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
			} as never,
			body: requestTier === undefined ? {} : { service_tier: requestTier },
			fetchImpl: async () => sse(body),
		}));

		expect(result.usage).toMatchObject({ input: 60, output: 20, cacheRead: 30, cacheWrite: 10, totalTokens: 120 });
		expect(result.usage?.cost).toEqual(expectedCost);
	});

	test("preserves nested SSE error details", async () => {
		let calls = 0;
		const failure = await captureFailure(callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return sse("data: {\"type\":\"error\",\"error\":{\"code\":\"invalid_prompt\",\"message\":\"nested invalid prompt\"}}\n\ndata: [DONE]\n\n");
			},
		})));
		expect(failure).toMatchObject({ message: "OpenAI Codex compaction failed (invalid_prompt): nested invalid prompt", retryWithCurrentModel: true });
		expect(calls).toBe(1);
	});

	test("keeps unknown credential-like HTTP and SSE failures fail-closed", async () => {
		vi.useFakeTimers();
		for (const [name, response] of [
			[
				"HTTP",
				() => new Response(
					JSON.stringify({ error: { code: "credential_backend_failure", message: "credential verification failed" } }),
					{ status: 503, headers: { "retry-after-ms": "0" } },
				),
			],
			[
				"SSE credential",
				() => sse(`data: {"type":"error","code":"credential_backend_failure","message":"credential verification failed"}\n\n`),
			],
			[
				"HTTP authorization",
				() => new Response(
					JSON.stringify({ error: { code: "authorization_backend_failure", message: "authorization failed" } }),
					{ status: 503, headers: { "retry-after-ms": "0" } },
				),
			],
			[
				"HTTP access denied",
				() => new Response(
					JSON.stringify({ error: { code: "access_denied", message: "access denied" } }),
					{ status: 400 },
				),
			],
			[
				"SSE policy",
				() => sse(`data: {"type":"error","code":"policy_backend_failure","message":"policy blocked"}\n\n`),
			],
		] as const) {
			let calls = 0;
			const promise = callRemoteCompaction(remoteRequest({
				fetchImpl: async () => {
					calls++;
					return response();
				},
			})).catch(error => error);
			await vi.runAllTimersAsync();
			const failure = await promise;
			expect(failure, name).toMatchObject({ retryWithCurrentModel: false });
			expect(calls, name).toBe(1);
		}
	});

	test("maps unknown provider error codes to stable safe classifications", () => {
		const unknown = new Error("OpenAI Codex compaction failed (credential_bearer_secret): Authorization Bearer secret");
		Object.defineProperty(unknown, "compactionCode", { value: "credential_bearer_secret" });

		expect(compactionFailureClassification(unknown)).toBe("authentication");
		expect(compactionFailureClassification(unknown)).toBe(compactionFailureClassification(unknown));
		expect(compactionFailureClassification(unknown)).not.toContain("credential_bearer_secret");
		expect(compactionFailureClassification(unknown)).not.toContain("secret");
	});

	test("uses a fixed HTTP classification for unknown credential-like codes", () => {
		const unknown = new Error("OpenAI Codex compaction failed (418): Authorization Bearer secret");
		Object.defineProperty(unknown, "compactionCode", { value: "credential_bearer_secret" });

		expect(compactionFailureClassification(unknown)).toBe("http_418");
		expect(compactionFailureClassification(unknown)).not.toContain("credential_bearer_secret");
		expect(compactionFailureClassification(unknown)).not.toContain("secret");
	});

	test("returns after a completed SSE event without waiting for EOF", async () => {
		let cancelled = false;
		const result = await callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode([
							'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
							'data: {"type":"response.completed","response":{"id":"response"}}',
						].join("\n\n") + "\n\n"));
					},
					cancel() {
						cancelled = true;
					},
				});
				return new Response(stream, { headers: { "content-type": "text/event-stream" } });
			},
		}));
		expect(result.compactionItem).toMatchObject({ type: "compaction", encrypted_content: "opaque" });
		expect(cancelled).toBe(true);
	});

	test("cancels an open SSE reader when the compaction is aborted", async () => {
		const controller = new AbortController();
		let started!: () => void;
		let cancelled = false;
		const streamStarted = new Promise<void>((resolve) => { started = resolve; });
		const pending = callRemoteCompaction(remoteRequest({
			signal: controller.signal,
			fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
				start() {
					started();
				},
				cancel() {
					cancelled = true;
				},
			}), { headers: { "content-type": "text/event-stream" } }),
		}));
		await streamStarted;
		controller.abort();
		const outcome = await Promise.race([
			pending.then(
				() => ({ state: "resolved" as const }),
				error => ({ state: "rejected" as const, error }),
			),
			new Promise<{ state: "timeout" }>((resolve) => setTimeout(() => resolve({ state: "timeout" }), 100)),
		]);
		expect(outcome).toMatchObject({ state: "rejected", error: { retryWithCurrentModel: false } });
		expect(cancelled).toBe(true);
	});

	test("aborts a timed-out request before retrying", async () => {
		vi.useFakeTimers();
		let attempts = 0;
		let firstActive = false;
		let firstAborted = false;
		let firstAbortReason: unknown;
		const pending = callRemoteCompaction(remoteRequest({
			fetchImpl: async (_url, init) => {
				attempts++;
				if (attempts === 1) {
					firstActive = true;
					const signal = init?.signal;
					if (!signal) throw new Error("missing abort signal");
					await new Promise<never>((_resolve, reject) => {
						signal.addEventListener("abort", () => {
							firstAborted = true;
							firstActive = false;
							firstAbortReason = signal.reason;
							reject(signal.reason);
						}, { once: true });
					});
				}
				return new Response("", { status: 400 });
			},
		}));
		const outcome = pending.then(() => undefined, error => error);

		await vi.advanceTimersByTimeAsync(300_000);
		expect(firstAbortReason).toMatchObject({
			message: "OpenAI Codex compaction request timed out.",
			retryWithCurrentModel: false,
		});
		expect(firstAborted).toBe(true);
		expect(firstActive).toBe(false);
		expect(attempts).toBe(1);

		await vi.advanceTimersByTimeAsync(1_000);
		expect(await outcome).toMatchObject({ retryWithCurrentModel: false });
		expect(attempts).toBe(2);
		expect(firstActive).toBe(false);
	});

	test("bounds a stalled authentication error body without retrying or losing its status", async () => {
		vi.useFakeTimers();
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel });
		let signal: AbortSignal | undefined;
		const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
			signal = init?.signal ?? undefined;
			return new Response(body, { status: 401 });
		});
		let error: any;
		const pending = callRemoteCompaction(remoteRequest({ fetchImpl })).catch(value => { error = value; });
		await vi.advanceTimersByTimeAsync(300_001);
		expect(error).toMatchObject({ retryWithCurrentModel: false });
		expect(error.message).toContain("(401)");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(signal?.aborted).toBe(true);
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(body.locked).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		await pending;
	});

	test.each([403, 429, 503])("bounds incomplete HTTP %i bodies and keeps retry classification", async (status) => {
		vi.useFakeTimers();
		const bodies: ReadableStream<Uint8Array>[] = [];
		const fetchImpl = vi.fn(async () => {
			const body = new ReadableStream<Uint8Array>();
			bodies.push(body);
			return new Response(body, { status, headers: { "retry-after": "0" } });
		});
		let error: any;
		const pending = callRemoteCompaction(remoteRequest({ fetchImpl })).catch(value => { error = value; });
		await vi.advanceTimersByTimeAsync(900_001);
		expect(error).toMatchObject({ retryWithCurrentModel: false });
		expect(error.message).toContain(`(${status})`);
		expect(fetchImpl).toHaveBeenCalledTimes(status === 503 ? 3 : 1);
		expect(bodies.every(body => !body.locked)).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		await pending;
	});

	test.each(["deadline", "cancel"])("ends a continuously streaming error body on %s", async (mode) => {
		vi.useFakeTimers();
		const controller = new AbortController();
		let enqueue!: (chunk: Uint8Array) => void;
		const body = new ReadableStream<Uint8Array>({ start(stream) { enqueue = chunk => stream.enqueue(chunk); } });
		const fetchImpl = vi.fn(async () => new Response(body, { status: 401 }));
		let error: any;
		const pending = callRemoteCompaction(remoteRequest({ signal: controller.signal, fetchImpl })).catch(value => { error = value; });
		for (let index = 0; index < 3; index++) {
			enqueue(new TextEncoder().encode("still receiving "));
			await vi.advanceTimersByTimeAsync(90_000);
		}
		if (mode === "cancel") controller.abort(new Error("User cancelled"));
		await vi.advanceTimersByTimeAsync(30_001);
		expect(error).toMatchObject({ retryWithCurrentModel: false });
		expect(error.message).toContain(mode === "cancel" ? "User cancelled" : "(401)");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(body.locked).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		await pending;
	});

	test("counts opaque reasoning and compaction payloads", () => {
		const opaque = "x".repeat(4_000);
		expect(approximateResponseItemTokens([{ type: "reasoning", encrypted_content: opaque }])).toBeGreaterThan(500);
		expect(approximateResponseItemTokens([{ type: "compaction", encrypted_content: opaque }])).toBeGreaterThan(500);
	});

	test("counts function-call metadata in approximate token accounting", () => {
		const tokens = approximateResponseItemTokens([{ type: "function_call", name: "a-very-long-tool-name", call_id: "call-123456789", arguments: "{}" } as never]);
		expect(tokens).toBeGreaterThan(1);
	});

	test("uses the first assistant usage after the current compaction window as its baseline", () => {
		const branch = [
			{ id: "before", type: "message", message: { role: "assistant", usage: { input: 900, cacheRead: 0, cacheWrite: 0, totalTokens: 950 } } },
			{ id: "checkpoint", type: "custom", customType: NATIVE_COMPACTION_KIND, data: {
				kind: NATIVE_COMPACTION_KIND,
				version: NATIVE_COMPACTION_VERSION,
				strategy: "v2",
				modelKey: "openai-codex:openai-codex-responses:gpt",
				replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
			} },
			{ id: "other-provider", type: "message", message: {
				role: "assistant",
				provider: "anthropic",
				api: "anthropic-messages",
				stopReason: "stop",
				usage: { input: 900, cacheRead: 0, cacheWrite: 0, totalTokens: 950 },
			} },
			{ id: "after", type: "message", message: {
				role: "assistant",
				provider: "openai-codex",
				api: "openai-codex-responses",
				stopReason: "stop",
				usage: { input: 100, cacheRead: 20, cacheWrite: 5, totalTokens: 150 },
			} },
		] as never;

		expect(estimateCompactionWindowPrefillTokens({ branch, stablePrefixTokens: 10 })).toBe(125);
	});

	test("leaves the body-after-prefix baseline unset before the first usage", () => {
		expect(estimateCompactionWindowPrefillTokens({
			branch: [{ id: "user", type: "message", message: { role: "user", content: "hello" } }] as never,
			stablePrefixTokens: 10,
		})).toBeUndefined();
	});

	test("estimates a new baseline from replacement history after compaction", () => {
		const branch = [{ id: "checkpoint", type: "custom", customType: NATIVE_COMPACTION_KIND, data: {
			kind: NATIVE_COMPACTION_KIND,
			version: NATIVE_COMPACTION_VERSION,
			strategy: "v2",
			modelKey: "openai-codex:openai-codex-responses:gpt",
			replacementHistory: [{ type: "compaction", encrypted_content: "x".repeat(4000) }],
	} }] as never;

		expect(estimateCompactionWindowPrefillTokens({ branch, stablePrefixTokens: 10 })).toBe(598);
	});

	test("keeps an unstructured HTTP 400 fail-closed", async () => {
		const failure = await captureFailure(callRemoteCompaction(remoteRequest({
			fetchImpl: async () => new Response("bad request details", { status: 400 }),
		})));
		expect(failure).toMatchObject({ retryWithCurrentModel: false });
	});

	test("keeps generic HTTP 403 out of model fallback", async () => {
		const failure = await captureFailure(callRemoteCompaction(remoteRequest({
			fetchImpl: async () => new Response("", { status: 403 }),
		})));
		expect(failure).toMatchObject({ retryWithCurrentModel: false });
	});

	test("uses the preceding real compaction boundary after a custom checkpoint", () => {
		const branch = [
			{ id: "old", type: "message", message: { role: "user", content: "old" } },
			{ id: "kept", type: "message", message: { role: "user", content: "kept" } },
			{ id: "real-compaction", type: "compaction", firstKeptEntryId: "kept", summary: "summary", details: {} },
			{ id: "custom", type: "custom", customType: NATIVE_COMPACTION_KIND, data: {
				kind: NATIVE_COMPACTION_KIND,
				version: NATIVE_COMPACTION_VERSION,
				strategy: "v2",
				modelKey: "openai-codex:openai-codex-responses:gpt",
				replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
			} },
			{ id: "tail", type: "message", message: { role: "user", content: "tail" } },
		] as never;
		const result = piContextInputForBranch({
			branch,
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt", reasoning: true } as never,
			tools: [],
		});
		expect(JSON.stringify(result)).toContain("kept");
		expect(JSON.stringify(result)).toContain("tail");
		expect(JSON.stringify(result)).not.toContain("old");
	});

	test("replays the full branch when a native checkpoint is malformed", () => {
		const branch = [
			{ id: "old", type: "message", message: { role: "user", content: "old" } },
			{ id: "kept", type: "message", message: { role: "user", content: "kept" } },
			{ id: "malformed", type: "compaction", firstKeptEntryId: "kept", details: {
				kind: NATIVE_COMPACTION_KIND,
				version: NATIVE_COMPACTION_VERSION,
				modelKey: "openai-codex:openai-codex-responses:gpt",
				replacementHistory: [],
			} },
			{ id: "tail", type: "message", message: { role: "user", content: "tail" } },
		] as never;
		const result = piContextInputForBranch({
			branch,
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt", reasoning: true } as never,
			tools: [],
		});
		expect(result).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "old" }] },
			{ role: "user", content: [{ type: "input_text", text: "kept" }] },
			{ role: "user", content: [{ type: "input_text", text: "tail" }] },
		]);
	});

	test("keeps Pi's compaction summary before retained entries", () => {
		const branch = [
			{ id: "old", type: "message", message: { role: "user", content: "old" } },
			{ id: "kept", type: "message", message: { role: "user", content: "kept" } },
			{ id: "real-compaction", type: "compaction", firstKeptEntryId: "kept", summary: "summary", details: {} },
			{ id: "tail", type: "message", message: { role: "user", content: "tail" } },
		] as never;
		const result = piContextInputForBranch({
			branch,
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt", reasoning: true } as never,
			tools: [],
		});
		const encoded = JSON.stringify(result);
		expect(encoded.indexOf("summary")).toBeLessThan(encoded.indexOf("kept"));
	});

	test("matches Pi message indexes across empty user entries", () => {
		const model = { provider: "openai-codex", api: "openai-codex-responses", id: "current", reasoning: true } as never;
		const branch = [
			{
				id: "tool-call",
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: {
					role: "assistant",
					provider: "openai-codex",
					api: "openai-codex-responses",
					model: "previous",
					content: [{ type: "toolCall", id: "call|fc_old", name: "bash", arguments: {} }],
				},
			} as never,
			{
				id: "empty-user",
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: { role: "user", content: [] },
			} as never,
			{
				id: "visible",
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: {
					role: "assistant",
					provider: "openai-codex",
					api: "openai-codex-responses",
					model: "previous",
					content: [{ type: "text", text: "visible" }],
				},
			} as never,
		];
		const result = fullInputForBranch({ branch, model, tools: [] });
		expect(result.at(-1)).toMatchObject({ id: "msg_pi_2" });
	});

	test("matches Pi's deferred-tool capability and strict-mode shapes", () => {
		const tool = { ...fixtureToolInfo, name: "lazy", description: "lazy tool", parameters: { type: "object", properties: {} } };
		const branch = [
			{
				id: "tool-call",
				type: "message",
				message: {
					role: "assistant",
					provider: "openai-codex",
					api: "openai-codex-responses",
					model: "gpt",
					content: [{ type: "toolCall", id: "call|fc", name: "bash", arguments: {} }],
				},
			},
			{
				id: "tool-result",
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "call|fc",
					toolName: "bash",
					content: [{ type: "text", text: "ok" }],
					isError: false,
					addedToolNames: ["lazy"],
				},
			},
			{ id: "tool-update", type: "message", message: { role: "system", content: "", toolsAdded: [tool], timestamp: 0 } },
		] as never;
		const additionalTools = fullInputForBranch({
			branch,
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt", compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } } as never,
			tools: [tool],
		});
		expect(additionalTools).toContainEqual({
			type: "additional_tools",
			role: "developer",
			tools: [{ type: "function", name: "lazy", description: "lazy tool", parameters: { type: "object", properties: {} }, strict: null }],
		});
		const additionalToolsWithoutStrict = fullInputForBranch({
			branch,
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt", compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsStrictMode: false } } as never,
			tools: [tool],
		});
		expect(additionalToolsWithoutStrict).toContainEqual({
			type: "additional_tools",
			role: "developer",
			tools: [{ type: "function", name: "lazy", description: "lazy tool", parameters: { type: "object", properties: {} } }],
		});

		const toolSearch = fullInputForBranch({
			branch,
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt", compat: { supportsMidConvoSystemMessages: true, supportsToolSearch: true, supportsStrictMode: false } } as never,
			tools: [tool],
		});
		expect(toolSearch).toContainEqual({
			type: "tool_search_output",
			call_id: expect.any(String),
			execution: "client",
			status: "completed",
			tools: [{ type: "function", name: "lazy", description: "lazy tool", parameters: { type: "object", properties: {} }, defer_loading: true }],
		});

		const unsupported = fullInputForBranch({
			branch,
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt", compat: {} } as never,
			tools: [tool],
		});
		expect(unsupported.some((item) => item.type === "additional_tools" || item.type === "tool_search_call" || item.type === "tool_search_output")).toBe(false);
		expect(buildToolPayload([tool], ["lazy"], false)).toEqual([
			{ type: "function", name: "lazy", description: "lazy tool", parameters: { type: "object", properties: {} } },
		]);
	});

	test("preserves checkpoint declarations without replaying obsolete addedToolNames", () => {
		const lazyTool = { ...fixtureToolInfo, name: "lazy", description: "lazy tool", parameters: { type: "object", properties: {} } };
		const newTool = { ...fixtureToolInfo, name: "new", description: "new tool", parameters: { type: "object", properties: {} } };
		const prefix = {
			type: "additional_tools",
			role: "developer",
			tools: [{ type: "function", name: "lazy", description: "lazy tool", parameters: { type: "object", properties: {} }, strict: null }],
		};
		const branch = [
			{
				id: "checkpoint",
				type: "custom",
				customType: NATIVE_COMPACTION_KIND,
				data: {
					kind: NATIVE_COMPACTION_KIND,
					version: NATIVE_COMPACTION_VERSION,
					strategy: "v2",
					modelKey: "openai-codex:openai-codex-responses:gpt",
					preservedInput: [prefix],
					replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
				},
			},
			{
				id: "result-1",
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "call|one",
					toolName: "bash",
					content: [{ type: "text", text: "one" }],
					addedToolNames: ["lazy", "new", "new"],
				},
			},
			{
				id: "result-2",
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "call|two",
					toolName: "bash",
					content: [{ type: "text", text: "two" }],
					addedToolNames: ["new"],
				},
			},
		] as never;
		const result = effectiveInputForBranch({
			branch,
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt", compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } } as never,
			tools: [lazyTool, newTool],
		});
		expect(result.filter((item) => item.type === "additional_tools")).toEqual([
			prefix,
			{ type: "additional_tools", role: "developer", tools: [lazyTool, newTool].map(({ exposure, sourceInfo, ...tool }) => ({ ...tool, type: "function", strict: null })) },
		]);
	});

	test("keeps recent message items and drops tool history", () => {
		const result = retainRecentMessages([
			{ type: "message", role: "user", content: [{ type: "input_text", text: "old" }] },
			{ type: "function_call", name: "shell", arguments: "{}" },
			{ type: "function_call_output", call_id: "1", output: "secret" },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
		]);

		expect(result.map((item) => item.role ?? item.type)).toEqual(["user"]);
	});

	test("drops developer and system messages by default", () => {
		const result = retainRecentMessages([
			{ type: "message", role: "developer", content: [{ type: "input_text", text: "developer" }] },
			{ type: "message", role: "system", content: [{ type: "input_text", text: "system" }] },
		]);
		expect(result).toEqual([]);
	});

	test("keeps an attached image resize notice with its retained source", () => {
		const userImage = { type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,x" }] };
		const userNotice = {
			type: "message",
			role: "developer",
			content: [{ type: "input_text", text: "\n<image_resize_notice>\nImage 1 of 1 in the preceding user message was resized.\n</image_resize_notice>\n" }],
		};
		const toolNotice = {
			type: "message",
			role: "developer",
			content: [{ type: "input_text", text: "\n<image_resize_notice>\nImage 1 of 1 in the preceding tool output was resized.\n</image_resize_notice>\n" }],
		};
		const result = retainRecentMessages([
			userImage,
			userNotice,
			{ type: "message", role: "developer", content: [{ type: "input_text", text: "unlisted notice" }] },
			{ type: "function_call_output", call_id: "tool", output: "tool output" },
			toolNotice,
		]);
		expect(result).toEqual([userImage, userNotice]);
	});

	test("retains eligible agent messages within the per-item limit", () => {
		const result = retainRecentMessages([
			{ type: "agent_message", content: [{ type: "input_text", text: "Message Type: COMMENTARY\nsmall" }] },
		]);
		expect(result).toHaveLength(1);
	});

	test("drops oversized and final-answer agent messages", () => {
		const result = retainRecentMessages([
			{ type: "agent_message", author: "a", recipient: "b", content: [{ type: "input_text", text: `Message Type: COMMENTARY\n${"x".repeat(40_000)}` }] },
			{ type: "agent_message", author: "a", recipient: "b", content: [{ type: "input_text", text: "Message Type: FINAL_ANSWER\ndone" }] },
		]);
		expect(result).toEqual([]);
	});

	test("drops descendant progress agent messages even when they are small", () => {
		const result = retainRecentMessages([
			{ type: "agent_message", author: "root/child", recipient: "root", content: [{ type: "input_text", text: "Message Type: MESSAGE\nprogress" }] },
		]);
		expect(result).toEqual([]);
	});

	test("accepts the wire-shaped AgentMessage in a current checkpoint", () => {
		const details = parseNativeCompactionDetails({
			kind: NATIVE_COMPACTION_KIND,
			version: NATIVE_COMPACTION_VERSION,
			strategy: "v2",
			modelKey: "openai-codex:openai-codex-responses:test",
			replacementHistory: [
				{
					type: "agent_message",
					author: "root",
					recipient: "root/child",
					content: [{ type: "input_text", text: "Message Type: COMMENTARY\\nkeep" }],
				},
				{ type: "compaction", encrypted_content: "opaque" },
			],
		});
		expect(details?.replacementHistory).toHaveLength(2);
	});

	test("rejects malformed nested AgentMessage content", () => {
		const details = parseNativeCompactionDetails({
			kind: NATIVE_COMPACTION_KIND,
			version: NATIVE_COMPACTION_VERSION,
			strategy: "v2",
			modelKey: "openai-codex:openai-codex-responses:test",
			replacementHistory: [
				{
					type: "agent_message",
					author: "root",
					recipient: "root/child",
					content: [{ type: "input_text", text: 42 }],
				},
				{ type: "compaction", encrypted_content: "opaque" },
			],
		});
		expect(details).toBeUndefined();
	});

	test("rejects role-only AgentMessage checkpoints", () => {
		const details = parseNativeCompactionDetails({
			kind: NATIVE_COMPACTION_KIND,
			version: NATIVE_COMPACTION_VERSION,
			strategy: "v2",
			modelKey: "openai-codex:openai-codex-responses:test",
			replacementHistory: [
				{
					type: "agent_message",
					role: "assistant",
					content: [{ type: "input_text", text: "legacy" }],
				},
				{ type: "compaction", encrypted_content: "opaque" },
			],
		});
		expect(details).toBeUndefined();
	});

	test("does not share the agent-message limit across items", () => {
		const result = retainRecentMessages([
			{ type: "agent_message", content: [{ type: "input_text", text: "x".repeat(24_000) }] },
			{ type: "agent_message", content: [{ type: "input_text", text: "y".repeat(24_000) }] },
		]);
		expect(result).toHaveLength(2);
	});

	test("retains image-only user messages", () => {
		const result = retainRecentMessages([
			{ type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,x" }] },
		]);
		expect(result).toHaveLength(1);
	});

	test("charges retained images to Codex's content budget", () => {
		expect(approximateResponseItemTokens([{ type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,x" }] }])).toBeGreaterThanOrEqual(1_200);
		expect(approximateResponseItemTokens([{ type: "function_call_output", output: [{ type: "input_image", image_url: "data:image/png;base64,x" }, { type: "input_image", image_url: "data:image/png;base64,x" }] }])).toBeGreaterThanOrEqual(3_688);
		expect(approximateResponseItemTokens([{ type: "function_call_output", output: [{ type: "input_image", image_url: `data:image/png;base64,${"x".repeat(40_000)}` }] }])).toBeLessThan(2_000);
		expect(retainRecentMessages([{ type: "message", role: "user", content: [{ type: "input_image" }] }], 1_199)).toEqual([]);
		expect(retainRecentMessages([
			{ type: "message", role: "user", content: [{ type: "input_image", image_url: "old" }] },
			{ type: "message", role: "user", content: [{ type: "input_image", image_url: "new" }] },
		], 1_844)).toEqual([
			{ type: "message", role: "user", content: [{ type: "input_image", image_url: "new" }] },
		]);
	});

	test("truncates an oversized message without throwing", () => {
		const result = retainRecentMessages([
			{ type: "message", role: "user", content: [{ type: "input_text", text: "abcdefghij" }] },
		], 1);
		expect(result[0]?.content).toEqual([{ type: "input_text", text: "ab…2 tokens truncated…ij" }]);
	});

	test("replaces an oversized function output with Codex's marker", () => {
		const result = trimFunctionCallHistoryToFitContextWindow([
			{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
			{ type: "function_call_output", call_id: "1", output: "1234567890" },
		], 2);
		expect(result[1]?.output).toBe("Output exceeded the available model context and was truncated");
	});

	test("keeps Codex's marker when the remaining budget is tiny", () => {
		const result = trimFunctionCallHistoryToFitContextWindow([
			{ type: "function_call_output", call_id: "1", output: "1234567890" },
		], 4, 2);
		expect(result[0]?.output).toBe("Output exceeded the available model context and was truncated");
	});

	test("rewrites oversized output before its attached image resize notice", () => {
		const notice = {
			type: "message",
			role: "developer",
			content: [{
				type: "input_text",
				text: "<image_resize_notice>tool output resized</image_resize_notice>",
			}],
		};
		const result = trimFunctionCallHistoryToFitContextWindow([
			{ type: "function_call_output", call_id: "call", output: "x".repeat(1_000) },
			notice,
		], 10);

		expect(result[0]?.output).toBe("Output exceeded the available model context and was truncated");
		expect(result[1]).toEqual(notice);
	});

	test("replaces image-bearing function output with Codex's truncation marker", () => {
		const result = trimFunctionCallHistoryToFitContextWindow([
			{ type: "function_call_output", output: [{ type: "input_image", image_url: "data:image/png;base64,large" }] },
		], 100);
		expect(result[0]?.output).toBe("Output exceeded the available model context and was truncated");
	});

	test("limits suffix recovery to context-window errors", () => {
		expect(isContextWindowCompactionError(new Error("context_length_exceeded"))).toBe(true);
		expect(isContextWindowCompactionError(new Error("policy violation in context window"))).toBe(false);
		expect(isContextWindowCompactionError(new Error("invalid_prompt: context window"))).toBe(false);
		expect(isContextWindowCompactionError(new Error("context window exceeded"))).toBe(false);
		const policyError = new Error("policy violation");
		Object.defineProperty(policyError, "compactionCode", { value: "context_length_exceeded" });
		expect(isContextWindowCompactionError(policyError)).toBe(false);
		expect(isContextWindowCompactionError(new Error("auth failure context_length_exceeded"))).toBe(false);
		expect(isContextWindowCompactionError(new Error("policy denied context_length_exceeded"))).toBe(false);
		const invalidPromptError = new Error("invalid_prompt: context_length_exceeded");
		Object.defineProperty(invalidPromptError, "compactionCode", { value: "context_length_exceeded" });
		expect(isContextWindowCompactionError(invalidPromptError)).toBe(false);
	});

	test("trims the newest function output first", () => {
		const result = trimFunctionCallHistoryToFitContextWindow([
			{ type: "function_call_output", call_id: "old", output: "old".repeat(20) },
			{ type: "function_call_output", call_id: "new", output: "new".repeat(200) },
		], 120);
		expect(result[0]?.output).toBe("old".repeat(20));
		expect(result[1]?.output).toBe("Output exceeded the available model context and was truncated");
	});

	test("does not rewrite older output past a non-truncatable newest message", () => {
		const oldOutput = { type: "function_call_output", call_id: "old", output: "old".repeat(200) };
		const newestMessage = { type: "message", role: "assistant", content: [{ type: "output_text", text: "keep" }] };
		const result = trimFunctionCallHistoryToFitContextWindow([oldOutput, newestMessage], 20);
		expect(result).toEqual([oldOutput, newestMessage]);
	});

	test("keeps machine-readable auth and policy errors out of model fallback", async () => {
		for (const body of ['{"code":"invalid_api_key"}', '{"code":"policy_violation"}']) {
			const failure = await captureFailure(callRemoteCompaction(remoteRequest({
				fetchImpl: async () => new Response(body, { status: 400 }),
			})));
			expect(failure).toMatchObject({ retryWithCurrentModel: false });
		}
	});

	test("exhausts transient network retries without exposing a UI retry contract", async () => {
		let calls = 0;
		const failure = await captureFailure(callRemoteCompaction(remoteRequest({
			fetchImpl: async () => {
				calls++;
				return new Response("temporary", {
					status: 503,
					headers: { "retry-after-ms": "0" },
				});
			},
		})));
		expect(failure).toMatchObject({ retryWithCurrentModel: true });
		expect(calls).toBe(3);
	});

	test("always appends exactly one valid compaction checkpoint", () => {
		const result = buildReplacementHistory(
			[{ type: "message", role: "user", content: [{ type: "input_text", text: "keep" }] }],
			{ type: "compaction", encrypted_content: "opaque" },
		);

		expect(result.at(-1)).toEqual({ type: "compaction", encrypted_content: "opaque" });
	});

	test("rejects a non-V2 checkpoint strategy", () => {
		expect(parseNativeCompactionDetails({
			kind: "openai-codex-native-compaction",
			version: NATIVE_COMPACTION_VERSION,
			strategy: "v1",
			modelKey: "openai-codex:openai-codex-responses:test",
			replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
		})).toBeUndefined();
	});

	test("rejects a non-native checkpoint", () => {
		expect(() => buildReplacementHistory([], { type: "message", role: "assistant", content: [] })).toThrow();
	});

	test("accepts persisted V2 checkpoints with or without strategy", () => {
		const checkpoint = {
			kind: "openai-codex-native-compaction",
			version: NATIVE_COMPACTION_VERSION,
			modelKey: "openai-codex:openai-codex-responses:test",
			compHash: "3000",
			replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
		};
		for (const strategy of [undefined, "v2"]) {
			expect(parseNativeCompactionDetails({ ...checkpoint, ...(strategy ? { strategy } : {}) })?.compHash).toBe("3000");
		}
	});

	test("scopes a checkpoint bypass to its target model", () => {
		const timestamp = new Date().toISOString();
		const branch = [
			{
				id: "checkpoint",
				parentId: null,
				timestamp,
				type: "custom",
				customType: NATIVE_COMPACTION_KIND,
				data: {
					kind: NATIVE_COMPACTION_KIND,
					version: NATIVE_COMPACTION_VERSION,
					modelKey: "openai-codex:openai-codex-responses:old",
					replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
				},
			},
			{
				id: "bypass",
				parentId: "checkpoint",
				timestamp,
				type: "custom",
				customType: NATIVE_COMPACTION_BYPASS_KIND,
				data: {
					kind: NATIVE_COMPACTION_BYPASS_KIND,
					version: NATIVE_COMPACTION_BYPASS_VERSION,
					gateEntryId: "checkpoint",
					targetModelKey: "openai-codex:openai-codex-responses:new",
				},
			},
		] as never;
		expect(findNativeCheckpoint(branch, "openai-codex:openai-codex-responses:new").status).toBe("bypassed");
		expect(findNativeCheckpoint(branch, "openai-codex:openai-codex-responses:old").status).toBe("valid");
	});

	test("ignores a version-one checkpoint", () => {
		expect(findNativeCheckpoint([{
			id: "v1",
			parentId: null,
			timestamp: new Date().toISOString(),
			type: "custom",
			customType: NATIVE_COMPACTION_KIND,
			data: {
				kind: NATIVE_COMPACTION_KIND,
				version: 1,
				strategy: "v2",
				modelKey: "openai-codex:openai-codex-responses:test",
				replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
			},
		}] as never).status).toBe("none");
	});

	test("ignores the removed local token-budget checkpoint", () => {
		expect(findNativeCheckpoint([{
			id: "local",
			parentId: null,
			timestamp: new Date().toISOString(),
			type: "custom",
			customType: NATIVE_COMPACTION_KIND,
			data: {
				kind: NATIVE_COMPACTION_KIND,
				version: 1,
				strategy: "token-budget",
				modelKey: "openai-codex:openai-codex-responses:test",
				replacementHistory: [],
			},
		}] as never).status).toBe("none");
	});

	test("does not replay a V2 checkpoint before a newer token-budget checkpoint", () => {
		const timestamp = new Date().toISOString();
		expect(findNativeCheckpoint([
			{
				id: "v2",
				parentId: null,
				timestamp,
				type: "custom",
				customType: NATIVE_COMPACTION_KIND,
				data: {
					kind: NATIVE_COMPACTION_KIND,
					version: NATIVE_COMPACTION_VERSION,
					strategy: "v2",
					modelKey: "openai-codex:openai-codex-responses:test",
					replacementHistory: [{ type: "compaction", encrypted_content: "old" }],
				},
			},
			{
				id: "local",
				parentId: "v2",
				timestamp,
				type: "custom",
				customType: NATIVE_COMPACTION_KIND,
				data: {
					kind: NATIVE_COMPACTION_KIND,
					version: NATIVE_COMPACTION_VERSION,
					strategy: "token-budget",
					modelKey: "openai-codex:openai-codex-responses:test",
					replacementHistory: [{ type: "compaction", encrypted_content: "local" }],
				},
			},
		] as never).status).toBe("none");
	});

	test("rejects the removed token-budget strategy in a current checkpoint", () => {
		expect(parseNativeCompactionDetails({
			kind: "openai-codex-native-compaction",
			version: NATIVE_COMPACTION_VERSION,
			strategy: "token-budget",
			modelKey: "openai-codex:openai-codex-responses:test",
			replacementHistory: [],
		})).toBeUndefined();
	});
});
