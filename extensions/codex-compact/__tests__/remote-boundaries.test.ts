import { expect, test, vi } from "vitest";
import { createNativeCheckpoint } from "../src/remote-compaction.js";
import { approximateCompactionRequestTokens, createBranchInputSnapshot, createCheckpointReplayProjection, NATIVE_COMPACTION_KIND, modelKey, type NativeCompactionDetails, type ResponseItem } from "../src/native-compaction.js";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

test("lets the server accept a complete request despite an over-window local estimate", async () => {
	const input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "x".repeat(3760) }] }];
	const tokens = approximateCompactionRequestTokens({ input, instructions: "", tools: undefined });
	expect(tokens).toBeGreaterThan(950);
	expect(tokens).toBeLessThanOrEqual(1000);
	const apiKey = `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.x`;
	const fetchMock = vi.fn(async () => new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n'));
	vi.stubGlobal("fetch", fetchMock);
	try {
		await expect(createNativeCheckpoint({
			ctx: {
				cwd: "/nonexistent-compaction-test", isProjectTrusted: () => false, getSystemPrompt: () => "",
				sessionManager: { getSessionId: () => "test" },
				modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey }) },
			} as never,
			model: { id: "gpt-5.6-sol", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 1000 } as never,
			input, allTools: [], activeToolNames: [],
		})).resolves.toMatchObject({ details: { replacementHistory: expect.arrayContaining([{ type: "compaction", encrypted_content: "opaque" }]) } });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
		expect(body.input.slice(0, -1)).toEqual(input);
	} finally { vi.unstubAllGlobals(); }
});

test("budgets retained history against the final request without truncating protected input", async () => {
	const user = (text: string) => ({ role: "user", content: [{ type: "input_text", text }] });
	const protectedInput = [user("current".repeat(350))];
	const before = structuredClone(protectedInput);
	vi.stubGlobal("fetch", async () => new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n'));
	try {
		const result = await createNativeCheckpoint({
			ctx: { cwd: "/nonexistent-compaction-test", isProjectTrusted: () => false, getSystemPrompt: () => "stable",
				sessionManager: { getSessionId: () => "test" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.x` }) } } as never,
			model: { id: "gpt", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 1000 } as never,
			input: [user("historical".repeat(1000))], protectedInput, basePayload: { instructions: "stable", tools: [] }, allTools: [], activeToolNames: [],
		});
		expect(approximateCompactionRequestTokens({ input: [...result.details.replacementHistory, ...protectedInput], instructions: "stable", tools: [] })).toBeLessThanOrEqual(950);
		expect(result.details.replacementHistory.some(item => item.role === "user")).toBe(true);
		expect(protectedInput).toEqual(before);
	} finally { vi.unstubAllGlobals(); }
});

test("budgets the projected replay with current declarations and an unchanged pending suffix", async () => {
	const model = { id: "gpt", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 2000,
		compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } } as const;
	const tool = (name: string, description: string) => ({ name, description, parameters: { type: "object", properties: {} } });
	const active = tool("read", "current".repeat(100));
	const retired = tool("retired", "obsolete".repeat(2000));
	const branch = [{ id: "system", type: "message", message: { role: "system", content: "stable", toolsAdded: [tool("read", "old"), retired], timestamp: 0 } },
		{ id: "update", type: "message", message: { role: "system", content: "stable", toolsAdded: [active], toolsRemoved: [retired], timestamp: 1 } }] as unknown as SessionEntry[];
	const protectedInput: ResponseItem[] = [{ role: "user", content: [{ type: "input_text", text: "PENDING_" + "p".repeat(800) }] }];
	const pendingBefore = structuredClone(protectedInput);
	const projectReplay = (replacementHistory: ResponseItem[]) => {
		const details: NativeCompactionDetails = { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(model as never), replacementHistory, preservedInput: protectedInput };
		const appended = [...branch, { id: "preview", type: "custom", customType: NATIVE_COMPACTION_KIND, data: details }] as SessionEntry[];
		const view = createBranchInputSnapshot({ branch: appended, tools: [], }).view(model as never, "effective");
		return { input: view.items, instructions: view.instructions ?? "stable", tools: view.tools ?? [] };
	};
	vi.stubGlobal("fetch", async () => new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n'));
	try {
		const params = { ctx: { cwd: "/nonexistent-compaction-test", isProjectTrusted: () => false, getSystemPrompt: () => "stable",
			sessionManager: { getSessionId: () => "test" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.x` }) } } as never,
			model: model as never, input: [{ role: "user", content: [{ type: "input_text", text: "history".repeat(4000) }] }],
			protectedInput, projectReplay, basePayload: { instructions: "stable", tools: [] }, allTools: [], activeToolNames: [] };
		const result = await createNativeCheckpoint(params);
		const replay = projectReplay(result.details.replacementHistory);
		expect(approximateCompactionRequestTokens(replay)).toBeLessThanOrEqual(1900);
		expect(protectedInput).toEqual(pendingBefore);
		expect(replay.input.filter(item => item.role === "user").at(-1)).toEqual(protectedInput[0]);
		const declarations = replay.input.filter(item => item.type === "additional_tools").flatMap(item => item.tools as any[]);
		expect(declarations.map(tool => tool.name)).toEqual(["read"]);
		expect(declarations[0].description).toBe(active.description);
		expect(result.details.replacementHistory.some(item => item.role === "user")).toBe(true);
	} finally { vi.unstubAllGlobals(); }
});

