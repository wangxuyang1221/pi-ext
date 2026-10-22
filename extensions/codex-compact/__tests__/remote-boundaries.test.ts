import { expect, test, vi } from "vitest";
import { createNativeCheckpoint } from "../src/remote-compaction.js";
import { approximateCompactionRequestTokens } from "../src/native-compaction.js";

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
