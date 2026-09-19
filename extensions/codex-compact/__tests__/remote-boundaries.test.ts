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