test("freezes replay projection and uses the target model declaration rules", () => {
	const model = { id: "target", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 2000,
		compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } };
	const tool = (name: string, description: string) => ({ name, description, parameters: { type: "object", properties: {} } });
	const active = tool("read", "current");
	const hidden = tool("hidden", "hidden");
	const branch = [{ id: "system", type: "message", message: { role: "system", content: "original", toolsAdded: [active, hidden], timestamp: 0 } }] as unknown as SessionEntry[];
	const pending: ResponseItem[] = [{ role: "user", content: [{ type: "input_text", text: "pending" }] }];
	const policy = { hiddenNames: new Set(["hidden"]), forcedPrompt: "forced" };
	const project = createCheckpointReplayProjection({ branch, model: model as never, tools: [], projectionPolicy: policy, protectedInput: pending, fallbackInstructions: "fallback" });
	active.description = "mutated";
	model.compat.supportsAdditionalTools = false;
	policy.hiddenNames.clear();
	policy.forcedPrompt = "mutated";
	branch.length = 0;
	pending.push({ role: "user", content: [] });
	const replay = project([{ type: "compaction", encrypted_content: "opaque" }]);
	expect(replay.instructions).toBe("forced");
	expect(replay.input.filter(item => item.role === "user")).toEqual([{ role: "user", content: [{ type: "input_text", text: "pending" }] }]);
	const tools = replay.input.filter(item => item.type === "additional_tools").flatMap(item => item.tools as any[]);
	expect(tools.map(tool => [tool.name, tool.description])).toEqual([["read", "current"]]);
});

test.each([true, false])("projects current tool state with supportsAdditionalTools=%s", changes => {
	const model = { id: "target", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 2000,
		compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: changes, supportsToolSearch: !changes } };
	const retired = { name: "retired", description: "obsolete", parameters: { type: "object", properties: {} } };
	const active = { name: "read", description: "current", parameters: { type: "object", properties: {} } };
	const branch = [{ id: "initial", type: "message", message: { role: "system", content: "stable", toolsAdded: [retired], timestamp: 0 } },
		{ id: "remove", type: "message", message: { role: "system", content: "stable", toolsRemoved: [retired], timestamp: 1 } },
		{ id: "add", type: "message", message: { role: "system", content: "stable", toolsAdded: [active], timestamp: 2 } }] as unknown as SessionEntry[];
	const replay = createCheckpointReplayProjection({ branch, model: model as never, tools: [], fallbackInstructions: "stable" })([{ type: "compaction", encrypted_content: "opaque" }]);
	const declarations = replay.input.filter(item => item.type === (changes ? "additional_tools" : "tool_search_output"));
	expect(declarations.flatMap(item => (item.tools as any[]).map(tool => tool.name))).toEqual(["read"]);
	if (changes) expect(JSON.stringify(replay.input)).toContain("The following tools are no longer available. Do not call them:");
	else expect(replay.input.some(item => item.type === "tool_search_call")).toBe(true);
});

test("freezes tool declarations supplied without recorded system messages", () => {
	const model = { id: "target", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 2000 };
	const tool = { name: "read", description: "original", parameters: { type: "object", properties: {} } };
	const project = createCheckpointReplayProjection({ branch: [], model: model as never, tools: [tool] as never, fallbackInstructions: "stable" });
	tool.description = "changed";
	expect(project([{ type: "compaction", encrypted_content: "opaque" }]).tools?.map((tool: any) => tool.description)).toEqual(["original"]);
	expect(project([{ type: "compaction", encrypted_content: "opaque" }]).instructions).toBe("stable");
});

