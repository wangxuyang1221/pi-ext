import { expect, test, vi } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import codexCompactionExtension from "../src/index.js";
import { effectiveInputForBranch, FAILED_REQUEST_KIND, NATIVE_COMPACTION_KIND } from "../src/native-compaction.js";

type Handler = (event: any, ctx: any) => unknown;

const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } })).toString("base64url")}.c`;

function checkpointEntry(): SessionEntry {
	return {
		id: "checkpoint",
		parentId: null,
		timestamp: new Date().toISOString(),
		type: "custom",
		customType: NATIVE_COMPACTION_KIND,
		data: {
			kind: NATIVE_COMPACTION_KIND,
			version: 2,
			modelKey: "openai-codex:openai-codex-responses:gpt",
			replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
		},
	} as unknown as SessionEntry;
}

function installExtension(branch: SessionEntry[] = [], hasUI = false, contextWindow = 100_000) {
	const handlers = new Map<string, Handler>();
	const notify = vi.fn();
	const setStatus = vi.fn();
	const setWidget = vi.fn();
	const model = {
		provider: "openai-codex",
		api: "openai-codex-responses",
		id: "gpt",
		contextWindow,
		reasoning: true,
		compat: {},
	};
	const sessionManager = {
		getSessionId: () => "session",
		getBranch: () => branch,
		getEntries: () => branch,
	};
	const ctx = {
		cwd: process.cwd(),
		isProjectTrusted: () => true,
		hasUI,
		ui: { notify, setStatus, setWidget },
		abort: vi.fn(),
		signal: new AbortController().signal,
		model,
		thinkingLevel: "high",
		getSystemPrompt: () => "system instructions",
		sessionManager,
		modelRegistry: {
			find: (provider: string, id: string) => provider === model.provider && id === model.id ? model : undefined,
			getApiKeyAndHeaders: async () => ({
				ok: true,
				apiKey,
				headers: {},
				baseUrl: "https://example.test/backend-api",
			}),
		},
	};
	const appendEntry = vi.fn();
	codexCompactionExtension({
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		getAllTools: () => [],
		getActiveTools: () => [],
		appendEntry,
	} as never);
	return { handlers, ctx, model, notify, setStatus, setWidget, appendEntry };
}

function stubSuccessfulCompaction(encryptedContent = "opaque"): void {
	vi.stubGlobal("fetch", async () => new Response([
		`data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"${encryptedContent}"}}`,
		'data: {"type":"response.completed","response":{"id":"response"}}',
	].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));
}

function piCompactionEvent(
	branch: SessionEntry[],
	reason: "manual" | "threshold" | "overflow" = "manual",
	willRetry = reason === "overflow",
) {
	return {
		branchEntries: branch,
		preparation: { firstKeptEntryId: "first-kept", tokensBefore: 1234 },
		reason,
		willRetry,
		signal: new AbortController().signal,
	};
}

async function flushPostCompactionNotices(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test.each([
	{ name: "avoids premature compaction for an inflated estimate", length: 40000, usage: 130, compact: false, invalidate: "" },
	{ name: "compacts when server usage reaches 90 percent despite a small estimate", length: 100, usage: 9000, compact: true, invalidate: "" },
	...["session_tree", "session_start", "model_select", "system_prompt"].map((invalidate) => ({ name: `falls back after ${invalidate}`, length: 40000, usage: 130, compact: true, invalidate })),
])("observed usage $name", async ({ length, usage, compact, invalidate }) => {
	const text = "x".repeat(length);
	const branch = [{ type: "message", id: "u", parentId: null, timestamp: "2026-01-01", message: { role: "user", content: text } }] as SessionEntry[];
	const { handlers, ctx, model } = installExtension(branch, false, 10000);
	const input = [{ role: "user", content: [{ type: "input_text", text }] }];
	await handlers.get("before_provider_request")?.({ payload: { input } }, ctx);
	const message = {
		role: "assistant", provider: model.provider, api: model.api, model: model.id,
		content: [{ type: "text", text: "ok" }], stopReason: "stop", timestamp: 1,
		usage: { input: usage - 50, output: 20, cacheRead: 30, cacheWrite: 0, totalTokens: usage },
	};
	await handlers.get("message_end")?.({ message }, ctx);
	branch.push({ type: "message", id: "a", parentId: "u", timestamp: "2026-01-01", message } as SessionEntry);
	branch.push({ type: "message", id: "next", parentId: "a", timestamp: "2026-01-01", message: { role: "user", content: "next", timestamp: 2 } });
	if (invalidate === "system_prompt") ctx.getSystemPrompt = () => "changed instructions";
	else if (invalidate) await handlers.get(invalidate)?.({ model, previousModel: model }, ctx);
	stubSuccessfulCompaction();
	const fetchSpy = vi.spyOn(globalThis, "fetch");
	try {
		await handlers.get("before_provider_request")?.({ payload: { input: effectiveInputForBranch({ branch, model: model as never, tools: [] }) } }, ctx);
		expect(fetchSpy).toHaveBeenCalledTimes(compact ? 1 : 0);
		expect(ctx.abort).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
	}
});

test.each(["instructions", "tools"])("counts the observed %s prefix when no usage baseline exists", async (field) => {
	const branch = [
		{ type: "message", id: "u", parentId: null, timestamp: "2026-01-01", message: { role: "user", content: "task" } },
		{ type: "message", id: "a", parentId: "u", timestamp: "2026-01-01", message: { role: "assistant", provider: "openai-codex", api: "openai-codex-responses", model: "gpt", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } } },
		{ type: "message", id: "next", parentId: "a", timestamp: "2026-01-01", message: { role: "user", content: "continue", timestamp: 2 } },
	] as SessionEntry[];
	const { handlers, ctx, model } = installExtension(branch, false, 10000);
	const input = effectiveInputForBranch({ branch, model: model as never, tools: [] });
	const prefix = field === "instructions" ? { instructions: "x".repeat(36000) } : { tools: [{ type: "function", name: "inspect", description: "x".repeat(36000), parameters: { type: "object" } }] };
	stubSuccessfulCompaction();
	const fetchSpy = vi.spyOn(globalThis, "fetch");
	try {
		await handlers.get("before_provider_request")?.({ payload: { ...prefix, input } }, ctx);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(ctx.abort).not.toHaveBeenCalled();
	} finally { vi.unstubAllGlobals(); }
});

test("removes unsupported prompt cache retention from Codex requests", async () => {
	const { handlers, ctx } = installExtension();
	const payload = { input: [], prompt_cache_retention: "24h" };

	await expect(handlers.get("before_provider_request")?.({ payload }, ctx)).resolves.toBe(payload);
	expect(payload).not.toHaveProperty("prompt_cache_retention");
});

test.each([false, true])("reads legacy failure diagnostics with recoveryAttempted=%s without rewriting the marker", async (recoveryAttempted) => {
	const secret = "stale-failed-input";
	const branch = [
		{
			id: "failed-user",
			parentId: null,
			timestamp: new Date().toISOString(),
			type: "message",
			message: { role: "user", content: [{ type: "text", text: secret }] },
		},
		{
			id: "failed-marker",
			parentId: "failed-user",
			timestamp: new Date().toISOString(),
			type: "custom",
			customType: FAILED_REQUEST_KIND,
			data: { kind: FAILED_REQUEST_KIND, entryId: "failed-user", diagnostics: { phase: "before_provider_request", code: "context_window_exceeded", recoveryAttempted } },
		},
	] as never;
	const before = structuredClone(branch);
	const { handlers, ctx, appendEntry } = installExtension(branch);
	const result = await handlers.get("before_provider_request")?.({
		payload: {
			input: [
				{ role: "user", content: [{ type: "input_text", text: secret }] },
				{ role: "user", content: [{ type: "input_text", text: "retry" }] },
			],
		},
	}, ctx);

	expect(result).toEqual({ input: [{ role: "user", content: [{ type: "input_text", text: "retry" }] }] });
	expect(JSON.stringify(result)).not.toContain(secret);
	expect(ctx.abort).not.toHaveBeenCalled();
	expect(branch).toEqual(before);
	expect(appendEntry).not.toHaveBeenCalled();
});

test("clears presentation and aborts rather than retrying a history suffix", async () => {
	const branch = [checkpointEntry(), {
		id: "history",
		parentId: "checkpoint",
		timestamp: new Date().toISOString(),
		type: "message",
		message: { role: "user", content: [{ type: "text", text: "branch".repeat(1000) }] },
	} as never];
	const before = structuredClone(branch);
	const { handlers, ctx, notify, setStatus, setWidget, appendEntry } = installExtension(branch, true, 1000);
	const fetchMock = vi.fn()
		.mockResolvedValueOnce(new Response(
			JSON.stringify({ error: { code: "context_length_exceeded", message: "retry with a shorter history" } }),
			{ status: 400 },
		))
		.mockResolvedValueOnce(new Response([
			'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
			'data: {"type":"response.completed","response":{"id":"response"}}',
		].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));
	vi.stubGlobal("fetch", fetchMock);
	try {
		await handlers.get("before_provider_request")?.({
			payload: {
				input: [
					...effectiveInputForBranch({ branch, model: ctx.model as never, tools: [] }),
					{ role: "user", content: [{ type: "input_text", text: "current" }] },
				],
			},
		}, ctx);
	} finally {
		vi.unstubAllGlobals();
	}

	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(ctx.abort).toHaveBeenCalledTimes(1);
	expect(branch).toEqual(before);
	expect(appendEntry).not.toHaveBeenCalledWith(NATIVE_COMPACTION_KIND, expect.anything());
	expect(setStatus).not.toHaveBeenCalled();
	expect(setWidget).toHaveBeenCalledTimes(2);
	expect(setWidget).toHaveBeenNthCalledWith(
		1,
		"codex-compact",
		expect.any(Function),
		{ placement: "aboveEditor" },
	);
	expect(setWidget).toHaveBeenNthCalledWith(
		2,
		"codex-compact",
		undefined,
		{ placement: "aboveEditor" },
	);
	const factory = setWidget.mock.calls[0]?.[1] as ((
		tui: { requestRender(): void },
		theme: { fg(_color: string, text: string): string },
	) => { render(width: number): string[] }) | undefined;
	expect(factory).toBeTypeOf("function");
	expect(factory?.({ requestRender() {} }, { fg: (_color, text) => text }).render(80)).toEqual([
		"⠋ Compacting context... (esc to cancel)",
		"",
	]);
	expect(notify).toHaveBeenCalledWith(expect.stringContaining("code=context_length_exceeded; model=gpt; recoveryAttempted=false; outcome=request_aborted; next=shorten the request or start a new session"), "error");
	expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("Codex context compacted"), "info");
});

test("clears an active request-side presentation when the session tree changes", async () => {
	const branch = [checkpointEntry(), {
		id: "history",
		parentId: "checkpoint",
		timestamp: new Date().toISOString(),
		type: "message",
		message: { role: "user", content: [{ type: "text", text: "branch".repeat(1000) }] },
	} as never];
	const { handlers, ctx, setWidget } = installExtension(branch, true, 1000);
	let resolveFetch!: (response: Response) => void;
	let markFetchStarted!: () => void;
	const fetchStarted = new Promise<void>((resolve) => {
		markFetchStarted = resolve;
	});
	const fetchResponse = new Promise<Response>((resolve) => {
		resolveFetch = resolve;
	});
	vi.stubGlobal("fetch", async () => {
		markFetchStarted();
		return fetchResponse;
	});
	const request = handlers.get("before_provider_request")?.({
		payload: {
			input: [
				...effectiveInputForBranch({ branch, model: ctx.model as never, tools: [] }),
				{ role: "user", content: [{ type: "input_text", text: "current" }] },
			],
		},
	}, ctx) as Promise<unknown>;
	try {
		await fetchStarted;
		handlers.get("session_tree")?.({}, ctx);
		expect(setWidget).toHaveBeenNthCalledWith(
			2,
			"codex-compact",
			undefined,
			{ placement: "aboveEditor" },
		);
	} finally {
		resolveFetch(new Response([
			'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
			'data: {"type":"response.completed","response":{"id":"response"}}',
		].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));
		await request;
		vi.unstubAllGlobals();
	}
});

test.each(["session_tree", "session_start"])("does not clear or abort a newer request when stale compaction fails after %s", async (eventName) => {
	const branch = [checkpointEntry(), {
		id: "history", parentId: "checkpoint", timestamp: "2026-01-01", type: "message",
		message: { role: "user", content: "history".repeat(1000) },
	}] as SessionEntry[];
	const { handlers, ctx, model, setWidget, notify } = installExtension(branch, true, 1000);
	const pending: Array<(response: Response) => void> = [];
	const started: Array<() => void> = [];
	const starts = [0, 1].map(() => new Promise<void>((resolve) => started.push(resolve)));
	vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => {
		pending.push(resolve);
		started[pending.length - 1]!();
	}));
	const payload = () => ({ input: [...effectiveInputForBranch({ branch, model: model as never, tools: [] }), { role: "user", content: [{ type: "input_text", text: "continue" }] }] });
	const first = handlers.get("before_provider_request")!({ payload: payload() }, ctx) as Promise<unknown>;
	let second: Promise<unknown> | undefined;
	const overflow = () => new Response(JSON.stringify({ error: { code: "context_length_exceeded", message: "too large" } }), { status: 400 });
	try {
		await starts[0];
		await handlers.get(eventName)!({ model, previousModel: model }, ctx);
		expect(ctx.abort).toHaveBeenCalledTimes(1);
		ctx.signal = new AbortController().signal;
		second = handlers.get("before_provider_request")!({ payload: payload() }, ctx) as Promise<unknown>;
		await starts[1];
		const activeWidget = setWidget.mock.calls.at(-1)?.[1];
		expect(activeWidget).toBeTypeOf("function");
		pending[0]!(overflow());
		await first;
		expect(setWidget.mock.calls.at(-1)?.[1]).toBe(activeWidget);
		expect(ctx.abort).toHaveBeenCalledTimes(1);
		expect(notify).not.toHaveBeenCalled();
	} finally {
		for (const resolve of pending) resolve(overflow());
		await Promise.all([first, second]);
		vi.unstubAllGlobals();
	}
	expect(setWidget.mock.calls.at(-1)?.[1]).toBeUndefined();
	expect(ctx.abort).toHaveBeenCalledTimes(2);
});

test("filters Pi compaction summaries after a valid V2 checkpoint", () => {
	const { handlers, ctx } = installExtension([checkpointEntry()]);

	const result = handlers.get("context")?.(
		{
			messages: [
				{ role: "compactionSummary", content: [{ type: "text", text: "OLD SUMMARY" }] },
				{ role: "user", content: [{ type: "text", text: "keep" }] },
			],
		},
		ctx,
	);

	expect(result).toEqual({ messages: [{ role: "user", content: [{ type: "text", text: "keep" }] }] });
});

test("replays the full branch for a non-Codex model after a V2 compaction", () => {
	const branch = [
		{
			id: "old",
			parentId: null,
			timestamp: new Date().toISOString(),
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "old context" }] },
		},
		{
			id: "v2-compaction",
			parentId: "old",
			timestamp: new Date().toISOString(),
			type: "compaction",
			summary: "Codex encrypted compaction item.",
			firstKeptEntryId: "tail",
			tokensBefore: 1234,
			details: {
				kind: NATIVE_COMPACTION_KIND,
				version: 2,
				modelKey: "openai-codex:openai-codex-responses:gpt",
				replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
			},
			fromHook: true,
		},
		{
			id: "tail",
			parentId: "v2-compaction",
			timestamp: new Date().toISOString(),
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "tail context" }] },
		},
	] as never;
	const { handlers, ctx } = installExtension(branch);
	ctx.model.provider = "anthropic";
	ctx.model.api = "anthropic-messages";

	const result = handlers.get("context")?.({
		messages: [
			{ role: "compactionSummary", content: [{ type: "text", text: "V2 marker only" }] },
			{ role: "user", content: [{ type: "text", text: "tail context" }] },
		],
	}, ctx);

	expect(result).toEqual({
		messages: [
			{ role: "user", content: [{ type: "text", text: "old context" }] },
			{ role: "user", content: [{ type: "text", text: "tail context" }] },
		],
	});
});

test("replays the full branch when a native checkpoint is malformed", () => {
	const branch = [
		{ id: "old", type: "message", message: { role: "user", content: [{ type: "text", text: "old" }] } },
		{ id: "kept", type: "message", message: { role: "user", content: [{ type: "text", text: "kept" }] } },
		{
			id: "malformed",
			parentId: "kept",
			timestamp: new Date().toISOString(),
			type: "compaction",
			summary: "OLD SUMMARY",
			firstKeptEntryId: "kept",
			tokensBefore: 123,
			details: {
				kind: NATIVE_COMPACTION_KIND,
				version: 2,
				strategy: "v2",
				modelKey: "openai-codex:openai-codex-responses:gpt",
				replacementHistory: [
					{
						type: "agent_message",
						author: "root",
						recipient: "root/child",
						content: [{ type: "input_text", text: 42 }],
					},
					{ type: "compaction", encrypted_content: "opaque" },
				],
			},
		},
		{ id: "tail", type: "message", message: { role: "user", content: [{ type: "text", text: "tail" }] } },
	] as never;
	const { handlers, ctx } = installExtension(branch);

	const result = handlers.get("context")?.(
		{ messages: [{ role: "compactionSummary", content: [{ type: "text", text: "OLD SUMMARY" }] }] },
		ctx,
	);

	expect(result).toEqual({
		messages: [
			{ role: "user", content: [{ type: "text", text: "old" }] },
			{ role: "user", content: [{ type: "text", text: "kept" }] },
			{ role: "user", content: [{ type: "text", text: "tail" }] },
		],
	});
});

test("clears turn state when navigating to another session-tree leaf", () => {
	const { handlers, ctx } = installExtension();
	handlers.get("after_provider_response")?.({ headers: { "x-codex-turn-state": "active" } }, ctx);
	const beforeTreeHeaders: Record<string, string | null> = {};
	handlers.get("before_provider_headers")?.({ headers: beforeTreeHeaders }, ctx);
	expect(beforeTreeHeaders["x-codex-turn-state"]).toBe("active");

	handlers.get("session_tree")?.({ newLeafId: "other", oldLeafId: "current" }, ctx);
	const afterTreeHeaders: Record<string, string | null> = {};
	handlers.get("before_provider_headers")?.({ headers: afterTreeHeaders }, ctx);
	expect(afterTreeHeaders["x-codex-turn-state"]).toBeUndefined();
});

test("reports a terminal request failure without interactive choices", async () => {
	const { handlers, ctx, notify } = installExtension([checkpointEntry()], true);

	await handlers.get("before_provider_request")?.({ payload: {} }, ctx);

	expect(notify).toHaveBeenCalledWith(
		expect.stringMatching(/^OpenAI Codex failure: phase=before_provider_request; code=[a-z0-9_.-]+; model=gpt; recoveryAttempted=false; outcome=request_aborted; next=.+$/),
		"error",
	);
	expect(ctx.abort).toHaveBeenCalled();
});

test("persists safe diagnostics without request input or raw error text", async () => {
	const secret = "sk-live-user-input-secret";
	const branch = [
		{
			id: "history-user",
			parentId: null,
			timestamp: new Date().toISOString(),
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "older history" }] },
		},
		checkpointEntry(),
		{ id: "long-history", parentId: "checkpoint", timestamp: new Date().toISOString(), type: "message", message: { role: "user", content: "history".repeat(1000) } },
		{
			id: "failed-user",
			parentId: "long-history",
			timestamp: new Date().toISOString(),
			type: "message",
			message: { role: "user", content: [{ type: "text", text: secret }] },
		},
	] as never;
	const { handlers, ctx, notify, appendEntry } = installExtension(branch, true, 1000);
	const fetchMock = vi.fn(async () => new Response(
		JSON.stringify({ error: { code: "credential_bearer_secret", message: "Authorization Bearer secret" } }),
		{ status: 400 },
	));
	vi.stubGlobal("fetch", fetchMock);
	try {
		await handlers.get("before_provider_request")?.({
			payload: { input: effectiveInputForBranch({ branch, model: ctx.model as never, tools: [] }) },
		}, ctx);
	} finally {
		vi.unstubAllGlobals();
	}

	const failed = appendEntry.mock.calls.find(([kind]) => kind === FAILED_REQUEST_KIND)?.[1] as Record<string, unknown> | undefined;
	expect(failed).toMatchObject({
		kind: FAILED_REQUEST_KIND,
		entryId: "failed-user",
		diagnostics: {
			phase: "before_provider_request",
			code: "http_400",
			recoveryAttempted: false,
		},
	});
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(failed).not.toHaveProperty("content");
	expect(JSON.stringify(failed)).not.toContain(secret);
	expect(JSON.stringify(failed)).not.toContain("credential_bearer_secret");
	expect(JSON.stringify(failed)).not.toContain("Authorization Bearer secret");
	expect(notify).toHaveBeenCalledWith(expect.not.stringContaining(secret), "error");
	expect(notify).toHaveBeenCalledWith(expect.not.stringContaining("credential_bearer_secret"), "error");
});

test("persists only structural details for a history prefix mismatch", async () => {
	const secret = "private history and instructions";
	const branch = [
		{ id: "history", type: "message", message: { role: "user", content: secret } },
		checkpointEntry(),
		{ id: "current", type: "message", message: { role: "user", content: "continue" } },
	] as never;
	const { handlers, ctx, appendEntry } = installExtension(branch, true);
	await handlers.get("before_provider_request")?.({ payload: { input: [
		{ role: "user", content: [{ type: "input_text", text: "different history" }] },
		{ role: "user", content: [{ type: "input_text", text: "continue" }] },
	] } }, ctx);
	const marker = appendEntry.mock.calls.find(([kind]) => kind === FAILED_REQUEST_KIND)?.[1];
	expect(marker.diagnostics).toEqual({ phase: "before_provider_request", code: "history_prefix_mismatch", recoveryAttempted: false,
		errorType: "HistoryPrefixMismatchError", mismatchIndex: 0 });
	expect(JSON.stringify(marker)).not.toContain(secret);
	expect(JSON.stringify(marker)).not.toContain("opaque");
	expect(marker).not.toHaveProperty("content");
	expect(ctx.abort).toHaveBeenCalledOnce();
});

test("writes the same safe failure notice without UI", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const { handlers, ctx } = installExtension([checkpointEntry()]);
	await handlers.get("before_provider_request")?.({ payload: {} }, ctx);
	const calls = error.mock.calls;
	error.mockRestore();
	expect(calls).toHaveLength(1);
	expect(calls[0]).toEqual([
		expect.stringMatching(/^OpenAI Codex failure: phase=before_provider_request; code=[a-z0-9_.-]+; model=gpt; recoveryAttempted=false; outcome=request_aborted; next=.+$/),
	]);
});

test.each([
	["manual", false],
	["threshold", false],
	["overflow", true],
] as const)("fails closed for a terminal %s compaction error", async (reason, willRetry) => {
	const { handlers, ctx, notify, setWidget } = installExtension([], true);
	vi.stubGlobal("fetch", async () => new Response(
		JSON.stringify({ error: { code: "manual_failure", message: "do-not-display-this-body" } }),
		{ status: 400 },
	));
	try {
		await expect(handlers.get("session_before_compact")?.({
			branchEntries: [],
			preparation: { firstKeptEntryId: "", tokensBefore: 0 },
			reason,
			willRetry,
			signal: new AbortController().signal,
		}, ctx)).resolves.toEqual({ cancel: true });
	} finally {
		vi.unstubAllGlobals();
	}
	expect(setWidget).not.toHaveBeenCalled();
	expect(notify.mock.calls.filter((call) => call[1] === "info")).toHaveLength(0);
	expect(notify).toHaveBeenCalledWith(
		expect.stringMatching(/^OpenAI Codex failure: phase=session_before_compact; code=http_400; model=gpt; recoveryAttempted=false; outcome=compaction_cancelled; next=.+$/),
		"error",
	);
	expect(notify).toHaveBeenCalledWith(expect.not.stringContaining("do-not-display-this-body"), "error");
});

test.each([
	["manual", false],
	["threshold", false],
	["overflow", true],
] as const)("cancels an aborted %s compaction without a remote request", async (reason, willRetry) => {
	const { handlers, ctx, notify, setWidget } = installExtension([], true);
	const controller = new AbortController();
	controller.abort();
	const fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
	try {
		await expect(handlers.get("session_before_compact")?.({
			branchEntries: [],
			preparation: { firstKeptEntryId: "", tokensBefore: 0 },
			reason,
			willRetry,
			signal: controller.signal,
		}, ctx)).resolves.toEqual({ cancel: true });
	} finally {
		vi.unstubAllGlobals();
	}

	expect(fetchMock).not.toHaveBeenCalled();
	expect(setWidget).not.toHaveBeenCalled();
	expect(notify).not.toHaveBeenCalled();
});

test("reports a safe manual compaction failure without UI", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const { handlers, ctx, notify } = installExtension([], false);
	vi.stubGlobal("fetch", async () => new Response(
		JSON.stringify({ error: { code: "credential_bearer_secret", message: "Authorization Bearer secret" } }),
		{ status: 400 },
	));
	try {
		await expect(handlers.get("session_before_compact")?.({
			branchEntries: [],
			preparation: { firstKeptEntryId: "", tokensBefore: 0 },
			reason: "manual",
			willRetry: false,
			signal: new AbortController().signal,
		}, ctx)).resolves.toEqual({ cancel: true });
	} finally {
		vi.unstubAllGlobals();
	}
	const calls = error.mock.calls;
	error.mockRestore();
	expect(notify).not.toHaveBeenCalled();
	expect(calls).toHaveLength(1);
	expect(calls[0]).toEqual([
		expect.stringMatching(/^OpenAI Codex failure: phase=session_before_compact; code=http_400; model=gpt; recoveryAttempted=false; outcome=compaction_cancelled; next=.+$/),
	]);
	expect(String(calls[0]?.[0])).not.toContain("credential_bearer_secret");
	expect(String(calls[0]?.[0])).not.toContain("Authorization Bearer secret");
});

test("cancels compaction when UI reporting throws", async () => {
	const { handlers, ctx, notify, setWidget } = installExtension([], true);
	setWidget.mockImplementation(() => { throw new Error("widget failed"); });
	notify.mockImplementation(() => { throw new Error("notify failed"); });
	vi.stubGlobal("fetch", async () => new Response(
		JSON.stringify({ error: { code: "manual_failure", message: "safe" } }),
		{ status: 400 },
	));
	try {
		await expect(handlers.get("session_before_compact")?.({
			branchEntries: [],
			preparation: { firstKeptEntryId: "", tokensBefore: 0 },
			reason: "manual",
			willRetry: false,
			signal: new AbortController().signal,
		}, ctx)).resolves.toEqual({ cancel: true });
	} finally {
		vi.unstubAllGlobals();
	}
});

test("cancels the provider request when marker persistence throws", async () => {
	const branch = [{
		id: "current",
		parentId: null,
		timestamp: new Date().toISOString(),
		type: "message",
		message: { role: "user", content: [{ type: "text", text: "prompt" }] },
	}] as never;
	const { handlers, ctx, model, appendEntry } = installExtension(branch, true);
	model.id = "gpt-5.6-sol";
	const previousModel = { ...model, id: "gpt-5.5" };
	await handlers.get("model_select")?.({ model, previousModel }, ctx);
	appendEntry.mockImplementation(() => { throw new Error("disk full"); });
	vi.stubGlobal("fetch", async () => new Response(
		JSON.stringify({ error: { code: "policy_violation", message: "safe" } }),
		{ status: 400 },
	));
	try {
		await expect(handlers.get("before_provider_request")?.({
			payload: { input: [{ role: "user", content: [{ type: "input_text", text: "prompt" }] }] },
		}, ctx)).resolves.toBeUndefined();
	} finally {
		vi.unstubAllGlobals();
	}
	expect(ctx.abort).toHaveBeenCalledTimes(1);
});

test("cancels a stale compaction without reporting success", async () => {
	const { handlers, ctx, notify, setWidget } = installExtension([], true);
	let resolveFetch!: (response: Response) => void;
	let markFetchStarted!: () => void;
	const fetchStarted = new Promise<void>((resolve) => {
		markFetchStarted = resolve;
	});
	const fetchResponse = new Promise<Response>((resolve) => {
		resolveFetch = resolve;
	});
	vi.stubGlobal("fetch", async () => {
		markFetchStarted();
		return fetchResponse;
	});
	try {
		const compaction = handlers.get("session_before_compact")?.({
			branchEntries: [],
			preparation: { firstKeptEntryId: "", tokensBefore: 0 },
			reason: "manual",
			willRetry: false,
			signal: new AbortController().signal,
		}, ctx);
		await fetchStarted;
		handlers.get("session_tree")?.({}, ctx);
		resolveFetch(new Response([
			'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
			'data: {"type":"response.completed","response":{"id":"response"}}',
		].join("\n\n") + "\n\n", {
			headers: {
				"content-type": "text/event-stream",
				"x-codex-turn-state": "old-leaf-state",
			},
		}));
		await expect(compaction).resolves.toEqual({ cancel: true });
		expect(setWidget).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalledWith("Codex context compacted (manual).", "info");
		const headers: Record<string, string | null> = {};
		handlers.get("before_provider_headers")?.({ headers }, ctx);
		expect(headers["x-codex-turn-state"]).toBeUndefined();
	} finally {
		vi.unstubAllGlobals();
	}
});

test("does not preserve an active failed user during manual compaction", async () => {
	const secret = "stale-failed-input";
	const branch = [
		{
			id: "failed-user",
			parentId: null,
			timestamp: new Date().toISOString(),
			type: "message",
			message: { role: "user", content: [{ type: "text", text: secret }] },
		},
		{
			id: "failed-marker",
			parentId: "failed-user",
			timestamp: new Date().toISOString(),
			type: "custom",
			customType: FAILED_REQUEST_KIND,
			data: { kind: FAILED_REQUEST_KIND, entryId: "failed-user" },
		},
	] as never;
	const { handlers, ctx } = installExtension(branch);
	vi.stubGlobal("fetch", async () => new Response([
		'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
		'data: {"type":"response.completed","response":{"id":"response"}}',
	].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));
	try {
		const result = await handlers.get("session_before_compact")?.({
			branchEntries: branch,
			preparation: { firstKeptEntryId: "", tokensBefore: 0 },
			reason: "manual",
			willRetry: false,
			signal: new AbortController().signal,
		}, ctx) as { compaction?: { details?: { replacementHistory?: unknown[]; preservedInput?: unknown[] } } } | undefined;
		const details = result?.compaction?.details;
		expect(details?.replacementHistory).not.toEqual(expect.arrayContaining([
			expect.objectContaining({ role: "user", content: expect.arrayContaining([expect.objectContaining({ text: secret })]) }),
		]));
		expect(details?.preservedInput ?? []).not.toEqual(expect.arrayContaining([
			expect.objectContaining({ role: "user", content: expect.arrayContaining([expect.objectContaining({ text: secret })]) }),
		]));
		expect(JSON.stringify(details)).not.toContain(secret);
	} finally {
		vi.unstubAllGlobals();
	}
});

test.each([
	["invalid_api_key", "check Codex authentication and retry manually"],
	["authentication_error", "check Codex authentication and retry manually"],
	["unauthorized", "check Codex authentication and retry manually"],
	["forbidden", "check Codex authentication and retry manually"],
	["permission_denied", "check Codex authentication and retry manually"],
	["invalid_token", "check Codex authentication and retry manually"],
	["credential_error", "check Codex authentication and retry manually"],
	["policy_violation", "check Codex plan, permissions, quota, and billing before retrying manually"],
	["insufficient_quota", "check Codex plan, permissions, quota, and billing before retrying manually"],
	["usage_limit_reached", "check Codex plan, permissions, quota, and billing before retrying manually"],
	["billing_error", "check Codex plan, permissions, quota, and billing before retrying manually"],
	["out_of_budget", "check Codex plan, permissions, quota, and billing before retrying manually"],
] as const)("uses a safe next step for $0", async (code, nextStep) => {
	const { handlers, ctx, notify } = installExtension([], true);
	vi.stubGlobal("fetch", async () => new Response(
		JSON.stringify({ error: { code, message: "safe test failure" } }),
		{ status: 400 },
	));
	try {
		await expect(handlers.get("session_before_compact")?.({
			branchEntries: [],
			preparation: { firstKeptEntryId: "", tokensBefore: 0 },
			reason: "manual",
			willRetry: false,
			signal: new AbortController().signal,
		}, ctx)).resolves.toEqual({ cancel: true });
	} finally {
		vi.unstubAllGlobals();
	}
	const notice = notify.mock.calls.at(-1)?.[0];
	expect(notice).toContain(`code=${code}`);
	expect(notice).toContain(`next=${nextStep}.`);
});

test.each(["manual", "threshold", "overflow"])("cancels %s compaction overflow without replacing the previous checkpoint", async (reason) => {
	const branch = [
		{
			id: "old",
			parentId: null,
			timestamp: new Date().toISOString(),
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "old raw context" }] },
		},
		{
			id: "existing-v2",
			parentId: "old",
			timestamp: new Date().toISOString(),
			type: "compaction",
			summary: "Codex encrypted compaction item.",
			firstKeptEntryId: "tail",
			tokensBefore: 1000,
			details: {
				kind: NATIVE_COMPACTION_KIND,
				version: 2,
				modelKey: "openai-codex:openai-codex-responses:gpt",
				replacementHistory: [{ type: "compaction", encrypted_content: "previous-checkpoint" }],
			},
			fromHook: true,
		},
		{
			id: "tail",
			parentId: "existing-v2",
			timestamp: new Date().toISOString(),
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "current tail" }] },
		},
	] as never;
	const before = structuredClone(branch);
	const { handlers, ctx, notify, appendEntry } = installExtension(branch, true);
	const requestBodies: Array<{ input?: Array<Record<string, unknown>> }> = [];
	const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
		requestBodies.push(JSON.parse(String(init?.body)) as { input?: Array<Record<string, unknown>> });
		if (requestBodies.length === 1) {
			return new Response(
				JSON.stringify({ error: { code: "context_length_exceeded", message: "retry with a shorter history" } }),
				{ status: 400 },
			);
		}
		return new Response([
			'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"new-checkpoint"}}',
			'data: {"type":"response.completed","response":{"id":"response"}}',
		].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } });
	});
	vi.stubGlobal("fetch", fetchMock);
	try {
		await expect(handlers.get("session_before_compact")?.(
			piCompactionEvent(branch, reason),
			ctx,
		)).resolves.toEqual({ cancel: true });
	} finally {
		vi.unstubAllGlobals();
	}

	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(branch).toEqual(before);
	expect(appendEntry).not.toHaveBeenCalledWith(NATIVE_COMPACTION_KIND, expect.anything());
	expect(notify).toHaveBeenCalledWith(expect.stringContaining("code=context_length_exceeded; model=gpt; recoveryAttempted=false; outcome=compaction_cancelled; next=shorten the request or start a new session"), "error");
	expect(requestBodies[0]?.input).toEqual(expect.arrayContaining([
		expect.objectContaining({ type: "compaction", encrypted_content: "previous-checkpoint" }),
	]));
});

test("preserves earlier replies when Pi compacts after an ordinary request overflow", async () => {
	const assistant = (text: string, stopReason: "stop" | "error") => ({
		role: "assistant", provider: "openai-codex", api: "openai-codex-responses", model: "gpt",
		content: [{ type: "text", text }], stopReason, timestamp: 1,
		usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20 },
	});
	const branch = [
		{ id: "u", parentId: null, timestamp: "2026-01-01", type: "message", message: { role: "user", content: "task" } },
		{ id: "a", parentId: "u", timestamp: "2026-01-01", type: "message", message: assistant("completed work", "stop") },
		{ id: "next", parentId: "a", timestamp: "2026-01-01", type: "message", message: { role: "user", content: "continue" } },
		{ id: "error", parentId: "next", timestamp: "2026-01-01", type: "message", message: assistant("failed response", "error") },
	] as SessionEntry[];
	const before = structuredClone(branch);
	const { handlers, ctx } = installExtension(branch);
	let input: unknown;
	vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
		input = JSON.parse(String(init?.body)).input;
		return new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n');
	});
	try {
		expect(await handlers.get("session_before_compact")!(piCompactionEvent(branch, "overflow", true), ctx)).toHaveProperty("compaction");
		expect(JSON.stringify(input)).toContain("completed work");
		expect(JSON.stringify(input)).toContain("continue");
		expect(JSON.stringify(input)).not.toContain("failed response");
		expect(branch).toEqual(before);
	} finally {
		await handlers.get("session_compact_failed")!({}, ctx);
		vi.unstubAllGlobals();
	}
});

test.each(["provider", "pi"])("allows a fresh %s attempt after repeated terminal overflows", async (entrypoint) => {
	const branch = [checkpointEntry(), {
		id: "history", parentId: "checkpoint", timestamp: "2026-01-01", type: "message",
		message: { role: "user", content: "history".repeat(1000) },
	}] as SessionEntry[];
	const { handlers, ctx, model, appendEntry, setWidget } = installExtension(branch, true, 1000);
	const before = structuredClone(branch);
	const fetchMock = vi.fn(async () => fetchMock.mock.calls.length <= 2
		? new Response(JSON.stringify({ error: { code: "context_window_exceeded", message: "too large" } }), { status: 400 })
		: new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"fresh"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n'));
	vi.stubGlobal("fetch", fetchMock);
	const attempt = () => entrypoint === "pi"
		? handlers.get("session_before_compact")!(piCompactionEvent(branch), ctx)
		: handlers.get("before_provider_request")!({ payload: { input: [...effectiveInputForBranch({ branch, model: model as never, tools: [] }), { role: "user", content: [{ type: "input_text", text: "continue" }] }] } }, ctx);
	try {
		for (let index = 0; index < 2; index++) {
			expect(await attempt()).toEqual(entrypoint === "pi" ? { cancel: true } : undefined);
			expect(fetchMock).toHaveBeenCalledTimes(index + 1);
			expect(branch).toEqual(before);
			expect(appendEntry).not.toHaveBeenCalledWith(NATIVE_COMPACTION_KIND, expect.anything());
			if (entrypoint === "provider") expect(setWidget.mock.calls.at(-1)?.[1]).toBeUndefined();
		}
		expect(await attempt()).toHaveProperty(entrypoint === "pi" ? "compaction" : "input");
		expect(fetchMock).toHaveBeenCalledTimes(3);
	} finally {
		await handlers.get("session_compact_failed")!({}, ctx);
		vi.unstubAllGlobals();
	}
});

test("refreshes changed system instructions instead of reusing a stale request prefix", async () => {
	const { handlers, ctx, model } = installExtension([]);
	await handlers.get("before_provider_request")?.({ payload: { model: model.id, input: [], instructions: "old project policy" } }, ctx);
	ctx.getSystemPrompt = () => "current project policy: never change the database";
	let body: Record<string, unknown> | undefined;
	vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
		body = JSON.parse(String(init?.body));
		return new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n');
	});
	try {
		await handlers.get("session_before_compact")?.(piCompactionEvent([]), ctx);
		expect(body?.instructions).toBe("current project policy: never change the database");
	} finally { vi.unstubAllGlobals(); }
});

test.each([
	["manual", false],
	["threshold", false],
	["overflow", true],
] as const)("leaves %s compaction presentation to Pi until commit", async (reason, willRetry) => {
	const { handlers, ctx, model, notify, setWidget } = installExtension([], true);
	await handlers.get("before_provider_request")?.({
		payload: {
			model: model.id,
			input: [],
			instructions: "request instructions",
			reasoning: { effort: "xhigh", summary: "detailed" },
			service_tier: "priority",
			text: { verbosity: "high" },
		},
	}, ctx);

	let requestBody: Record<string, unknown> | undefined;
	vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
		requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
		return new Response([
			'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
			'data: {"type":"response.completed","response":{"id":"response"}}',
		].join("\n\n") + "\n\n", {
			headers: { "content-type": "text/event-stream", "x-codex-turn-state": "compact-state" },
		});
	});
	try {
		await handlers.get("session_before_compact")?.({
			branchEntries: [],
			preparation: { firstKeptEntryId: "", tokensBefore: 0 },
			reason,
			willRetry,
			signal: new AbortController().signal,
		}, ctx);

		expect(setWidget).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
		expect(requestBody).toMatchObject({
			instructions: "request instructions",
			reasoning: { effort: "xhigh", summary: "detailed" },
			service_tier: "priority",
			text: { verbosity: "high" },
		});
		const headers: Record<string, string | null> = {};
		handlers.get("before_provider_headers")?.({ headers }, ctx);
		expect(headers["x-codex-turn-state"]).toBe("compact-state");
		handlers.get("after_provider_response")?.({ headers: { "x-codex-turn-state": "later-state" } }, ctx);
		const stableHeaders: Record<string, string | null> = {};
		handlers.get("before_provider_headers")?.({ headers: stableHeaders }, ctx);
		expect(stableHeaders["x-codex-turn-state"]).toBe("compact-state");

		handlers.get("message_start")?.({ message: { role: "user", content: "next" } }, ctx);
		const nextHeaders: Record<string, string | null> = {};
		handlers.get("before_provider_headers")?.({ headers: nextHeaders }, ctx);
		expect(nextHeaders["x-codex-turn-state"]).toBeUndefined();
	} finally {
		vi.unstubAllGlobals();
	}
});

test.each([
	["manual", false, true, false],
	["threshold", false, false, true],
	["overflow", true, true, true],
] as const)(
	"confirms Codex Compact V2 only after Pi commits a %s compaction",
	async (reason, willRetry, fromExtension, fromHook) => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	vi.stubGlobal("fetch", async () => new Response([
		'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
		'data: {"type":"response.completed","response":{"id":"response"}}',
	].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));
	try {
		const result = await handlers.get("session_before_compact")?.({
			branchEntries: branch,
			preparation: { firstKeptEntryId: "first-kept", tokensBefore: 1234 },
			reason,
			willRetry,
			signal: new AbortController().signal,
		}, ctx) as {
			compaction: {
				summary: string;
				firstKeptEntryId: string;
				tokensBefore: number;
				details: unknown;
			};
		};

		expect(result.compaction.summary).toBe(
			"Codex encrypted compaction item.",
		);
		expect(notify).not.toHaveBeenCalled();
		const committedEntry = {
			type: "compaction",
			id: "committed-v2",
			parentId: null,
			timestamp: new Date().toISOString(),
			summary: result.compaction.summary,
			firstKeptEntryId: result.compaction.firstKeptEntryId,
			tokensBefore: result.compaction.tokensBefore,
			details: result.compaction.details,
			fromHook,
		} as const;
		branch.push(committedEntry as never);

		expect(handlers.get("session_compact")).toBeTypeOf("function");
		await handlers.get("session_compact")?.({
			compactionEntry: committedEntry,
			fromExtension,
			reason,
			willRetry,
		}, ctx);

		expect(notify).not.toHaveBeenCalled();
		await flushPostCompactionNotices();
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			"Codex compaction applied",
			"info",
		);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("warns once when no new compaction entry can be resolved", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	stubSuccessfulCompaction();
	try {
		const result = await handlers.get("session_before_compact")?.(
			piCompactionEvent(branch),
			ctx,
		) as { compaction: { summary: string; details: unknown } };
		const unresolvedEvent = {
			compactionEntry: { type: "compaction", id: "missing" },
			fromExtension: true,
			reason: "manual",
			willRetry: false,
		};

		handlers.get("session_compact")?.(unresolvedEvent, ctx);
		expect(notify).not.toHaveBeenCalled();
		await flushPostCompactionNotices();
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			"Codex compaction not confirmed",
			"warning",
		);

		branch.push({
			type: "compaction",
			id: "late-entry",
			parentId: null,
			timestamp: new Date().toISOString(),
			summary: result.compaction.summary,
			firstKeptEntryId: "first-kept",
			tokensBefore: 1234,
			details: result.compaction.details,
			fromHook: true,
		} as never);
		handlers.get("session_compact")?.(unresolvedEvent, ctx);
		await flushPostCompactionNotices();
		expect(notify).toHaveBeenCalledTimes(1);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("leaves non-Codex compaction entirely to Pi", async () => {
	const { handlers, ctx, notify, setWidget } = installExtension([], true);
	ctx.model.provider = "anthropic";
	ctx.model.api = "anthropic-messages";
	const fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
	try {
		await expect(handlers.get("session_before_compact")?.(
			piCompactionEvent([]),
			ctx,
		)).resolves.toBeUndefined();
		handlers.get("session_compact")?.({
			compactionEntry: { type: "compaction", id: "local" },
			fromExtension: false,
			reason: "manual",
			willRetry: false,
		}, ctx);
	} finally {
		vi.unstubAllGlobals();
	}

	expect(fetchMock).not.toHaveBeenCalled();
	expect(setWidget).not.toHaveBeenCalled();
	expect(notify).not.toHaveBeenCalled();
});

test("warns when Pi commits an invalid V2 checkpoint for an expected Codex attempt", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	vi.stubGlobal("fetch", async () => new Response([
		'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
		'data: {"type":"response.completed","response":{"id":"response"}}',
	].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));
	try {
		const result = await handlers.get("session_before_compact")?.({
			branchEntries: branch,
			preparation: { firstKeptEntryId: "first-kept", tokensBefore: 1234 },
			reason: "threshold",
			willRetry: false,
			signal: new AbortController().signal,
		}, ctx) as { compaction: { summary: string; details: Record<string, unknown> } };
		const committedEntry = {
			type: "compaction",
			id: "committed-invalid",
			parentId: null,
			timestamp: new Date().toISOString(),
			summary: result.compaction.summary,
			firstKeptEntryId: "first-kept",
			tokensBefore: 1234,
			details: { ...result.compaction.details, version: 1 },
			fromHook: true,
		} as const;
		branch.push(committedEntry as never);

		await handlers.get("session_compact")?.({
			compactionEntry: committedEntry,
			fromExtension: true,
			reason: "threshold",
			willRetry: false,
		}, ctx);

		expect(notify).not.toHaveBeenCalled();
		await flushPostCompactionNotices();
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			"Codex compaction not confirmed",
			"warning",
		);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("warns when Pi commits a local compaction for an expected Codex attempt", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	stubSuccessfulCompaction();
	try {
		const result = await handlers.get("session_before_compact")?.({
			branchEntries: branch,
			preparation: { firstKeptEntryId: "first-kept", tokensBefore: 1234 },
			reason: "overflow",
			willRetry: true,
			signal: new AbortController().signal,
		}, ctx) as { compaction: { summary: string } };
		const committedEntry = {
			type: "compaction",
			id: "committed-local",
			parentId: null,
			timestamp: new Date().toISOString(),
			summary: result.compaction.summary,
			firstKeptEntryId: "first-kept",
			tokensBefore: 1234,
			details: { readFiles: [], modifiedFiles: [] },
			fromHook: false,
		} as const;
		branch.push(committedEntry as never);

		await handlers.get("session_compact")?.({
			compactionEntry: committedEntry,
			fromExtension: false,
			reason: "overflow",
			willRetry: true,
		}, ctx);

		expect(notify).not.toHaveBeenCalled();
		await flushPostCompactionNotices();
		expect(notify).toHaveBeenCalledWith(
			"Pi local compaction used",
			"warning",
		);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("rejects a different valid V2 checkpoint committed for the same model", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	stubSuccessfulCompaction("expected");
	try {
		const result = await handlers.get("session_before_compact")?.({
			branchEntries: branch,
			preparation: { firstKeptEntryId: "first-kept", tokensBefore: 1234 },
			reason: "manual",
			willRetry: false,
			signal: new AbortController().signal,
		}, ctx) as { compaction: { summary: string; details: Record<string, unknown> } };
		const committedEntry = {
			type: "compaction",
			id: "committed-different-v2",
			parentId: null,
			timestamp: new Date().toISOString(),
			summary: result.compaction.summary,
			firstKeptEntryId: "first-kept",
			tokensBefore: 1234,
			details: {
				...result.compaction.details,
				replacementHistory: [{ type: "compaction", encrypted_content: "different" }],
			},
			fromHook: true,
		} as const;
		branch.push(committedEntry as never);

		await handlers.get("session_compact")?.({
			compactionEntry: committedEntry,
			fromExtension: true,
			reason: "manual",
			willRetry: false,
		}, ctx);

		expect(notify).not.toHaveBeenCalled();
		await flushPostCompactionNotices();
		expect(notify).toHaveBeenCalledWith(
			"Codex compaction not confirmed",
			"warning",
		);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("fails closed when Pi session inspection throws before remote compaction", async () => {
	const { handlers, ctx, notify } = installExtension([], true);
	ctx.sessionManager.getEntries = () => {
		throw new Error("session read failed");
	};

	await expect(handlers.get("session_before_compact")?.({
		branchEntries: [],
		preparation: { firstKeptEntryId: "first-kept", tokensBefore: 1234 },
		reason: "manual",
		willRetry: false,
		signal: new AbortController().signal,
	}, ctx)).resolves.toEqual({ cancel: true });
	expect(notify).toHaveBeenCalledWith(
		expect.stringContaining("outcome=compaction_cancelled"),
		"error",
	);
});

test("clears an awaiting attempt when Pi reports compaction failure", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	stubSuccessfulCompaction();
	try {
		const result = await handlers.get("session_before_compact")?.({
			branchEntries: branch,
			preparation: { firstKeptEntryId: "first-kept", tokensBefore: 1234 },
			reason: "manual",
			willRetry: false,
			signal: new AbortController().signal,
		}, ctx) as { compaction: { summary: string } };

		expect(handlers.get("session_compact_failed")).toBeTypeOf("function");
		await handlers.get("session_compact_failed")?.({
			reason: "manual",
			errorMessage: "disk full",
			aborted: false,
			willRetry: false,
			fromExtension: true,
		}, ctx);

		const unrelatedEntry = {
			type: "compaction",
			id: "unrelated-local",
			parentId: null,
			timestamp: new Date().toISOString(),
			summary: result.compaction.summary,
			firstKeptEntryId: "first-kept",
			tokensBefore: 1234,
			fromHook: false,
		} as const;
		branch.push(unrelatedEntry as never);
		await handlers.get("session_compact")?.({
			compactionEntry: unrelatedEntry,
			fromExtension: false,
			reason: "manual",
			willRetry: false,
		}, ctx);

		await flushPostCompactionNotices();
		expect(notify).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
	}
});

test.each(["session_start", "session_shutdown", "session_tree"])(
	"discards an awaiting provenance attempt on %s",
	async (lifecycleEvent) => {
		const branch: SessionEntry[] = [];
		const { handlers, ctx, notify } = installExtension(branch, true);
		stubSuccessfulCompaction();
		try {
			const result = await handlers.get("session_before_compact")?.(
				piCompactionEvent(branch),
				ctx,
			) as { compaction: { summary: string; details: unknown } };
			handlers.get(lifecycleEvent)?.({}, ctx);
			const committedEntry = {
				type: "compaction",
				id: `stale-after-${lifecycleEvent}`,
				parentId: null,
				timestamp: new Date().toISOString(),
				summary: result.compaction.summary,
				firstKeptEntryId: "first-kept",
				tokensBefore: 1234,
				details: result.compaction.details,
				fromHook: true,
			} as const;
			branch.push(committedEntry as never);
			handlers.get("session_compact")?.({
				compactionEntry: committedEntry,
				fromExtension: true,
				reason: "manual",
				willRetry: false,
			}, ctx);

			await flushPostCompactionNotices();
			expect(notify).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

test.each(["session_start", "session_shutdown", "session_tree"])(
	"cancels a deferred post-compaction notice on %s",
	async (lifecycleEvent) => {
		const branch: SessionEntry[] = [];
		const { handlers, ctx, notify } = installExtension(branch, true);
		stubSuccessfulCompaction();
		try {
			const result = await handlers.get("session_before_compact")?.(
				piCompactionEvent(branch),
				ctx,
			) as { compaction: { summary: string; details: unknown } };
			const committedEntry = {
				type: "compaction",
				id: `committed-before-${lifecycleEvent}`,
				parentId: null,
				timestamp: new Date().toISOString(),
				summary: result.compaction.summary,
				firstKeptEntryId: "first-kept",
				tokensBefore: 1234,
				details: result.compaction.details,
				fromHook: true,
			} as const;
			branch.push(committedEntry as never);
			handlers.get("session_compact")?.({
				compactionEntry: committedEntry,
				fromExtension: true,
				reason: "manual",
				willRetry: false,
			}, ctx);

			expect(notify).not.toHaveBeenCalled();
			handlers.get(lifecycleEvent)?.({}, ctx);
			await flushPostCompactionNotices();
			expect(notify).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

test("cancels an in-flight Pi compaction when the model changes", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, model, notify } = installExtension(branch, true);
	let resolveFetch!: (response: Response) => void;
	let markFetchStarted!: () => void;
	const fetchStarted = new Promise<void>((resolve) => {
		markFetchStarted = resolve;
	});
	const fetchResponse = new Promise<Response>((resolve) => {
		resolveFetch = resolve;
	});
	let fetchSignal: AbortSignal | null | undefined;
	vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
		fetchSignal = init?.signal;
		markFetchStarted();
		return fetchResponse;
	});
	try {
		const compaction = handlers.get("session_before_compact")?.(
			piCompactionEvent(branch),
			ctx,
		) as Promise<unknown>;
		await fetchStarted;
		const previousModel = { ...model };
		const nextModel = { ...model, id: "gpt-next" };
		ctx.model = nextModel;
		handlers.get("model_select")?.({ model: nextModel, previousModel }, ctx);
		const abortedAtSwitch = fetchSignal?.aborted;
		resolveFetch(new Response([
			'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
			'data: {"type":"response.completed","response":{"id":"response"}}',
		].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));

		await expect(compaction).resolves.toEqual({ cancel: true });
		expect(abortedAtSwitch).toBe(true);
		expect(notify).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
	}
});

test("verifies two consecutive Pi compactions independently", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	let checkpointNumber = 0;
	const requestBodies: Array<{ input?: Array<Record<string, unknown>> }> = [];
	const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
		requestBodies.push(JSON.parse(String(init?.body)) as { input?: Array<Record<string, unknown>> });
		checkpointNumber++;
		return new Response([
			`data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"checkpoint-${checkpointNumber}"}}`,
			'data: {"type":"response.completed","response":{"id":"response"}}',
		].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } });
	});
	vi.stubGlobal("fetch", fetchMock);
	try {
		for (const id of ["first-commit", "second-commit"]) {
			const result = await handlers.get("session_before_compact")?.(
				piCompactionEvent(branch),
				ctx,
			) as { compaction: { summary: string; details: unknown } };
			const committedEntry = {
				type: "compaction",
				id,
				parentId: branch.at(-1)?.id ?? null,
				timestamp: new Date().toISOString(),
				summary: result.compaction.summary,
				firstKeptEntryId: "first-kept",
				tokensBefore: 1234,
				details: result.compaction.details,
				fromHook: true,
			} as const;
			branch.push(committedEntry as never);
			handlers.get("session_compact")?.({
				compactionEntry: committedEntry,
				fromExtension: true,
				reason: "manual",
				willRetry: false,
			}, ctx);
		}
	} finally {
		vi.unstubAllGlobals();
	}

	expect(notify).not.toHaveBeenCalled();
	await flushPostCompactionNotices();
	expect(fetchMock).toHaveBeenCalledTimes(2);
	expect(requestBodies[1]?.input).toEqual(expect.arrayContaining([
		expect.objectContaining({ type: "compaction", encrypted_content: "checkpoint-1" }),
	]));
	expect(notify).toHaveBeenCalledTimes(2);
	expect(notify).toHaveBeenNthCalledWith(
		1,
		"Codex compaction applied",
		"info",
	);
	expect(notify).toHaveBeenNthCalledWith(
		2,
		"Codex compaction applied",
		"info",
	);
});

test("cancels a second Pi compaction while the first attempt awaits commit", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx } = installExtension(branch, true);
	const fetchMock = vi.fn(async () => new Response([
		'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
		'data: {"type":"response.completed","response":{"id":"response"}}',
	].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }));
	vi.stubGlobal("fetch", fetchMock);
	const event = {
		branchEntries: branch,
		preparation: { firstKeptEntryId: "first-kept", tokensBefore: 1234 },
		reason: "manual",
		willRetry: false,
		signal: new AbortController().signal,
	};
	try {
		await expect(handlers.get("session_before_compact")?.(event, ctx)).resolves.toHaveProperty("compaction");
		await expect(handlers.get("session_before_compact")?.(event, ctx)).resolves.toEqual({ cancel: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("keeps the newer Pi compaction occupied when a stale operation finishes", async () => {
	const { handlers, ctx } = installExtension([], true);
	const pending: Array<(response: Response) => void> = [];
	const started: Array<() => void> = [];
	const starts = [0, 1].map(() => new Promise<void>((resolve) => started.push(resolve)));
	const success = () => new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n');
	const fetchMock = vi.fn(() => pending.length >= 2 ? Promise.resolve(success()) : new Promise<Response>((resolve) => {
		pending.push(resolve);
		started[pending.length - 1]!();
	}));
	vi.stubGlobal("fetch", fetchMock);
	const compact = () => handlers.get("session_before_compact")!(piCompactionEvent([]), ctx) as Promise<unknown>;
	const first = compact();
	let second: Promise<unknown> | undefined;
	try {
		await starts[0];
		await handlers.get("session_start")!({}, ctx);
		second = compact();
		await starts[1];
		pending[0]!(success());
		await expect(first).resolves.toEqual({ cancel: true });
		await expect(compact()).resolves.toEqual({ cancel: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	} finally {
		for (const resolve of pending) resolve(success());
		await Promise.all([first, second]);
		await handlers.get("session_compact_failed")!({}, ctx);
		vi.unstubAllGlobals();
	}
});

test("cancels a concurrent Pi compaction while remote V2 is still running", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx } = installExtension(branch, true);
	let resolveFirstFetch!: (response: Response) => void;
	let markFirstFetchStarted!: () => void;
	const firstFetchStarted = new Promise<void>((resolve) => {
		markFirstFetchStarted = resolve;
	});
	const firstFetch = new Promise<Response>((resolve) => {
		resolveFirstFetch = resolve;
	});
	const response = () => new Response([
		'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}',
		'data: {"type":"response.completed","response":{"id":"response"}}',
	].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } });
	const fetchMock = vi.fn()
		.mockImplementationOnce(() => {
			markFirstFetchStarted();
			return firstFetch;
		})
		.mockImplementation(async () => response());
	vi.stubGlobal("fetch", fetchMock);
	const event = {
		branchEntries: branch,
		preparation: { firstKeptEntryId: "first-kept", tokensBefore: 1234 },
		reason: "manual",
		willRetry: false,
		signal: new AbortController().signal,
	};
	try {
		const firstAttempt = handlers.get("session_before_compact")?.(event, ctx) as Promise<unknown>;
		await firstFetchStarted;
		await expect(handlers.get("session_before_compact")?.(event, ctx)).resolves.toEqual({ cancel: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		resolveFirstFetch(response());
		await expect(firstAttempt).resolves.toHaveProperty("compaction");
	} finally {
		vi.unstubAllGlobals();
	}
});

test("does not verify a commit event with a different compaction reason", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	stubSuccessfulCompaction();
	try {
		const result = await handlers.get("session_before_compact")?.(
			piCompactionEvent(branch, "manual", false),
			ctx,
		) as { compaction: { summary: string; details: unknown } };
		const committedEntry = {
			type: "compaction",
			id: "mismatched-reason",
			parentId: null,
			timestamp: new Date().toISOString(),
			summary: result.compaction.summary,
			firstKeptEntryId: "first-kept",
			tokensBefore: 1234,
			details: result.compaction.details,
			fromHook: true,
		} as const;
		branch.push(committedEntry as never);

		await handlers.get("session_compact")?.({
			compactionEntry: committedEntry,
			fromExtension: true,
			reason: "threshold",
			willRetry: false,
		}, ctx);

		expect(notify).not.toHaveBeenCalled();
		await flushPostCompactionNotices();
		expect(notify).toHaveBeenCalledWith(
			"Codex compaction not confirmed",
			"warning",
		);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("resolves the new entry when Pi reports an older compaction with the same summary", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	const oldEntry = {
		type: "compaction",
		id: "old-same-summary",
		parentId: null,
		timestamp: new Date().toISOString(),
		summary: "Codex encrypted compaction item.",
		firstKeptEntryId: "old-first-kept",
		tokensBefore: 100,
		details: {
			kind: NATIVE_COMPACTION_KIND,
			version: 2,
			modelKey: "openai-codex:openai-codex-responses:gpt",
			replacementHistory: [{ type: "compaction", encrypted_content: "old" }],
		},
		fromHook: true,
	} as const;
	ctx.sessionManager.getEntries = () => [oldEntry as never, ...branch];
	stubSuccessfulCompaction("new");
	try {
		const result = await handlers.get("session_before_compact")?.(
			piCompactionEvent(branch),
			ctx,
		) as { compaction: { summary: string; details: unknown } };
		const newEntry = {
			type: "compaction",
			id: "new-same-summary",
			parentId: oldEntry.id,
			timestamp: new Date().toISOString(),
			summary: result.compaction.summary,
			firstKeptEntryId: "first-kept",
			tokensBefore: 1234,
			details: result.compaction.details,
			fromHook: true,
		} as const;
		branch.push(newEntry as never);

		await handlers.get("session_compact")?.({
			compactionEntry: oldEntry,
			fromExtension: true,
			reason: "manual",
			willRetry: false,
		}, ctx);

		expect(notify).not.toHaveBeenCalled();
		await flushPostCompactionNotices();
		expect(notify).toHaveBeenCalledWith(
			"Codex compaction applied",
			"info",
		);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("does not throw when committed-entry inspection fails", async () => {
	const branch: SessionEntry[] = [];
	const { handlers, ctx, notify } = installExtension(branch, true);
	stubSuccessfulCompaction();
	try {
		const result = await handlers.get("session_before_compact")?.(
			piCompactionEvent(branch),
			ctx,
		) as { compaction: { summary: string; details: unknown } };
		const committedEntry = {
			type: "compaction",
			id: "committed-before-read-failure",
			parentId: null,
			timestamp: new Date().toISOString(),
			summary: result.compaction.summary,
			firstKeptEntryId: "first-kept",
			tokensBefore: 1234,
			details: result.compaction.details,
			fromHook: true,
		} as const;
		branch.push(committedEntry as never);
		ctx.sessionManager.getEntries = () => {
			throw new Error("session read failed after commit");
		};

		expect(() => handlers.get("session_compact")?.({
			compactionEntry: committedEntry,
			fromExtension: true,
			reason: "manual",
			willRetry: false,
		}, ctx)).not.toThrow();
		expect(notify).not.toHaveBeenCalled();
		await flushPostCompactionNotices();
		expect(notify).toHaveBeenCalledWith(
			"Codex compaction not confirmed",
			"warning",
		);
	} finally {
		vi.unstubAllGlobals();
	}
});
