import { expect, test, vi } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import codexCompactionExtension from "../src/index.js";
import { FAILED_REQUEST_KIND, NATIVE_COMPACTION_KIND } from "../src/native-compaction.js";

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

test("removes unsupported prompt cache retention from Codex requests", async () => {
	const { handlers, ctx } = installExtension();
	const payload = { input: [], prompt_cache_retention: "24h" };

	await expect(handlers.get("before_provider_request")?.({ payload }, ctx)).resolves.toBe(payload);
	expect(payload).not.toHaveProperty("prompt_cache_retention");
});

test("returns sanitized input after filtering a stale failed marker", async () => {
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
});

test("keeps one presentation through request-side overflow recovery", async () => {
	const branch = [{
		id: "history",
		parentId: null,
		timestamp: new Date().toISOString(),
		type: "message",
		message: { role: "user", content: [{ type: "text", text: "branch" }] },
	} as never, checkpointEntry()];
	const { handlers, ctx, notify, setStatus, setWidget } = installExtension(branch, true);
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
					{ role: "user", content: [{ type: "input_text", text: "older" }] },
					{ role: "user", content: [{ type: "input_text", text: "old" }] },
					{ role: "user", content: [{ type: "input_text", text: "current" }] },
				],
			},
		}, ctx);
	} finally {
		vi.unstubAllGlobals();
	}

	expect(fetchMock).toHaveBeenCalledTimes(2);
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
	expect(notify).toHaveBeenCalledWith("Codex context compacted (context overflow recovery).", "info");
});

test("clears an active request-side presentation when the session tree changes", async () => {
	const branch = [{
		id: "history",
		parentId: null,
		timestamp: new Date().toISOString(),
		type: "message",
		message: { role: "user", content: [{ type: "text", text: "branch" }] },
	} as never, checkpointEntry()];
	const { handlers, ctx, setWidget } = installExtension(branch, true);
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
				{ role: "user", content: [{ type: "input_text", text: "older" }] },
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
		{
			id: "failed-user",
			parentId: "checkpoint",
			timestamp: new Date().toISOString(),
			type: "message",
			message: { role: "user", content: [{ type: "text", text: secret }] },
		},
	] as never;
	const { handlers, ctx, notify, appendEntry } = installExtension(branch, true);
	const fetchMock = vi.fn(async () => new Response(
		JSON.stringify({ error: { code: "credential_bearer_secret", message: "Authorization Bearer secret" } }),
		{ status: 400 },
	));
	vi.stubGlobal("fetch", fetchMock);
	try {
		await handlers.get("before_provider_request")?.({
			payload: { input: [{ role: "user", content: [{ type: "input_text", text: secret }] }] },
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

test("keeps the previous encrypted checkpoint during compaction overflow recovery", async () => {
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
	const { handlers, ctx } = installExtension(branch);
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
			piCompactionEvent(branch),
			ctx,
		)).resolves.toHaveProperty("compaction");
	} finally {
		vi.unstubAllGlobals();
	}

	expect(fetchMock).toHaveBeenCalledTimes(2);
	expect(requestBodies[1]?.input).toEqual(expect.arrayContaining([
		expect.objectContaining({ type: "compaction", encrypted_content: "previous-checkpoint" }),
	]));
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

		handlers.get("turn_end")?.({}, ctx);
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