test("bounds generated tool-search restoration IDs before the real checkpoint ID exists", () => {
	const model = { id: "target", provider: "openai-codex", api: "openai-codex-responses",
		compat: { supportsMidConvoSystemMessages: true, supportsToolSearch: true, supportsAdditionalTools: false } };
	const tool = { name: "read", description: "current", parameters: { type: "object", properties: {} } };
	const branch = [{ id: "initial", type: "message", message: { role: "system", content: "stable", timestamp: 0 } },
		{ id: "load", type: "message", message: { role: "system", content: "stable", toolsAdded: [tool], timestamp: 1 } }] as unknown as SessionEntry[];
	const replacementHistory = [{ type: "compaction", encrypted_content: "opaque" }];
	const preview = createCheckpointReplayProjection({ branch, model: model as never, tools: [], fallbackInstructions: "stable" })(replacementHistory);
	const restored = preview.input.filter(item => item.type === "tool_search_call" || item.type === "tool_search_output");
	expect(restored).toHaveLength(2);
	expect(restored.every(item => String(item.call_id).length === "pi_tool_restore_".length + 14)).toBe(true);
	for (let index = 0; index < 50; index++) {
		const details = { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(model as never), replacementHistory };
		const actual = createBranchInputSnapshot({ branch: [...branch, { id: `runtime-${index}`, type: "custom", customType: NATIVE_COMPACTION_KIND, data: details }] as SessionEntry[], tools: [] }).view(model as never, "effective");
		expect(approximateCompactionRequestTokens(preview)).toBeGreaterThanOrEqual(approximateCompactionRequestTokens({ input: actual.items, instructions: actual.instructions ?? "stable", tools: actual.tools }));
	}
});

test("keeps a complete fixed projection when it alone exceeds the replay budget", async () => {
	const pending = [{ role: "user", content: [{ type: "input_text", text: "p".repeat(8000) }] }];
	vi.stubGlobal("fetch", async () => new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n'));
	try {
		const result = await createNativeCheckpoint({
			ctx: { cwd: "/nonexistent-compaction-test", isProjectTrusted: () => false, getSystemPrompt: () => "stable",
				sessionManager: { getSessionId: () => "test" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.x` }) } } as never,
			model: { id: "gpt", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 1000 } as never,
			input: [{ role: "user", content: [{ type: "input_text", text: "history".repeat(1000) }] }], protectedInput: pending,
			projectReplay: retained => ({ input: [...retained, ...pending], instructions: "stable", tools: [] }), allTools: [], activeToolNames: [],
		});
		expect(result.details.replacementHistory).toEqual([{ type: "compaction", encrypted_content: "opaque" }]);
		expect(pending[0].content[0].text).toHaveLength(8000);
	} finally { vi.unstubAllGlobals(); }
});

test.each([undefined, []])("does not regenerate declarations from observed tools=%j", async (tools) => {
	let body: any;
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		body = JSON.parse(String(init.body));
		return new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n');
	});
	try {
		await createNativeCheckpoint({
			ctx: { cwd: "/nonexistent-compaction-test", isProjectTrusted: () => false, getSystemPrompt: () => "stable", sessionManager: { getSessionId: () => "test" },
				modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.x` }) } } as never,
			model: { id: "gpt", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 1000 } as never,
			input: [], basePayload: { instructions: "stable", ...(tools ? { tools } : {}) },
			allTools: [{ name: "hidden", description: "hidden", parameters: { type: "object", properties: {} } }] as never, activeToolNames: ["hidden"],
		});
		expect(body.tools ?? []).toEqual([]);
	} finally { vi.unstubAllGlobals(); }
});

test("freezes prompt and declarations before awaiting credentials", async () => {
	const tool = { name: "read", description: "original", parameters: { type: "object", properties: {} } };
	let prompt = "original prompt";
	let body: any;
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		body = JSON.parse(String(init.body));
		return new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n');
	});
	try {
		await createNativeCheckpoint({
			ctx: { cwd: "/nonexistent-compaction-test", getSystemPrompt: () => prompt, sessionManager: { getSessionId: () => "test" },
				modelRegistry: { getApiKeyAndHeaders: async () => { prompt = "changed"; tool.description = "changed";
					return { ok: true, apiKey: `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.x` }; } } } as never,
			model: { id: "gpt", provider: "openai-codex", api: "openai-codex-responses", contextWindow: 1000 } as never,
			input: [], allTools: [tool] as never, activeToolNames: ["read"],
		});
		expect(body.instructions).toBe("original prompt");
		expect(body.tools[0].description).toBe("original");
	} finally { vi.unstubAllGlobals(); }
});
