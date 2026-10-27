import { fixtureToolInfo } from "../../../test-support/tool-info.js";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { fixtureSnapshot, resolveFixtureHashes } from "./fixtures/compaction-metadata.js";
import { describe, expect, test, vi } from "vitest";
import { convertToLlm, SessionManager, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { getTestModel } from "./fixtures/models.js";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import type { Model } from "@earendil-works/pi-ai";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, convertToLlm: vi.fn(actual.convertToLlm) };
});
import { createSessionCoordinator, type RemoteCompactionReason } from "../src/session-coordinator.js";
import * as config from "../src/config.js";
import { shouldAutoCompact } from "../src/scheduler.js";
import { createNativeCheckpoint } from "../src/remote-compaction.js";
import { approximateCompactionRequestTokens } from "../src/native-compaction.js";
import {
	effectiveInputForBranch,
	buildReplacementHistory,
	findNativeCheckpoint,
	modelKey,
	FAILED_REQUEST_KIND,
	NATIVE_COMPACTION_BYPASS_KIND,
	NATIVE_COMPACTION_BYPASS_VERSION,
	NATIVE_COMPACTION_KIND,
	NATIVE_COMPACTION_VERSION,
	type NativeCompactionDetails,
	type ResponseItem,
} from "../src/native-compaction.js";

const CATALOG_IDS: Record<string, string> = {
	old: "gpt-5.5",
	new: "gpt-5.6-sol",
	other: "gpt-5.4",
	unknown: "gpt-5.2",
	unknownOther: "codex-auto-review",
};

function model(name: string, provider = "openai-codex", contextWindow = 100_000): Model<any> {
	const id = provider === "openai-codex" ? (CATALOG_IDS[name] ?? name) : name;
	return {
		provider,
		api: provider === "openai-codex" ? "openai-codex-responses" : "other-api",
		id,
		reasoning: true,
		contextWindow,
	} as Model<any>;
}

function context(models: Model<any>[] = [], systemPrompt = "instructions"): ExtensionContext {
	return {
		getSystemPrompt: () => systemPrompt,
		sessionManager: {
			getSessionId: () => "session",
			getBranch: () => [],
		},
		modelRegistry: {
			find: (provider: string, id: string) => models.find((candidate) => candidate.provider === provider && candidate.id === id),
		},
	} as unknown as ExtensionContext;
}

function details(key: string, encrypted = "opaque"): NativeCompactionDetails {
	return {
		kind: NATIVE_COMPACTION_KIND,
		version: NATIVE_COMPACTION_VERSION,
		modelKey: key,
		replacementHistory: [{ type: "compaction", encrypted_content: encrypted }],
	};
}

function customEntry(data: unknown, id = "checkpoint", customType = NATIVE_COMPACTION_KIND): SessionEntry {
	return {
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
		type: "custom",
		customType,
		data,
	} as unknown as Extract<SessionEntry, {type: "message"}>;
}

function userEntry(text: string, id = "user"): Extract<SessionEntry, {type: "message"}> {
	return {
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
		type: "message",
		message: { role: "user", content: [{ type: "text", text }] },
	} as unknown as Extract<SessionEntry, {type: "message"}>;
}

function assistantEntry(selected: Model<any>, id = "assistant", stopReason = "stop"): Extract<SessionEntry, {type: "message"}> {
	return {
		id, parentId: null, timestamp: new Date().toISOString(), type: "message",
		message: { role: "assistant", provider: selected.provider, api: selected.api, model: selected.id,
			stopReason, content: [{ type: "text", text: "previous answer" }] },
	} as unknown as Extract<SessionEntry, {type: "message"}>;
}

function modelChangeEntry(selected: Model<any>, id: string): SessionEntry {
	return { id, parentId: null, timestamp: new Date().toISOString(), type: "model_change",
		provider: selected.provider, modelId: selected.id } as SessionEntry;
}

function userInput(text: string): ResponseItem {
	return { role: "user", content: [{ type: "input_text", text }] };
}

function createCoordinator(
	branch: SessionEntry[] = [],
	createCheckpoint?: (selectedModel: Model<any>, input: ResponseItem[], basePayload?: Record<string, unknown>) => Promise<NativeCompactionDetails>,
	shouldAutoCompact?: (input: ResponseItem[]) => boolean,
	onCompaction?: (reason: RemoteCompactionReason) => void,
	onAutomaticFailure?: () => void,
) {
	return createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
		getBranch: () => branch,
		getAllTools: () => [],
		createCheckpoint: async ({ model: selectedModel, input, basePayload }) => ({
			details: createCheckpoint
				? await createCheckpoint(selectedModel, input, basePayload)
				: details(modelKey(selectedModel)),
		}),
		appendCheckpoint: (value) => branch.push(customEntry(value)),
		appendCheckpointBypass: (value) => branch.push(customEntry(value, "bypass", NATIVE_COMPACTION_BYPASS_KIND)),
		appendFailedRequest: (value) => branch.push(customEntry(value, "failed-request", FAILED_REQUEST_KIND)),
		...(onAutomaticFailure ? { onAutomaticCompactionFailure: onAutomaticFailure } : {}),
		shouldAutoCompact: shouldAutoCompact ? ({ input }) => shouldAutoCompact(input) : undefined,
		runCompaction: onCompaction
			? async (_ctx, reason, operation) => {
				onCompaction(reason);
				return operation();
			}
			: undefined,
	});
}

describe("Codex session coordinator", () => {
	test.each(["new user", "clear", "model"])("grants a fresh capacity allowance after %s", async change => {
		const old = model("old", "openai-codex", 100_000), next = model("other", "openai-codex", 1000);
		const branch: SessionEntry[] = [userEntry("history".repeat(2000), "history"), assistantEntry(old, "answer"), userEntry("p".repeat(3700), "pending")];
		const compact = vi.fn(async selected => ({ ...details(modelKey(selected)), replacementHistory: [userInput("retained"), ...details(modelKey(selected)).replacementHistory] }));
		const coordinator = createCoordinator(branch, compact, () => true);
		const ctx = context([old, next], "");
		const input = effectiveInputForBranch({ branch, model: next, tools: [] });
		await coordinator.selectModel({ previousModel: old, model: next }, ctx);
		await coordinator.prepareRequest(next, ctx, input, { instructions: "", tools: [] });
		expect(compact).toHaveBeenCalledTimes(1);
		await coordinator.prepareRequest(next, ctx, input, { instructions: "", tools: [] });
		expect(compact).toHaveBeenCalledTimes(1);
		if (change === "new user") branch.push(userEntry("p".repeat(3700), "same-text-new-occurrence"));
		else if (change === "clear") coordinator.clear();
		else await coordinator.selectModel({ previousModel: next, model: { ...old, contextWindow: 500 } }, ctx);
		await coordinator.prepareRequest(change === "model" ? { ...old, contextWindow: 500 } : next, ctx,
			change === "new user" ? effectiveInputForBranch({ branch, model: next, tools: [] }) : input, { instructions: "", tools: [] });
		expect(compact).toHaveBeenCalledTimes(2);
	});
	test.each(["temporary compaction failure", "context_length_exceeded"])("consumes the capacity allowance before a failed downshift with %s", async message => {
		const old = model("old", "openai-codex", 100_000), next = model("other", "openai-codex", 1000);
		const branch: SessionEntry[] = [userEntry("history".repeat(2000), "history"), assistantEntry(old, "answer"), userEntry("p".repeat(3700), "pending")];
		const error = Object.assign(new Error(message), { retryWithCurrentModel: false });
		const compact = vi.fn(async () => { throw error; });
		const coordinator = createCoordinator(branch, compact, () => true);
		const ctx = context([old, next], "");
		const input = effectiveInputForBranch({ branch, model: next, tools: [] });
		await coordinator.selectModel({ previousModel: old, model: next }, ctx);
		await expect(coordinator.prepareRequest(next, ctx, input, { instructions: "", tools: [] })).rejects.toBe(error);
		await coordinator.prepareRequest(next, ctx, input, { instructions: "", tools: [] }).catch(() => undefined);
		expect(compact).toHaveBeenCalledTimes(1);
	});
	test.each(["selection", "checkpoint", "direct recovery"])("shares the same-hash capacity allowance through %s", async entry => {
		const old = model("old", "openai-codex", 100_000), next = model("other", "openai-codex", 1000);
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "history".repeat(2000), timestamp: 0 });
		sm.appendMessage(assistantEntry(old, "answer").message as never);
		if (entry !== "selection") sm.appendCustomEntry(NATIVE_COMPACTION_KIND, { ...details(modelKey(old)), compHash: "2911" });
		const text = "p".repeat(3700);
		sm.appendMessage({ role: "user", content: text, timestamp: 1 });
		const input = effectiveInputForBranch({ branch: sm.getBranch(), model: next, tools: [], allowCheckpointModelMismatch: true });
		const reasons: RemoteCompactionReason[] = [];
		const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"compact"}}\n\n', { headers: { "content-type": "text/event-stream" } }));
		const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
		const ctx = { ...context([old, next], ""), model: next, sessionManager: sm,
			modelRegistry: { find: (provider: string, id: string) => [old, next].find(m => m.provider === provider && m.id === id), getApiKeyAndHeaders: async () => ({ ok: true, apiKey }) } } as never;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: params => createNativeCheckpoint({ ...params, compHash: params.compactionHashes.hashFor(params.model), allTools: [], activeToolNames: [] }),
			appendCheckpoint: value => sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value), appendCheckpointBypass: vi.fn(),
			shouldAutoCompact: ({ model, input, reason }) => shouldAutoCompact({ status: { activeContextTokens: approximateCompactionRequestTokens({ input, instructions: "", tools: [] }),
				contextWindow: config.effectiveContextWindow({ autoCompactScope: "total" }, model.contextWindow) }, limit: config.autoCompactTokenLimit({ autoCompactScope: "total" }, model.contextWindow), scope: "total", reason }),
			runCompaction: async (_ctx, reason, operation) => { reasons.push(reason); return operation(); } });
		try {
			if (entry === "selection") await coordinator.selectModel({ previousModel: old, model: next }, ctx);
			if (entry === "direct recovery") await coordinator.recoverCurrentModel(next, ctx, { instructions: "", tools: [] }, input);
			const output = await coordinator.prepareRequest(next, ctx, input, { instructions: "", tools: [] });
			expect(output).toEqual([{ type: "compaction", encrypted_content: "opaque" }, userInput(text)]);
			expect(approximateCompactionRequestTokens({ input: output!, instructions: "", tools: [] })).toBeGreaterThan(config.effectiveContextWindow({ autoCompactScope: "total" }, next.contextWindow));
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(reasons).toEqual(["model-transition"]);
			await coordinator.prepareRequest(next, ctx, input, { instructions: "", tools: [] });
			expect(fetch).toHaveBeenCalledTimes(1);
		} finally { fetch.mockRestore(); }
	});
	test("freezes direct recovery evidence before metadata resolution", async () => {
		const old = model("old"), next = model("new");
		const branch: SessionEntry[] = [userEntry("old"), customEntry({ ...details(modelKey(old)), compHash: "2911" })];
		const compact = vi.fn(async (_options: Parameters<NonNullable<Parameters<typeof createSessionCoordinator>[0]["createCheckpoint"]>>[0]) => ({ details: details(modelKey(next)) }));
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: async () => { (branch[0] as any).message.content = "changed"; return fixtureSnapshot; },
			getBranch: () => branch, getAllTools: () => [], createCheckpoint: compact, appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn() });
		await expect(coordinator.recoverCurrentModel(next, context([old, next]))).rejects.toThrow(/changed/);
		expect(compact).not.toHaveBeenCalled();
	});
	test("reserves an unpersisted request suffix in a model transition budget", async () => {
		const old = model("old"), next = model("new", "openai-codex", 1000);
		const branch: SessionEntry[] = [userEntry("history")];
		const compact = vi.fn(async (_options: Parameters<NonNullable<Parameters<typeof createSessionCoordinator>[0]["createCheckpoint"]>>[0]) => ({ details: details(modelKey(next)) }));
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => [],
			createCheckpoint: compact, appendCheckpoint: value => branch.push(customEntry(value)), appendCheckpointBypass: vi.fn() });
		const ctx = context([old, next]);
		await coordinator.selectModel({ previousModel: old, model: next }, ctx);
		const current = userInput("fresh".repeat(500));
		await coordinator.prepareRequest(next, ctx, [userInput("history"), current]);
		expect(compact.mock.calls[0]?.[0]).toMatchObject({ input: [userInput("history")], protectedInput: [current], replayContextWindow: 1000 });
	});
	test.each(["declaration", "branch"])("preserves the old checkpoint when %s changes during transition", async change => {
		const old = model("old"), next = model("new");
		const branch: SessionEntry[] = [userEntry("old"), customEntry({ ...details(modelKey(old)), compHash: "2911" })];
		const tool = { ...fixtureToolInfo, name: "read", description: "old", parameters: { type: "object" as const, properties: {} } };
		const bypass = vi.fn(), append = vi.fn();
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => [tool] as never,
			createCheckpoint: async () => {
				if (change === "declaration") tool.description = "new";
				else (branch[0] as any).message.content = "edited";
				return { details: details(modelKey(next)) };
			}, appendCheckpoint: append, appendCheckpointBypass: bypass });
		await expect(coordinator.prepareRequest(next, context([old, next]), [...details(modelKey(old)).replacementHistory, userInput("pending")])).rejects.toThrow(/changed/);
		expect(append).not.toHaveBeenCalled();
		expect(bypass).not.toHaveBeenCalled();
	});
	test("rejects unproven transition input without guessing that the last wire user is human", async () => {
		const old = model("old"), next = model("new");
		const branch: SessionEntry[] = [userEntry("actual branch")];
		const compact = vi.fn(async () => details(modelKey(next)));
		const coordinator = createCoordinator(branch, compact);
		const ctx = context([old, next]);
		await coordinator.selectModel({ previousModel: old, model: next }, ctx);
		await expect(coordinator.prepareRequest(next, ctx, [userInput("changed history"), userInput("custom suffix")])).rejects.toThrow();
		expect(compact).not.toHaveBeenCalled();
		expect(branch).toHaveLength(1);
	});
	test("supports first manual compaction with an explicit hidden and forced policy", async () => {
		const m = model("old");
		const tools = ["visible", "hidden"].map(name => ({ ...fixtureToolInfo, name, description: name, parameters: { type: "object" as const, properties: {} } }));
		const branch: SessionEntry[] = [userEntry("pending")];
		const policy = vi.spyOn(config, "loadConfig").mockReturnValue({ autoCompactScope: "total", manualProjection: { hiddenTools: ["hidden"], forcedPrompt: "Forced prompt" } });
		try {
			const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => tools as never,
				createCheckpoint: vi.fn(), appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn() });
			const plan = await coordinator.prepareCompactionPlan(m, context([m], "Forced prompt"));
			expect(plan.input).toEqual([]);
			expect(plan.preservedInput).toEqual([userInput("pending")]);
			expect(plan.basePayload.instructions).toBe("Forced prompt");
			expect((plan.basePayload.tools as any[]).map(tool => tool.name)).toEqual(["visible"]);
			tools[0]!.description = "changed";
			expect(plan.assertCurrent).toThrow(/changed/);
		} finally { policy.mockRestore(); }
	});
	test("does not discard custom suffix content missing from the persisted checkpoint", async () => {
		const m = model("old");
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "old", timestamp: 0 });
		sm.appendMessage(assistantEntry(m, "answer").message as never);
		sm.appendMessage({ role: "user", content: "pending", timestamp: 1 });
		sm.appendCustomMessageEntry("context", "custom suffix", false);
		const raw = effectiveInputForBranch({ branch: sm.getBranch(), model: m, tools: [] });
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async () => ({ details: details(modelKey(m)) }),
			appendCheckpoint: value => sm.appendCustomEntry(NATIVE_COMPACTION_KIND, { ...value, preservedInput: value.preservedInput?.slice(0, 1), preservedInputSources: value.preservedInputSources?.slice(0, 1) }),
			appendCheckpointBypass: vi.fn(), shouldAutoCompact: () => true });
		const actual = await coordinator.prepareRequest(m, { ...context([m], ""), sessionManager: sm } as never, raw);
		expect(actual?.filter(item => JSON.stringify(item).includes("custom suffix"))).toHaveLength(1);
	});
	test("protects the persisted source-owned user and custom suffix after coordinator reload", async () => {
		const m = model("old", "openai-codex", 1000);
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "old history", timestamp: 0 });
		sm.appendMessage(assistantEntry(m, "answer").message as never);
		const userId = sm.appendMessage({ role: "user", content: "pending".repeat(500), timestamp: 1 });
		const customId = sm.appendCustomMessageEntry("context", "custom suffix", false);
		const raw = effectiveInputForBranch({ branch: sm.getBranch(), model: m, tools: [] });
		const suffix = raw.slice(-2);
		sm.appendCustomEntry(NATIVE_COMPACTION_KIND, { ...details(modelKey(m)), replacementHistory: [userInput("old".repeat(2000)), ...details(modelKey(m)).replacementHistory],
			preservedInput: suffix, preservedInputSources: [userId, customId] });
		const inputs: ResponseItem[][] = [];
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async ({ input }) => { inputs.push(input); return { details: details(modelKey(m), "next") }; },
			appendCheckpoint: value => sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value), appendCheckpointBypass: vi.fn(), shouldAutoCompact: () => true });
		const actual = await coordinator.prepareRequest(m, { ...context([m], ""), sessionManager: sm } as never, raw);
		expect(inputs).toHaveLength(1);
		expect(inputs[0]).not.toContainEqual(suffix[0]);
		expect(inputs[0]).not.toContainEqual(suffix[1]);
		expect(actual?.slice(-2)).toEqual(suffix);
		expect(actual?.filter(item => item.role === "user")).toHaveLength(2);
	});
	test("does not reset the automatic repair allowance when a checkpoint changes", async () => {
		const m = model("old", "openai-codex", 1000);
		const old = userInput("old".repeat(2000));
		const current = userInput("current");
		const branch: SessionEntry[] = [userEntry("old".repeat(2000), "old"), assistantEntry(m), userEntry("current", "new")];
		const input = effectiveInputForBranch({ branch, model: m, tools: [] });
		const compact = vi.fn(async () => ({ details: { ...details(modelKey(m)), replacementHistory: [old, ...details(modelKey(m)).replacementHistory] } }));
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => [],
			createCheckpoint: compact, appendCheckpoint: value => branch.push(customEntry(value, `checkpoint-${branch.length}`)), appendCheckpointBypass: vi.fn(), shouldAutoCompact: () => true });
		const ctx = context([m], "");
		await coordinator.prepareRequest(m, ctx, input, { instructions: "", tools: [] });
		await coordinator.prepareRequest(m, ctx, input, { instructions: "", tools: [] });
		expect(compact).toHaveBeenCalledTimes(1);
		expect(findNativeCheckpoint(branch, modelKey(m)).status).toBe("valid");
		expect(effectiveInputForBranch({ branch, model: m, tools: [] })).toContainEqual(current);
		await coordinator.prepareRequest(m, ctx, [...input, userInput("another unpersisted request")], { instructions: "", tools: [] });
		expect(compact).toHaveBeenCalledTimes(2);
	});
	test("requires an explicit declaration policy for first manual compaction with tools", async () => {
		const m = model("old");
		const branch: SessionEntry[] = [userEntry("history")];
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch,
			getAllTools: () => [{ ...fixtureToolInfo, name: "hider", description: "May use a private loadout", parameters: { type: "object" } }] as never,
			createCheckpoint: vi.fn(), appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn() });
		await expect(coordinator.prepareCompactionPlan(m, context([m]))).rejects.toThrow(/manualProjection/);
	});
	test.each(["metadata", "remote"])("rejects changed declarations during %s await before committing", async (phase) => {
		const m = model("old");
		const branch: SessionEntry[] = [userEntry("history", "old"), assistantEntry(m), userEntry("current", "current")];
		const tool = { ...fixtureToolInfo, name: "read", description: "original", parameters: { type: "object" as const, properties: {} } };
		const append = vi.fn();
		const coordinator = createSessionCoordinator({
			getBranch: () => branch, getAllTools: () => [tool], appendCheckpoint: append, appendCheckpointBypass: vi.fn(), shouldAutoCompact: () => true,
			resolveCompactionHashes: async (...args) => { if (phase === "metadata") tool.description = "changed"; return resolveFixtureHashes(); },
			createCheckpoint: async () => { if (phase === "remote") tool.description = "changed"; return { details: details(modelKey(m)) }; },
		});
		const input = effectiveInputForBranch({ branch, model: m, tools: [tool] as never });
		await expect(coordinator.prepareRequest(m, context([m]), input)).rejects.toThrow(/changed/);
		expect(append).not.toHaveBeenCalled();
	});
	test.each(["request", "recovery"] as const)("preserves callback and nested declaration checks during %s metadata resolution", async entry => {
		for (const change of ["none", "callback", "schema"] as const) {
			const m = model("old");
			const branch: SessionEntry[] = [userEntry("hello")];
			const tool = { ...fixtureToolInfo, name: "script", description: "Script", parameters: { type: "object" as const, properties: { code: { type: "string" } } },
				reachesTools: () => ["read"] };
			const append = vi.fn();
			const coordinator = createSessionCoordinator({ getBranch: () => branch, getAllTools: () => [tool],
				resolveCompactionHashes: async () => {
					if (change === "callback") tool.reachesTools = () => ["write"];
					if (change === "schema") tool.parameters.properties.code.type = "number";
					return fixtureSnapshot;
				},
				createCheckpoint: vi.fn(), appendCheckpoint: append, appendCheckpointBypass: vi.fn() });
			const ctx = context([m]);
			const result = entry === "request" ? coordinator.prepareRequest(m, ctx, undefined) : coordinator.recoverCurrentModel(m, ctx);
			if (change === "none") await expect(result).resolves.toBeUndefined();
			else await expect(result).rejects.toThrow(/changed/);
			expect(append).not.toHaveBeenCalled();
		}
	});

	test("keeps manual compaction snapshots independent while retaining callback identity", async () => {
		const configured = vi.spyOn(config, "loadConfig").mockReturnValue({ manualProjection: { hiddenTools: [] } } as never);
		try {
			for (const change of ["none", "callback", "schema"] as const) {
				const m = model("old"), branch = [userEntry("history")];
				const tool = { ...fixtureToolInfo, name: "script", description: "Script", parameters: { type: "object" as const, properties: { code: { type: "string" } } },
					reachesTools: () => ["read"] };
				const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch,
					getAllTools: () => [tool], createCheckpoint: vi.fn(), appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn() });
				const plan = await coordinator.prepareCompactionPlan(m, context([m]));
				expect(plan.preservedInput).toEqual([userInput("history")]);
				expect(plan.assertCurrent).toBeTypeOf("function");
				if (change === "callback") tool.reachesTools = () => ["write"];
				if (change === "schema") tool.parameters.properties.code.type = "number";
				if (change === "none") expect(() => plan.assertCurrent!()).not.toThrow();
				else expect(() => plan.assertCurrent!()).toThrow(/changed/);
			}
		} finally { configured.mockRestore(); }
	});

	test("repairs over-window retained history even when only the current user follows the checkpoint", async () => {
		const m = model("old", "openai-codex", 128_000);
		const old = userInput("a".repeat(255_900));
		const current = userInput("b".repeat(280_000));
		const branch: SessionEntry[] = [userEntry("a".repeat(255_900), "old"), customEntry({ ...details(modelKey(m)), replacementHistory: [old, ...details(modelKey(m)).replacementHistory] }), userEntry("b".repeat(280_000), "new")];
		const decide = vi.fn(() => true);
		const compact = vi.fn(async ({ input, protectedInput }: any) => {
			expect(input).not.toContainEqual(current);
			expect(protectedInput).toEqual([current]);
			return { details: details(modelKey(m), "new-opaque") };
		});
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes, getBranch: () => branch, getAllTools: () => [],
			createCheckpoint: compact, appendCheckpoint: value => branch.push(customEntry(value, "new-checkpoint")), appendCheckpointBypass: () => {}, shouldAutoCompact: decide });
		const result = await coordinator.prepareRequest(m, context([m], ""), [old, current], { instructions: "", tools: [] });
		expect(compact).toHaveBeenCalledTimes(1);
		expect(decide).toHaveBeenCalledWith(expect.objectContaining({ input: [old, ...details(modelKey(m)).replacementHistory, current] }));
		expect(result).toEqual([{ type: "compaction", encrypted_content: "new-opaque" }, current]);
	});
	test.each([true, false])("recovers an older transition behind an equal-hash selection, selected: %s", async (selected) => {
		const old = model("old");
		const middle = model("new");
		const current = model("gpt-5.6-terra");
		expect([fixtureSnapshot.hashFor(old), fixtureSnapshot.hashFor(middle), fixtureSnapshot.hashFor(current)])
			.toEqual(["2911", "3000", "3000"]);
		const branch: SessionEntry[] = [userEntry("old task", "old-user"), assistantEntry(old, "old-answer"),
			modelChangeEntry(middle, "middle-change"), modelChangeEntry(current, "current-change"), userEntry("new task", "new-user")];
		const resolver = vi.fn(resolveFixtureHashes);
		const compressed = vi.fn(async ({ model: selectedModel, input }: { model: Model<any>; input: ResponseItem[] }) => {
			expect(selectedModel.id).toBe(old.id);
			expect(JSON.stringify(input)).toContain("old task");
			expect(JSON.stringify(input)).not.toContain("new task");
			return { details: details(modelKey(selectedModel)) };
		});
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolver, getBranch: () => branch,
			getAllTools: () => [], createCheckpoint: compressed,
			appendCheckpoint: value => branch.push(customEntry(value)), appendCheckpointBypass: vi.fn(), shouldAutoCompact: () => false });
		const ctx = context([old, middle, current]);
		if (selected) await coordinator.selectModel({ model: current, previousModel: middle }, ctx);
		expect(resolver).not.toHaveBeenCalled();
		const result = await coordinator.prepareRequest(current, ctx, effectiveInputForBranch({ branch, model: current, tools: [] }));
		expect(resolver).toHaveBeenCalledTimes(1);
		expect(compressed).toHaveBeenCalledTimes(1);
		const checkpoint = findNativeCheckpoint(branch, modelKey(current));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status === "valid") expect(checkpoint.checkpoint.details.compHash).toBe("3000");
		expect(result?.filter(item => item.role === "user" && JSON.stringify(item.content).includes("new task"))).toHaveLength(1);
	});
	test.each(["error", "aborted"])("retains a recovered transition after an over-window %s response", async (stopReason) => {
		const old = model("old");
		const current = model("new");
		const branch: SessionEntry[] = [userEntry("old task", "old-user"), assistantEntry(old, "old-answer"),
			modelChangeEntry(current, "change"), userEntry("first task", "first-user")];
		const calls: string[] = [];
		const resolver = vi.fn(resolveFixtureHashes);
		let fail = true;
		const appendCheckpoint = vi.fn((value: unknown) => branch.push(customEntry(value)));
		const appendCheckpointBypass = vi.fn();
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolver, getBranch: () => branch,
			getAllTools: () => [], shouldAutoCompact: () => false,
			createCheckpoint: async ({ model: selectedModel }) => {
				calls.push(selectedModel.id);
				if (fail) throw new Error("context_length_exceeded");
				return { details: details(modelKey(selectedModel)) };
			}, appendCheckpoint, appendCheckpointBypass });
		const ctx = context([old, current]);
		const prepare = () => coordinator.prepareRequest(current, ctx, effectiveInputForBranch({ branch, model: current, tools: [] }));
		await expect(prepare()).rejects.toThrow("context_length_exceeded");
		expect(calls).toEqual([old.id, current.id]);
		branch.push(assistantEntry(current, "failed-answer", stopReason), userEntry("second task", "second-user"));
		await expect(prepare()).rejects.toThrow("context_length_exceeded");
		expect(calls).toEqual([old.id, current.id, old.id, current.id]);
		expect(resolver).toHaveBeenCalledTimes(2);
		expect(appendCheckpoint).not.toHaveBeenCalled();
		expect(appendCheckpointBypass).not.toHaveBeenCalled();
		fail = false;
		branch.push(userEntry("third task", "third-user"));
		const result = await prepare();
		expect(calls).toEqual([old.id, current.id, old.id, current.id, old.id]);
		const checkpoint = findNativeCheckpoint(branch, modelKey(current));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status === "valid") expect(checkpoint.checkpoint.details.compHash).toBe("3000");
		expect(result?.filter(item => item.role === "user" && JSON.stringify(item.content).includes("third task"))).toHaveLength(1);
		branch.push(userEntry("fourth task", "fourth-user"));
		await prepare();
		expect(calls).toHaveLength(5);
		expect(resolver).toHaveBeenCalledTimes(4);
	});
	test("keeps checkpoint priority over a stale target and rejects a mismatched target without one", async () => {
		const old = model("old"), pendingModel = model("new"), current = model("gpt-5.6-terra");
		const ctx = context([old, pendingModel, current]);
		const branch: SessionEntry[] = [customEntry({ ...details(modelKey(current)), compHash: "3000" }), userEntry("next")];
		const compressed = vi.fn();
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => branch, getAllTools: () => [], createCheckpoint: compressed,
			appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn(), shouldAutoCompact: () => false });
		await coordinator.selectModel({ model: pendingModel, previousModel: old }, ctx);
		await expect(coordinator.prepareRequest(current, ctx, [{ type: "compaction", encrypted_content: "opaque" }, userInput("next")]))
			.resolves.toEqual([{ type: "compaction", encrypted_content: "opaque" }, userInput("next")]);
		expect(compressed).not.toHaveBeenCalled();

		const empty: SessionEntry[] = [];
		const mismatch = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => empty, getAllTools: () => [], createCheckpoint: compressed,
			appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn() });
		await mismatch.selectModel({ model: pendingModel, previousModel: old }, ctx);
		await expect(mismatch.prepareRequest(current, ctx, [userInput("next")]))
			.rejects.toThrow("The pending Codex model transition targets a different model.");
		expect(compressed).not.toHaveBeenCalled();
	});

	test("ignores an equal-hash selection when history belongs to the selected model", async () => {
		const middle = model("new"), current = model("gpt-5.6-terra");
		const branch: SessionEntry[] = [userEntry("old task", "old-user"), assistantEntry(middle, "answer"),
			modelChangeEntry(current, "change"), userEntry("new task", "new-user")];
		const compressed = vi.fn();
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => branch, getAllTools: () => [], createCheckpoint: compressed,
			appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn(), shouldAutoCompact: () => false });
		const ctx = context([middle, current]);
		await coordinator.selectModel({ model: current, previousModel: middle }, ctx);
		await coordinator.prepareRequest(current, ctx, effectiveInputForBranch({ branch, model: current, tools: [] }));
		expect(compressed).not.toHaveBeenCalled();
	});
	test.each([true, false])("uses Pi's newest ordinary summary after model selection, overlap: %s", async (overlap) => {
		const currentModel = getTestModel("openai-codex", "gpt-5.6-sol")!;
		const oldModel = model("legacy", "other");
		const sm = SessionManager.inMemory(process.cwd());
		const first = sm.appendMessage({ role: "user", content: "U1", timestamp: 1 });
		sm.appendCompaction("C1", first, 0);
		const second = sm.appendMessage({ role: "user", content: "U2", timestamp: 2 });
		sm.appendCompaction("C2", overlap ? first : second, 0);
		sm.appendModelChange(currentModel.provider, currentModel.id);
		sm.appendMessage({ role: "user", content: "U3", timestamp: 3 });
		let payload: { input: ResponseItem[] } | undefined;
		const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
		await streamSimple(currentModel, normalizeContext({ messages: convertToLlm(sm.buildSessionProjection().messages) }), {
			apiKey, onPayload: value => { payload = value as { input: ResponseItem[] }; throw new Error("Stop before network"); },
		}).result();
		expect(payload).toBeDefined();
		const seen: ResponseItem[][] = [];
		let autoCalls = 0;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(),
			getAllTools: () => [],
			createCheckpoint: async ({ input }) => { seen.push(input); return { details: details(modelKey(currentModel)) }; },
			appendCheckpoint: value => { sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value); },
			appendCheckpointBypass: () => {},
			shouldAutoCompact: () => { autoCalls++; return true; },
		});
		const ctx = context([currentModel, oldModel]);
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const manual = await coordinator.prepareCompaction(currentModel, ctx);
		expect(JSON.stringify(manual)).toContain("C2");
		expect(JSON.stringify(manual)).not.toContain("C1");
		const final = await coordinator.prepareRequest(currentModel, ctx, payload!.input);
		expect(autoCalls).toBe(1);
		expect(seen).toHaveLength(1);
		expect(JSON.stringify(seen[0])).toContain("C2");
		expect(JSON.stringify(seen[0])).not.toContain("C1");
		expect(JSON.stringify(seen[0])).not.toContain("U3");
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content).includes("U3"))).toHaveLength(1);
	});
	test("preserves the edited current user outside automatic compaction", async () => {
		const currentModel = model("new", "openai-codex", 1_000_000);
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "previous history", timestamp: 1 });
		const currentId = sm.appendMessage({ role: "user", content: "original task", timestamp: 2 });
		const task = "start ".repeat(30_000) + "MIDDLE_CONSTRAINT_MUST_SURVIVE" + " finish".repeat(30_000);
		sm.appendContextEdit(currentId, { content: task });
		const branch = sm.getBranch();
		const requestInput = effectiveInputForBranch({ branch, model: currentModel, tools: [] });
		const seen: ResponseItem[][] = [];
		const coordinator = createCoordinator(branch, async (_selected, input) => {
			seen.push(input);
			return details(modelKey(currentModel));
		}, () => true);
		const final = await coordinator.prepareRequest(currentModel, context([currentModel]), requestInput);
		expect(seen).toHaveLength(1);
		expect(JSON.stringify(seen[0])).not.toContain("MIDDLE_CONSTRAINT_MUST_SURVIVE");
		const checkpoint = findNativeCheckpoint(branch, modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toEqual([requestInput.at(-1)]);
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content).includes("MIDDLE_CONSTRAINT_MUST_SURVIVE"))).toEqual([requestInput.at(-1)]);
	});
	test("binds the latest edited user by source after an omitted and same-text history user", async () => {
		const currentModel = model("new");
		const sm = SessionManager.inMemory(process.cwd());
		const omitted = sm.appendMessage({ role: "user", content: "omit", timestamp: 1 });
		sm.appendMessage({ role: "user", content: "same", timestamp: 2 });
		const current = sm.appendMessage({ role: "user", content: "draft", timestamp: 3 });
		sm.appendContextEdit(omitted, null);
		sm.appendContextEdit(current, { content: "intermediate" });
		sm.appendContextEdit(current, { content: "same" });
		const branch = sm.getBranch();
		const requestInput = effectiveInputForBranch({ branch, model: currentModel, tools: [] });
		const seen: ResponseItem[][] = [];
		const coordinator = createCoordinator(branch, async (_selected, input) => {
			seen.push(input);
			return details(modelKey(currentModel));
		}, () => true);
		const final = await coordinator.prepareRequest(currentModel, context([currentModel]), requestInput);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.filter((item) => item.role === "user")).toEqual([userInput("same")]);
		const checkpoint = findNativeCheckpoint(branch, modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toEqual([requestInput.at(-1)]);
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content).includes("same"))).toHaveLength(1);
	});

	test("keeps an extra same-text payload user after the latest branch user", async () => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [userEntry("same", "history"), userEntry("same", "branch-current")];
		const base = effectiveInputForBranch({ branch, model: currentModel, tools: [] });
		const requestInput = [...base, userInput("same")];
		const seen: ResponseItem[][] = [];
		const coordinator = createCoordinator(branch, async (_selected, input) => {
			seen.push(input);
			return details(modelKey(currentModel));
		}, () => true);
		const final = await coordinator.prepareRequest(currentModel, context([currentModel]), requestInput);
		expect(seen[0]?.filter((item) => item.role === "user")).toHaveLength(2);
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content).includes("same"))).toHaveLength(1);
	});
	test("preserves the exact image and text item for an edited current user", async () => {
		const currentModel = getTestModel("openai-codex", "gpt-5.6-sol")!;
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "earlier history", timestamp: 0 });
		const current = sm.appendMessage({ role: "user", content: "draft", timestamp: 1 });
		sm.appendContextEdit(current, { content: [
			{ type: "text", text: "inspect this image" },
			{ type: "image", data: "AA==", mimeType: "image/png" },
		] });
		const branch = sm.getBranch();
		const requestInput = effectiveInputForBranch({ branch, model: currentModel, tools: [] });
		const coordinator = createCoordinator(branch, async () => details(modelKey(currentModel)), () => true);
		const final = await coordinator.prepareRequest(currentModel, context([currentModel]), requestInput);
		const checkpoint = findNativeCheckpoint(branch, modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toEqual([requestInput.at(-1)]);
		expect(final?.filter((item) => item.role === "user")).toEqual([requestInput.at(-1)]);
		expect(JSON.stringify(final)).toContain("input_image");
	});
	test("does not append a checkpoint after a new edit arrives during automatic compaction", async () => {
		const currentModel = model("new", "openai-codex", 1_000_000);
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "earlier history", timestamp: 0 });
		const current = sm.appendMessage({ role: "user", content: "original", timestamp: 1 });
		sm.appendContextEdit(current, { content: "first revision" });
		const requestInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] });
		let release!: () => void;
		let started!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const ready = new Promise<void>((resolve) => { started = resolve; });
		let appended = 0;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(),
			getAllTools: () => [],
			createCheckpoint: async () => { started(); await gate; return { details: details(modelKey(currentModel)) }; },
			appendCheckpoint: () => { appended++; },
			appendCheckpointBypass: () => {},
			shouldAutoCompact: () => true,
		});
		const pending = coordinator.prepareRequest(currentModel, context([currentModel]), requestInput);
		await ready;
		sm.appendContextEdit(current, { content: "second revision" });
		release();
		await pending;
		expect(appended).toBe(0);
		expect(findNativeCheckpoint(sm.getBranch(), modelKey(currentModel)).status).toBe("none");
	});
	test("protects an unconsumed user together with its later custom context", async () => {
		const currentModel = model("new");
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "older history", timestamp: 0 });
		sm.appendMessage({ role: "user", content: "earlier user", timestamp: 1 });
		sm.appendCustomMessageEntry("note", "later custom", false);
		const branch = sm.getBranch();
		const requestInput = effectiveInputForBranch({ branch, model: currentModel, tools: [] });
		const seen: ResponseItem[][] = [];
		const coordinator = createCoordinator(branch, async (_selected, input) => {
			seen.push(input);
			return details(modelKey(currentModel));
		}, () => true);
		const final = await coordinator.prepareRequest(currentModel, context([currentModel]), requestInput);
		expect(seen[0]).toEqual(requestInput.slice(0, 1));
		const checkpoint = findNativeCheckpoint(branch, modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toEqual(requestInput.slice(1));
		expect(final).toEqual([...details(modelKey(currentModel)).replacementHistory, ...requestInput.slice(1)]);
	});
	test("invalidates an old transition before retrying or committing after model selection", async () => {
		const old = model("old"), target = model("new"), next = model("other");
		const branch: SessionEntry[] = [customEntry(details(modelKey(old))), userEntry("continue")];
		const ctx = context([old, target, next]);
		let release!: () => void;
		let started!: () => void;
		const ready = new Promise<void>((resolve) => { started = resolve; });
		const gate = new Promise<void>((resolve) => { release = resolve; });
		let calls = 0;
		const coordinator = createCoordinator(branch, async (selected) => {
			calls++;
			started();
			await gate;
			return details(modelKey(selected));
		});
		await coordinator.selectModel({ model: target, previousModel: old }, ctx);
		const request = coordinator.prepareRequest(target, ctx, [
			{ type: "compaction", encrypted_content: "opaque" }, userInput("continue"),
		]);
		const outcome = request.then(() => "committed", (error: Error) => error.message);
		await ready;
		branch.push({ id: "new-model", type: "model_change", provider: next.provider, modelId: next.id } as SessionEntry);
		await coordinator.selectModel({ model: next, previousModel: target }, ctx);
		release();
		expect(await outcome).not.toBe("committed");
		expect(calls).toBe(1);
		expect(branch.filter((entry) => entry.type === "custom")).toHaveLength(1);
	});
	test("does not persist failed request input while filtering its retry", async () => {
		const currentModel = model("new");
		const secret = "sk-live-user-input-secret";
		const branch: SessionEntry[] = [customEntry(details(modelKey(currentModel))), userEntry(secret, "failed-user")];
		const coordinator = createCoordinator(branch);
		const ctx = context([currentModel]);
		coordinator.recordFailedRequest(ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput(secret),
		]);

		const marker = branch.find((entry) => entry.type === "custom" && entry.customType === FAILED_REQUEST_KIND);
		expect(marker).toMatchObject({ data: { kind: FAILED_REQUEST_KIND, entryId: "failed-user" } });
		expect(marker).not.toHaveProperty("data.content");
		expect(JSON.stringify(marker)).not.toContain(secret);

		await expect(coordinator.prepareRequest(currentModel, ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput(secret),
			userInput("new request"),
		])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("new request"),
		]);
	});

	test("does not persist a failed marker for a tool/assistant continuation", () => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			userEntry("prompt", "user"),
			{
				id: "assistant",
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: {
					role: "assistant",
					provider: currentModel.provider,
					api: currentModel.api,
					model: currentModel.id,
					content: [{ type: "text", text: "answer" }],
				},
			} as never,
		];
		const coordinator = createCoordinator(branch);
		coordinator.recordFailedRequest(context([currentModel]), [
			userInput("prompt"),
			{ type: "function_call_output", call_id: "call", output: "tool result" },
			{ role: "assistant", content: [{ type: "output_text", text: "answer" }] },
		]);

		expect(branch.some((entry) => entry.type === "custom" && entry.customType === FAILED_REQUEST_KIND)).toBe(false);
	});

	test("filters all unresolved valid markers after the last successful assistant", async () => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			userEntry("older", "older-user"),
			{
				id: "assistant",
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: { role: "assistant", provider: currentModel.provider, api: currentModel.api, model: currentModel.id, stopReason: "stop", content: [{ type: "text", text: "answer" }] },
			} as never,
			userEntry("failed one", "failed-one"),
			customEntry({ kind: FAILED_REQUEST_KIND, entryId: "failed-one" }, "marker-one", FAILED_REQUEST_KIND),
			userEntry("failed two", "failed-two"),
			customEntry({ kind: FAILED_REQUEST_KIND, entryId: "failed-two" }, "marker-two", FAILED_REQUEST_KIND),
		];
		const coordinator = createCoordinator(branch);
		const input = await coordinator.prepareCompaction(currentModel, context([currentModel]));

		expect(input.filter((item) => item.role === "user")).toEqual([userInput("older")]);
	});

	test("does not let a malformed later marker mask an earlier valid marker", async () => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			userEntry("failed", "failed-user"),
			customEntry({ kind: FAILED_REQUEST_KIND, entryId: "failed-user" }, "valid-marker", FAILED_REQUEST_KIND),
			customEntry({ kind: FAILED_REQUEST_KIND, entryId: 42 }, "malformed-marker", FAILED_REQUEST_KIND),
		];
		const coordinator = createCoordinator(branch);
		const input = await coordinator.prepareCompaction(currentModel, context([currentModel]));

		expect(input.filter((item) => item.role === "user")).toEqual([]);
	});

	test("ignores a marker that points before the last successful assistant", async () => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			customEntry(details(modelKey(currentModel))),
			userEntry("U", "user"),
			{
				id: "assistant",
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: {
					role: "assistant",
					provider: currentModel.provider,
					api: currentModel.api,
					model: currentModel.id,
					stopReason: "stop",
					content: [{ type: "text", text: "answer" }],
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					timestamp: Date.now(),
				},
			},
			customEntry({ kind: FAILED_REQUEST_KIND, entryId: "user", content: [
				{ type: "input_text", text: "U" },
			] }, "marker", FAILED_REQUEST_KIND),
			customEntry({ kind: FAILED_REQUEST_KIND, entryId: "future-user", content: [
				{ type: "input_text", text: "future" },
			] }, "future-marker", FAILED_REQUEST_KIND),
			userEntry("future", "future-user"),
		];
		const coordinator = createCoordinator(branch);
		const input = await coordinator.prepareCompaction(currentModel, context([currentModel]));

		expect(input.filter((item) => item.role === "user")).toEqual([userInput("U"), userInput("future")]);
		expect(input.find((item) => item.role === "assistant")).toMatchObject({ role: "assistant" });
		await expect(coordinator.prepareRequest(currentModel, context([currentModel]), input)).resolves.toEqual(input);
	});

	test.each([
		["missing", { entryId: "post-user", content: [{ type: "input_text", text: "post" }] }],
		["wrong", { kind: "other", entryId: "post-user", content: [{ type: "input_text", text: "post" }] }],
	])("ignores a marker with %s data.kind", async (_name, markerData) => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			{
				id: "assistant",
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: {
					role: "assistant",
					provider: currentModel.provider,
					api: currentModel.api,
					model: currentModel.id,
					stopReason: "stop",
					content: [{ type: "text", text: "answer" }],
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					timestamp: Date.now(),
				},
			},
			userEntry("post", "post-user"),
			customEntry(markerData, "marker", FAILED_REQUEST_KIND),
		];
		const coordinator = createCoordinator(branch);
		const input = await coordinator.prepareCompaction(currentModel, context([currentModel]));

		expect(input.map((item) => item.role)).toEqual(["assistant", "user"]);
		expect(input.at(-1)).toEqual(userInput("post"));
	});

	test("keeps an older equal-content user when a retry reuses its original user", async () => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			customEntry(details(modelKey(currentModel))),
			userEntry("same", "older-user"),
			userEntry("same", "failed-user"),
		];
		const coordinator = createCoordinator(branch);
		const ctx = context([currentModel]);
		coordinator.recordFailedRequest(ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
		]);

		await expect(coordinator.prepareRequest(currentModel, ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
			userInput("same"),
		])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
			userInput("same"),
		]);
	});

	test("keeps filtering legacy failed markers that still contain content", async () => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			customEntry(details(modelKey(currentModel))),
			customEntry({
				kind: FAILED_REQUEST_KIND,
				entryId: "missing-user",
				content: [{ type: "input_text", text: "legacy failed" }],
			}, "failed-request", FAILED_REQUEST_KIND),
		];
		const coordinator = createCoordinator(branch);
		const ctx = context([currentModel]);

		await expect(coordinator.prepareRequest(currentModel, ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("legacy failed"),
			userInput("new request"),
		])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("new request"),
		]);
	});

	test("keeps a failed user as the next retry input", async () => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [customEntry(details(modelKey(currentModel))), userEntry("failed", "failed-user")];
		const coordinator = createCoordinator(branch);
		const ctx = context([currentModel]);
		coordinator.recordFailedRequest(ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("failed"),
		]);

		await expect(coordinator.prepareRequest(currentModel, ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("failed"),
		])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("failed"),
		]);
	});

	test("removes the nearest failed duplicate, not an older matching user", async () => {
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			customEntry(details(modelKey(currentModel))),
			userEntry("same", "older"),
			userEntry("same", "failed-user"),
		];
		const coordinator = createCoordinator(branch);
		const ctx = context([currentModel]);
		coordinator.recordFailedRequest(ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
		]);

		await expect(coordinator.prepareRequest(currentModel, ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
			userInput("same"),
			userInput("new"),
		])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
			userInput("new"),
		]);
	});

	test("skips model-transition compaction when either hash is absent", async () => {
		const oldModel = model("unknown");
		const currentModel = model("unknownOther");
		let calls = 0;
		const coordinator = createCoordinator([], async () => {
			calls++;
			return details(modelKey(currentModel));
		});

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")])).resolves.toBeUndefined();
		expect(calls).toBe(0);
	});

	test("resolves only the final model selection before the first request", async () => {
		const firstModel = model("old");
		const middleModel = model("other");
		const finalModel = model("new");
		const branch: SessionEntry[] = [];
		const ctx = context([firstModel, middleModel, finalModel]);
		const resolver = vi.fn(resolveFixtureHashes);
		const compactedWith: string[] = [];
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolver,
			getBranch: () => branch, getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel }) => {
				compactedWith.push(selectedModel.id);
				return { details: details(modelKey(selectedModel)) };
			},
			appendCheckpoint: (value) => branch.push(customEntry(value)),
			appendCheckpointBypass: () => {},
		});
		await coordinator.selectModel({ model: middleModel, previousModel: firstModel }, ctx);
		await coordinator.selectModel({ model: firstModel, previousModel: middleModel }, ctx);
		expect(resolver).not.toHaveBeenCalled();
		await coordinator.prepareRequest(firstModel, ctx, [userInput("hello")]);
		expect(compactedWith).toEqual([]);
		await coordinator.selectModel({ model: middleModel, previousModel: firstModel }, ctx);
		await coordinator.selectModel({ model: finalModel, previousModel: middleModel }, ctx);
		expect(resolver).toHaveBeenCalledTimes(1);
		await coordinator.prepareRequest(finalModel, ctx, [userInput("hello")]);
		expect(compactedWith).toEqual([firstModel.id]);
		expect(resolver).toHaveBeenCalledTimes(2);
	});

	test("discards a metadata result after the selected model changes", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		let release!: (value: typeof fixtureSnapshot) => void;
		const resolver = vi.fn(() => new Promise<typeof fixtureSnapshot>((resolve) => { release = resolve; }));
		const createCheckpoint = vi.fn(async () => ({ details: details(modelKey(oldModel)) }));
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolver,
			getBranch: () => [], getAllTools: () => [], createCheckpoint,
			appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn(),
		});
		const ctx = context([oldModel, currentModel]);
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const pending = coordinator.prepareRequest(currentModel, ctx, [userInput("hello")]);
		expect(resolver).toHaveBeenCalledTimes(1);
		await coordinator.selectModel({ model: oldModel, previousModel: currentModel }, ctx);
		release(fixtureSnapshot);
		await expect(pending).rejects.toThrow(/session changed/);
		expect(createCheckpoint).not.toHaveBeenCalled();
	});

	test("discards metadata when the request signal changes during resolution", async () => {
		const selectedModel = model("new");
		let release!: (value: typeof fixtureSnapshot) => void;
		const resolver = vi.fn(() => new Promise<typeof fixtureSnapshot>((resolve) => { release = resolve; }));
		const createCheckpoint = vi.fn(async () => ({ details: details(modelKey(selectedModel)) }));
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolver,
			getBranch: () => [], getAllTools: () => [], createCheckpoint,
			appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn(),
		});
		const ctx = context([selectedModel]);
		(ctx as any).signal = new AbortController().signal;
		const pending = coordinator.prepareRequest(selectedModel, ctx, [userInput("hello")]);
		(ctx as any).signal = new AbortController().signal;
		release(fixtureSnapshot);
		await expect(pending).rejects.toThrow(/session changed/);
		expect(createCheckpoint).not.toHaveBeenCalled();
	});

	test("discards metadata when the session changes during resolution", async () => {
		const selectedModel = model("new");
		let release!: (value: typeof fixtureSnapshot) => void;
		let sessionId = "first";
		const createCheckpoint = vi.fn(async () => ({ details: details(modelKey(selectedModel)) }));
		const coordinator = createSessionCoordinator({
			resolveCompactionHashes: () => new Promise((resolve) => { release = resolve; }),
			getBranch: () => [], getAllTools: () => [], createCheckpoint,
			appendCheckpoint: vi.fn(), appendCheckpointBypass: vi.fn(),
		});
		const ctx = context([selectedModel]);
		(ctx as any).sessionManager.getSessionId = () => sessionId;
		const pending = coordinator.prepareRequest(selectedModel, ctx, [userInput("hello")]);
		sessionId = "second";
		release(fixtureSnapshot);
		await expect(pending).rejects.toThrow(/session changed/);
		expect(createCheckpoint).not.toHaveBeenCalled();
	});

	test("compacts on the first request after a known hash transition", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const compactedWith: string[] = [];
		const coordinator = createCoordinator([], async (selectedModel) => {
			compactedWith.push(modelKey(selectedModel));
			return details(modelKey(selectedModel));
		});

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		const input = await coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")]);

		expect(compactedWith).toEqual([modelKey(oldModel)]);
		expect(input).toEqual([{ type: "compaction", encrypted_content: "opaque" }, userInput("hello")]);
	});

	test("recovers a model transition when a resumed session has no model-change entry", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const branch: SessionEntry[] = [{
			id: "assistant",
			parentId: null,
			timestamp: new Date().toISOString(),
			type: "message",
			message: {
				role: "assistant",
				provider: oldModel.provider,
				api: oldModel.api,
				model: oldModel.id,
				content: [{ type: "text", text: "answer" }],
			},
		} as unknown as SessionEntry];
		const compactedWith: string[] = [];
		const coordinator = createCoordinator(branch, async (selectedModel) => {
			compactedWith.push(modelKey(selectedModel));
			return details(modelKey(selectedModel), "resumed");
		});

		const input = await coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [...effectiveInputForBranch({ branch, model: currentModel, tools: [] }), userInput("hello")]);

		expect(compactedWith).toEqual([modelKey(oldModel)]);
		expect(input).toEqual([{ type: "compaction", encrypted_content: "resumed" }, userInput("hello")]);
	});

	test("compacts on a context-window downshift only at the auto limit", async () => {
		const oldModel = model("old", "openai-codex", 200_000);
		const currentModel = model("other", "openai-codex", 100_000);
		let calls = 0;
		let thresholdChecks = 0;
		const budgetInputs: ResponseItem[][] = [];
		const coordinator = createCoordinator([], async (selectedModel) => {
			calls++;
			return details(modelKey(selectedModel), "downshift");
		}, input => { budgetInputs.push(input); return thresholdChecks++ === 0; });

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "downshift" },
			userInput("hello"),
		]);
		expect(calls).toBe(1);
		expect(budgetInputs[0]).toContainEqual(userInput("hello"));
	});

	test("uses the current model only for an eligible transition failure", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const compactedWith: string[] = [];
		const operations: RemoteCompactionReason[] = [];
		const coordinator = createCoordinator([], async (selectedModel) => {
			compactedWith.push(modelKey(selectedModel));
			if (selectedModel === oldModel) {
				const error = new Error("context_length_exceeded") as Error & { retryWithCurrentModel: boolean };
				Object.defineProperty(error, "retryWithCurrentModel", { value: true });
				throw error;
			}
			return details(modelKey(selectedModel), "fallback");
		}, undefined, (reason) => operations.push(reason));

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "fallback" },
			userInput("hello"),
		]);
		expect(compactedWith).toEqual([modelKey(oldModel), modelKey(currentModel)]);
		expect(operations).toEqual(["model-transition"]);
	});

	test("keeps the terminal current-model fallback error", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const compactedWith: string[] = [];
		const coordinator = createCoordinator([], async (selectedModel) => {
			compactedWith.push(modelKey(selectedModel));
			if (selectedModel === oldModel) {
				const error = new Error("context_length_exceeded") as Error & { retryWithCurrentModel: boolean };
				Object.defineProperty(error, "retryWithCurrentModel", { value: true });
				throw error;
			}
			const error = new Error("policy_violation") as Error & { retryWithCurrentModel: boolean };
			Object.defineProperty(error, "retryWithCurrentModel", { value: false });
			throw error;
		});

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")])).rejects.toThrow("policy_violation");
		expect(compactedWith).toEqual([modelKey(oldModel), modelKey(currentModel)]);
	});

	test("rejects unmatched request history without replacing a valid checkpoint with a suffix", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			userEntry("history"),
			customEntry({ ...details(modelKey(oldModel)), compHash: "2911" }),
		];
		const compactedWith: string[] = [];
		const coordinator = createCoordinator(branch, async (selectedModel) => {
			compactedWith.push(modelKey(selectedModel));
			if (selectedModel === oldModel) {
				const error = new Error("context_length_exceeded") as Error & { retryWithCurrentModel: boolean };
				Object.defineProperty(error, "retryWithCurrentModel", { value: true });
				throw error;
			}
			const error = new Error("policy_violation") as Error & { retryWithCurrentModel: boolean };
			Object.defineProperty(error, "retryWithCurrentModel", { value: false });
			throw error;
		});

		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("different")])).rejects.toMatchObject({
			code: "history_prefix_mismatch", name: "HistoryPrefixMismatchError", mismatchIndex: 0,
		});
		expect(compactedWith).toEqual([]);
		expect(branch).toHaveLength(2);
	});

	test("keeps unknown credential transition failures out of current-model fallback", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		let calls = 0;
		const coordinator = createCoordinator([], async () => {
			calls++;
			throw new Error("OpenAI Codex compaction failed (503): credential_backend_failure");
		});

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")])).rejects.toThrow("credential_backend_failure");
		expect(calls).toBe(1);
	});

	test("does not fall back for an unknown HTTP protocol transition failure", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		let calls = 0;
		const coordinator = createCoordinator([], async (selectedModel) => {
			calls++;
			if (selectedModel === oldModel) {
				const error = new Error("OpenAI Codex compaction failed (500): future_protocol_code") as Error & { retryWithCurrentModel: boolean };
				Object.defineProperty(error, "retryWithCurrentModel", { value: false });
				throw error;
			}
			return details(modelKey(selectedModel), "unexpected-fallback");
		});

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")])).rejects.toThrow("future_protocol_code");
		expect(calls).toBe(1);
	});

	test("continues without retrying a failed transition gate", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		let calls = 0;
		const coordinator = createCoordinator([], async () => {
			calls++;
			const error = new Error("policy_violation") as Error & { retryWithCurrentModel: boolean };
			Object.defineProperty(error, "retryWithCurrentModel", { value: false });
			throw error;
		});

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")])).rejects.toThrow("policy_violation");
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")])).resolves.toBeUndefined();
		expect(calls).toBe(1);
	});

	test("bypasses a terminal checkpoint transition on later requests", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			userEntry("history", "history"),
			customEntry({ ...details(modelKey(oldModel)), compHash: "2911" }),
		];
		let calls = 0;
		const coordinator = createCoordinator(branch, async () => {
			calls++;
			const error = new Error("policy_violation") as Error & { retryWithCurrentModel: boolean };
			Object.defineProperty(error, "retryWithCurrentModel", { value: false });
			throw error;
		});
		const ctx = context([oldModel, currentModel]);

		await expect(coordinator.prepareRequest(currentModel, ctx, [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("next"),
		])).rejects.toThrow("policy_violation");
		const bypass = branch.find((entry) => entry.type === "custom" && entry.customType === NATIVE_COMPACTION_BYPASS_KIND);
		expect(bypass).toMatchObject({
			data: {
				kind: NATIVE_COMPACTION_BYPASS_KIND,
				version: NATIVE_COMPACTION_BYPASS_VERSION,
				gateEntryId: "checkpoint",
				targetModelKey: modelKey(currentModel),
			},
		});
		expect(JSON.stringify(bypass)).not.toContain("policy_violation");
		expect(findNativeCheckpoint(branch, modelKey(currentModel)).status).toBe("bypassed");
		expect(findNativeCheckpoint(branch, modelKey(oldModel)).status).toBe("valid");

		const resumed = createCoordinator(branch, async () => {
			throw new Error("must not compact");
		});
		await expect(resumed.prepareRequest(currentModel, ctx, [userInput("history"), userInput("next")])).resolves.toEqual([
			userInput("history"),
			userInput("next"),
		]);
		expect(calls).toBe(1);
	});

	test("keeps a bypass after its failed request user is filtered", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			{
				id: "old-assistant",
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: {
					role: "assistant",
					provider: oldModel.provider,
					api: oldModel.api,
					model: oldModel.id,
					content: [{ type: "text", text: "old" }],
				},
			} as never,
			{
				id: "new-model",
				parentId: "old-assistant",
				timestamp: new Date().toISOString(),
				type: "model_change",
				provider: currentModel.provider,
				modelId: currentModel.id,
			} as never,
			userEntry("failed", "failed-user"),
			customEntry({
				kind: NATIVE_COMPACTION_BYPASS_KIND,
				version: NATIVE_COMPACTION_BYPASS_VERSION,
				gateEntryId: "failed-user",
				targetModelKey: modelKey(currentModel),
			}, "bypass", NATIVE_COMPACTION_BYPASS_KIND),
			customEntry({ kind: FAILED_REQUEST_KIND, entryId: "failed-user" }, "failed-marker", FAILED_REQUEST_KIND),
		];
		let calls = 0;
		const coordinator = createCoordinator(branch, async () => {
			calls++;
			return details(modelKey(currentModel));
		});

		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("new")])).resolves.toEqual([userInput("new")]);
		expect(calls).toBe(0);
	});

	test("keeps a checkpoint for bounded overflow recovery", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const branch: SessionEntry[] = [
			userEntry("history", "history"),
			customEntry({ ...details(modelKey(oldModel)), compHash: "2911" }),
		];
		const coordinator = createCoordinator(branch, async () => {
			const error = new Error("context_length_exceeded") as Error & { retryWithCurrentModel: boolean };
			Object.defineProperty(error, "retryWithCurrentModel", { value: false });
			throw error;
		});

		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("next"),
		])).rejects.toThrow("context_length_exceeded");
		expect(branch.filter((entry) => entry.type === "custom" && entry.customType === NATIVE_COMPACTION_BYPASS_KIND)).toHaveLength(0);
	});

	test("does not replay an over-window bypassed branch", async () => {
		const oldModel = model("old");
		const currentModel = model("new", "openai-codex", 1);
		const branch: SessionEntry[] = [
			userEntry("history", "history"),
			customEntry({ ...details(modelKey(oldModel)), compHash: "2911" }),
			customEntry({
				kind: NATIVE_COMPACTION_BYPASS_KIND,
				version: NATIVE_COMPACTION_BYPASS_VERSION,
				gateEntryId: "checkpoint",
				targetModelKey: modelKey(currentModel),
			}, "bypass", NATIVE_COMPACTION_BYPASS_KIND),
		];
		const coordinator = createCoordinator(branch);

		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("history"), userInput("next")])).rejects.toThrow("complete branch cannot be replayed");
	});

	test("does not forward an over-window mismatched bypass request", async () => {
		const oldModel = model("old");
		const currentModel = model("new", "openai-codex", 10);
		const branch: SessionEntry[] = [
			userEntry("history", "history"),
			customEntry({ ...details(modelKey(oldModel)), compHash: "2911" }),
			customEntry({
				kind: NATIVE_COMPACTION_BYPASS_KIND,
				version: NATIVE_COMPACTION_BYPASS_VERSION,
				gateEntryId: "checkpoint",
				targetModelKey: modelKey(currentModel),
			}, "bypass", NATIVE_COMPACTION_BYPASS_KIND),
		];
		const coordinator = createCoordinator(branch);

		await expect(coordinator.prepareRequest(
			currentModel,
			context([oldModel, currentModel]),
			[userInput("different ".repeat(100))],
		)).rejects.toThrow("raw request cannot be replayed");
	});

	test("replays a checkpoint when the current model has no comparable hash", async () => {
		const oldModel = model("old");
		const currentModel = model("unknown");
		const branch: SessionEntry[] = [customEntry({ ...details(modelKey(oldModel)), compHash: "2911" })];
		let calls = 0;
		const coordinator = createCoordinator(branch, async () => {
			calls++;
			return details("unexpected");
		});

		const input = [{ type: "compaction", encrypted_content: "opaque" }, userInput("hello")];
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), input)).resolves.toEqual(input);
		expect(calls).toBe(0);
	});

	test("prepares the complete Pi compaction history even when its estimate exceeds the window", async () => {
		const currentModel = model("old", "openai-codex", 100);
		const branch: SessionEntry[] = [userEntry("early constraint".repeat(100), "old"), userEntry("latest task", "new")];
		const before = structuredClone(branch);
		const coordinator = createCoordinator(branch);
		const input = [userInput("early constraint".repeat(100)), userInput("latest task")];
		await expect(coordinator.prepareCompaction(currentModel, context([currentModel]))).resolves.toEqual(input);
		expect(branch).toEqual(before);
	});

	test("propagates the original automatic compaction overflow without retrying or dropping history", async () => {
		const currentModel = model("old", "openai-codex", 100);
		const oldText = "old ".repeat(100);
		const newText = "new ".repeat(5);
		const branch: SessionEntry[] = [userEntry(oldText, "old"), userEntry(newText, "new")];
		const before = structuredClone(branch);
		const failure = new Error("context_length_exceeded");
		const compactedInputs: ResponseItem[][] = [];
		const operations: RemoteCompactionReason[] = [];
		const coordinator = createCoordinator(branch, async (_selectedModel, input) => {
			compactedInputs.push(input);
			throw failure;
		}, () => true, (reason) => operations.push(reason));
		const toolOutput = { type: "function_call_output", call_id: "call", output: "tool result" };
		const request = [userInput(oldText), userInput(newText), userInput("current"), toolOutput];

		await expect(coordinator.prepareRequest(
			currentModel,
			context([currentModel]),
			request,
		)).rejects.toBe(failure);
		expect(compactedInputs).toEqual([[userInput(oldText), userInput(newText)]]);
		expect(operations).toEqual(["automatic"]);
		expect(branch).toEqual(before);
		expect(effectiveInputForBranch({ branch, model: currentModel, tools: [] })).toEqual([
			userInput(oldText), userInput(newText),
		]);
	});

	test("does not infer a missing persisted hash from the checkpoint model", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const branch: SessionEntry[] = [customEntry(details(modelKey(oldModel)))];
		let calls = 0;
		const coordinator = createCoordinator(branch, async () => {
			calls++;
			return details("unexpected");
		});

		const input = [{ type: "compaction", encrypted_content: "opaque" }, userInput("hello")];
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), input)).resolves.toEqual(input);
		expect(calls).toBe(0);
	});

	test("ignores an unsupported V1 checkpoint and leaves Pi's normal history unchanged", async () => {
		const currentModel = model("old");
		const branch: SessionEntry[] = [
			userEntry("old history"),
			customEntry({
				kind: NATIVE_COMPACTION_KIND,
				version: 2,
				strategy: "v1",
				modelKey: modelKey(currentModel),
				replacementHistory: [{ type: "compaction", encrypted_content: "old" }],
			}),
		];
		let calls = 0;
		const coordinator = createCoordinator(branch, async () => {
			calls++;
			return details(modelKey(currentModel));
		});

		await expect(coordinator.prepareRequest(
			currentModel,
			context([currentModel]),
			[userInput("old history"), userInput("new request")],
		)).resolves.toBeUndefined();
		expect(calls).toBe(0);
		expect(findNativeCheckpoint(branch).status).toBe("none");
	});

	test("leaves a malformed current checkpoint to Pi's normal history", async () => {
		const currentModel = model("old");
		const branch: SessionEntry[] = [
			userEntry("old"),
			userEntry("hello"),
			customEntry({
				kind: NATIVE_COMPACTION_KIND,
				version: NATIVE_COMPACTION_VERSION,
				strategy: "v2",
				modelKey: modelKey(currentModel),
				replacementHistory: [],
			}),
		];
		const coordinator = createCoordinator(branch);

		await expect(coordinator.prepareRequest(currentModel, context([currentModel]), [userInput("old"), userInput("hello")])).resolves.toBeUndefined();
	});

	test("preserves a persisted current user without duplicating it", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const branch: SessionEntry[] = [userEntry("current")];
		let compactedInput: ResponseItem[] | undefined;
		const coordinator = createCoordinator(branch, async (_selectedModel, input) => {
			compactedInput = input;
			return details(modelKey(currentModel), "transition");
		});

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		const input = await coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("current")]);

		expect(compactedInput).toEqual([]);
		expect(input).toEqual([{ type: "compaction", encrypted_content: "transition" }, userInput("current")]);
	});

	test("restores a checkpoint user when a second compaction truncates the same wire id", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const fullUser: ResponseItem = { type: "message", id: "current-wire", role: "user", content: [{ type: "input_text", text: "head MIDDLE_CONSTRAINT_MUST_SURVIVE tail" }] };
		const truncatedUser: ResponseItem = { ...fullUser, content: [{ type: "input_text", text: "head [truncated] tail" }] };
		const branch: SessionEntry[] = [customEntry({ ...details(modelKey(oldModel), "old"), preservedInput: [fullUser] })];
		const coordinator = createCoordinator(branch, async () => ({
			...details(modelKey(currentModel), "new"),
			replacementHistory: [truncatedUser, { type: "compaction", encrypted_content: "new" }],
		}));
		const ctx = context([oldModel, currentModel]);
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const final = await coordinator.prepareRequest(currentModel, ctx, [{ type: "compaction", encrypted_content: "old" }, fullUser]);
		const checkpoint = findNativeCheckpoint(branch, modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toEqual([fullUser]);
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content).includes("MIDDLE_CONSTRAINT_MUST_SURVIVE"))).toEqual([fullUser]);
	});

	test("keeps the complete edited task through transition then automatic compaction", async () => {
		const oldModel = model("old", "openai-codex", 1_000_000);
		const currentModel = model("new", "openai-codex", 1_000_000);
		const sm = SessionManager.inMemory(process.cwd());
		const current = sm.appendMessage({ role: "user", content: "draft", timestamp: 1 });
		const task = "start ".repeat(30_000) + "MIDDLE_CONSTRAINT_MUST_SURVIVE" + " finish".repeat(30_000);
		sm.appendContextEdit(current, { content: task });
		const branch = sm.getBranch();
		const requestInput = effectiveInputForBranch({ branch, model: currentModel, tools: [] });
		let calls = 0;
		const compactedInputs: ResponseItem[][] = [];
		const coordinator = createCoordinator(branch, async (selectedModel, input) => {
			calls++;
			compactedInputs.push(input);
			if (calls === 1) {
				expect(selectedModel).toBe(oldModel);
				expect(input).toEqual([]);
			} else {
				expect(selectedModel).toEqual(currentModel);
				expect(input.filter((item) => item.role === "user")).toEqual([]);
			}
			return {
				...details(modelKey(selectedModel)),
				replacementHistory: buildReplacementHistory(input, { type: "compaction", encrypted_content: `opaque-${calls}` }),
			};
		}, () => true);
		const ctx = context([oldModel, currentModel]);
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const final = await coordinator.prepareRequest(currentModel, ctx, requestInput);
		expect(calls).toBe(2);
		expect(compactedInputs[1]?.filter(item => item.role === "user")).toEqual([]);
		const checkpoint = findNativeCheckpoint(branch, modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toEqual([requestInput[0]]);
		expect(checkpoint.checkpoint.details.replacementHistory.at(-1)?.encrypted_content).toBe("opaque-2");
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content).includes("MIDDLE_CONSTRAINT_MUST_SURVIVE"))).toEqual([requestInput[0]]);
		expect(final?.filter((item) => item.role === "user")).toHaveLength(1);
	});

	test.each([0, 100, 100_000])("persists the edited request through two compactions with history size %i", async (historySize) => {
		const oldModel = { ...getTestModel("openai-codex", "gpt-5.5")!, contextWindow: 1_000_000 };
		const currentModel = { ...getTestModel("openai-codex", "gpt-5.6-sol")!, contextWindow: 1_000_000 };
		expect(fixtureSnapshot.hashFor(oldModel)).toBeDefined();
		expect(fixtureSnapshot.hashFor(oldModel)).not.toBe(fixtureSnapshot.hashFor(currentModel));
		const sm = SessionManager.inMemory(process.cwd());
		if (historySize > 0) {
			for (let index = 0; index < 5; index++) {
				sm.appendMessage({ role: "user", content: `H${index}:` + "h".repeat(historySize - 3), timestamp: index + 1 });
			}
		}
		const currentId = sm.appendMessage({ role: "user", content: "draft", timestamp: 6 });
		const task = "start ".repeat(30_000) + "MIDDLE_CONSTRAINT_MUST_SURVIVE" + " finish".repeat(30_000);
		sm.appendContextEdit(currentId, { content: task });
		let payload: { input: ResponseItem[] } | undefined;
		let payloadCount = 0;
		const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
		await streamSimple(currentModel, normalizeContext({ messages: convertToLlm(sm.buildSessionProjection().messages) }), {
			apiKey, onPayload: value => { payloadCount++; payload = value as { input: ResponseItem[] }; throw new Error("Stop before network"); },
		}).result();
		expect(payloadCount).toBe(1);
		expect(payload).toBeDefined();
		const requestInput = payload!.input;
		const currentUser = requestInput.findLast((item) => item.role === "user")!;
		expect(JSON.stringify(currentUser.content)).toContain("MIDDLE_CONSTRAINT_MUST_SURVIVE");
		const initialUserCount = requestInput.filter((item) => item.role === "user").length;
		const checkpoints: NativeCompactionDetails[] = [];
		const operations: RemoteCompactionReason[] = [];
		const resolver = vi.fn(resolveFixtureHashes);
		let calls = 0;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolver,
			getBranch: () => sm.getBranch(),
			getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel, input, compactionHashes }) => {
				expect(compactionHashes).toBe(fixtureSnapshot);
				calls++;
				if (calls === 1) expect(input).not.toContainEqual(currentUser);
				return { details: {
					...details(modelKey(selectedModel), `opaque-${calls}`),
					replacementHistory: buildReplacementHistory(input, { type: "compaction", encrypted_content: `opaque-${calls}` }),
				} };
			},
			appendCheckpoint: value => { checkpoints.push(value); sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value); },
			appendCheckpointBypass: () => {},
			shouldAutoCompact: () => true,
			runCompaction: async (_ctx, reason, operation) => { operations.push(reason); return operation(); },
		});
		const ctx = { ...context([oldModel, currentModel]), sessionManager: sm, model: currentModel } as ExtensionContext;
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const conversionSpy = vi.mocked(convertToLlm);
		conversionSpy.mockClear();
		const final = await coordinator.prepareRequest(currentModel, ctx, requestInput);
		expect(resolver).toHaveBeenCalledTimes(1);
		const conversionCount = conversionSpy.mock.calls.length;
		// Checkpoint receipts should not add conversions to the existing view work.
		expect(conversionCount).toBeLessThanOrEqual(historySize === 0 ? 18 : 63);
		expect(calls).toBe(2);
		expect(operations).toEqual(["model-transition", "automatic"]);
		expect(checkpoints).toHaveLength(2);
		expect(checkpoints[0]?.preservedInput).toContainEqual(currentUser);
		if (historySize === 100_000) {
			expect(checkpoints[0]!.replacementHistory.filter((item) => item.role === "user").length
				+ (checkpoints[0]!.preservedInput ?? []).filter((item) => item.role === "user").length).toBeLessThan(initialUserCount);
		}
		expect(checkpoints[1]?.preservedInput).toContainEqual(currentUser);
		const effective = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] });
		expect(effective.filter((item) => item.role === "user" && JSON.stringify(item.content) === JSON.stringify(currentUser.content))).toHaveLength(1);
		expect(effective).toContainEqual(currentUser);
		const subsequent = await createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async () => { throw new Error("Unexpected compaction"); },
			appendCheckpoint: () => {}, appendCheckpointBypass: () => {},
		}).prepareCompaction(currentModel, ctx);
		expect(subsequent.filter((item) => item.role === "user" && JSON.stringify(item.content) === JSON.stringify(currentUser.content))).toHaveLength(1);
		expect(subsequent).toContainEqual(currentUser);
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content) === JSON.stringify(currentUser.content))).toHaveLength(1);
	}, 30_000);

	test("carries an old checkpoint request through a trimmed transition and automatic compaction", async () => {
		const oldModel = model("old", "openai-codex", 1_000_000);
		const currentModel = model("new", "openai-codex", 1_000_000);
		const sm = SessionManager.inMemory(process.cwd());
		for (let index = 0; index < 5; index++) {
			sm.appendMessage({ role: "user", content: `H${index}:` + "h".repeat(99_997), timestamp: index + 1 });
		}
		const currentId = sm.appendMessage({ role: "user", content: "draft", timestamp: 6 });
		sm.appendContextEdit(currentId, { content: "start ".repeat(30_000) + "MIDDLE_CONSTRAINT_MUST_SURVIVE" + " finish".repeat(30_000) });
		const original = effectiveInputForBranch({ branch: sm.getBranch(), model: oldModel, tools: [] });
		const currentUser = original.at(-1)!;
		sm.appendCustomEntry(NATIVE_COMPACTION_KIND, {
			...details(modelKey(oldModel), "old"),
			replacementHistory: [...original.slice(0, -1), { type: "compaction", encrypted_content: "old" }],
			preservedInput: [currentUser],
		});
		const requestInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [], allowCheckpointModelMismatch: true });
		const checkpoints: NativeCompactionDetails[] = [];
		let calls = 0;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel, input }) => {
				calls++;
				return { details: {
					...details(modelKey(selectedModel), `new-${calls}`),
					replacementHistory: buildReplacementHistory(input, { type: "compaction", encrypted_content: `new-${calls}` }),
				} };
			},
			appendCheckpoint: value => { checkpoints.push(value); sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value); },
			appendCheckpointBypass: () => {}, shouldAutoCompact: () => true,
		});
		const ctx = { ...context([oldModel, currentModel]), sessionManager: sm, model: currentModel } as ExtensionContext;
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const final = await coordinator.prepareRequest(currentModel, ctx, requestInput);
		expect(calls).toBe(2);
		expect(checkpoints[0]?.preservedInput).toContainEqual(currentUser);
		expect(checkpoints[0]!.replacementHistory.filter((item) => item.role === "user").length
			+ (checkpoints[0]!.preservedInput ?? []).filter((item) => item.role === "user").length).toBeLessThan(6);
		expect(checkpoints[1]?.preservedInput).toContainEqual(currentUser);
		expect(effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] })).toContainEqual(currentUser);
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content) === JSON.stringify(currentUser.content))).toHaveLength(1);
	});

	test("preserves a new user while recovering a checkpoint with an unavailable previous model", async () => {
		const currentModel = model("new");
		const retiredKey = "openai-codex:openai-codex-responses:gpt-5.5";
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendCustomEntry(NATIVE_COMPACTION_KIND, { ...details(retiredKey, "old"), compHash: "2911" });
		sm.appendMessage({ role: "user", content: "new task", timestamp: 1 });
		const requestInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [], allowCheckpointModelMismatch: true });
		const currentUser = requestInput.at(-1)!;
		let calls = 0;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel, input }) => {
				calls++;
				expect(selectedModel).toEqual(currentModel);
				expect(input).not.toContainEqual(currentUser);
				return { details: details(modelKey(selectedModel), "recovered") };
			},
			appendCheckpoint: value => { sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value); },
			appendCheckpointBypass: () => {}, shouldAutoCompact: () => true,
		});
		const ctx = { ...context([currentModel]), sessionManager: sm, model: currentModel } as ExtensionContext;
		const final = await coordinator.prepareRequest(currentModel, ctx, requestInput);
		expect(calls).toBe(1);
		const checkpoint = findNativeCheckpoint(sm.getBranch(), modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toContainEqual(currentUser);
		expect(effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] })).toContainEqual(currentUser);
		expect(final?.filter((item) => item.role === "user")).toEqual([currentUser]);
	});

	test.each(["clear", "model", "abort", "edit", "new-user"] as const)("rejects a stale automatic result after %s", async (change) => {
		const oldModel = model("old", "openai-codex", 1_000_000);
		const currentModel = model("new", "openai-codex", 1_000_000);
		const otherModel = model("other", "openai-codex", 1_000_000);
		const sm = SessionManager.inMemory(process.cwd());
		const currentId = sm.appendMessage({ role: "user", content: "current task", timestamp: 1 });
		const requestInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] });
		const controller = new AbortController();
		const ctx = { ...context([oldModel, currentModel, otherModel]), sessionManager: sm, model: currentModel, signal: controller.signal } as ExtensionContext;
		let release!: () => void;
		let started!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const ready = new Promise<void>((resolve) => { started = resolve; });
		let calls = 0;
		let appended = 0;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel }) => {
				calls++;
				if (calls === 2) { started(); await gate; }
				return { details: details(modelKey(selectedModel), `opaque-${calls}`) };
			},
			appendCheckpoint: value => { appended++; sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value); },
			appendCheckpointBypass: () => {}, shouldAutoCompact: () => true,
		});
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const pending = coordinator.prepareRequest(currentModel, ctx, requestInput);
		const outcome = pending.then((value) => value, (error: Error) => error);
		await ready;
		if (change === "clear") coordinator.clear();
		if (change === "model") {
			(ctx as unknown as { model: Model<any> }).model = otherModel;
			await coordinator.selectModel({ model: otherModel, previousModel: currentModel }, ctx);
		}
		if (change === "abort") controller.abort(new Error("canceled"));
		if (change === "edit") sm.appendContextEdit(currentId, { content: "revised task" });
		if (change === "new-user") sm.appendMessage({ role: "user", content: "newer task", timestamp: 2 });
		release();
		const result = await outcome;
		if (change === "clear" || change === "model" || change === "abort") expect(result).toBeInstanceOf(Error);
		expect(calls).toBe(2);
		expect(appended).toBe(1);
		const checkpoint = findNativeCheckpoint(sm.getBranch(), modelKey(currentModel));
		if (change === "edit") expect(checkpoint.status).toBe("invalid");
		else expect(checkpoint.status).toBe("valid");
		if (checkpoint.status === "valid") expect(checkpoint.checkpoint.details.preservedInput).toContainEqual(requestInput.at(-1));
	});

	test.each(["remote", "append"] as const)("keeps the first checkpoint when the second %s fails", async (failure) => {
		const oldModel = model("old", "openai-codex", 1_000_000);
		const currentModel = model("new", "openai-codex", 1_000_000);
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "current task", timestamp: 1 });
		const requestInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] });
		let calls = 0;
		let appends = 0;
		let failures = 0;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel }) => {
				calls++;
				if (failure === "remote" && calls === 2) throw new Error("server_error");
				return { details: details(modelKey(selectedModel), `opaque-${calls}`) };
			},
			appendCheckpoint: value => {
				appends++;
				if (failure === "append" && appends === 2) throw new Error("disk error");
				sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value);
			},
			appendCheckpointBypass: () => {}, shouldAutoCompact: () => true,
			onAutomaticCompactionFailure: () => { failures++; },
		});
		const ctx = { ...context([oldModel, currentModel]), sessionManager: sm, model: currentModel } as ExtensionContext;
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const final = await coordinator.prepareRequest(currentModel, ctx, requestInput);
		expect(calls).toBe(2);
		expect(failures).toBe(1);
		const checkpoint = findNativeCheckpoint(sm.getBranch(), modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toContainEqual(requestInput.at(-1));
		expect(final?.filter((item) => item.role === "user")).toEqual([requestInput.at(-1)]);
	});

	test.each(["clear", "model", "abort", "edit", "new-user"] as const)("does not save a stale transition request after %s", async (change) => {
		const oldModel = model("old");
		const currentModel = model("new");
		const otherModel = model("other");
		const sm = SessionManager.inMemory(process.cwd());
		const currentId = sm.appendMessage({ role: "user", content: "old task", timestamp: 1 });
		const requestInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] });
		const controller = new AbortController();
		const ctx = { ...context([oldModel, currentModel, otherModel]), sessionManager: sm, model: currentModel, signal: controller.signal } as ExtensionContext;
		let release!: () => void;
		let started!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const ready = new Promise<void>((resolve) => { started = resolve; });
		let calls = 0;
		const appended: NativeCompactionDetails[] = [];
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel }) => {
				calls++;
				if (calls === 1) { started(); await gate; }
				return { details: details(modelKey(selectedModel), `opaque-${calls}`) };
			},
			appendCheckpoint: value => { appended.push(value); sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value); },
			appendCheckpointBypass: () => {},
		});
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const pending = coordinator.prepareRequest(currentModel, ctx, requestInput);
		const outcome = pending.then((value) => value, (error: Error) => error);
		await ready;
		if (change === "clear") coordinator.clear();
		if (change === "model") {
			(ctx as unknown as { model: Model<any> }).model = otherModel;
			await coordinator.selectModel({ model: otherModel, previousModel: currentModel }, ctx);
		}
		if (change === "abort") controller.abort(new Error("canceled"));
		if (change === "edit") sm.appendContextEdit(currentId, { content: "revised task" });
		if (change === "new-user") sm.appendMessage({ role: "user", content: "new task", timestamp: 2 });
		release();
		const result = await outcome;
		if (change === "clear" || change === "model" || change === "abort") {
			expect(result).toBeInstanceOf(Error);
			expect(appended).toHaveLength(0);
		} else {
			expect(calls).toBeGreaterThan(1);
			expect(appended.every((value) => !(value.preservedInput ?? []).some((item) => JSON.stringify(item.content) === JSON.stringify(requestInput.at(-1)?.content)))).toBe(true);
		}
	});

	test("does not carry a receipt into another public request or a shared transition waiter", async () => {
		const oldModel = model("old", "openai-codex", 1_000_000);
		const currentModel = model("new", "openai-codex", 1_000_000);
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "same", timestamp: 1 });
		const requestInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] });
		let release!: () => void;
		let started!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const ready = new Promise<void>((resolve) => { started = resolve; });
		let calls = 0;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel }) => {
				calls++;
				if (calls === 1) { started(); await gate; }
				return { details: details(modelKey(selectedModel), `opaque-${calls}`) };
			},
			appendCheckpoint: value => { sm.appendCustomEntry(NATIVE_COMPACTION_KIND, value); },
			appendCheckpointBypass: () => {}, shouldAutoCompact: () => true,
		});
		const ctx = { ...context([oldModel, currentModel]), sessionManager: sm, model: currentModel } as ExtensionContext;
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const first = coordinator.prepareRequest(currentModel, ctx, requestInput);
		await ready;
		const waiter = coordinator.prepareRequest(currentModel, ctx, requestInput);
		release();
		const [firstResult, waiterResult] = await Promise.all([first, waiter]);
		expect(calls).toBe(2);
		expect(firstResult?.filter((item) => item.role === "user")).toHaveLength(1);
		expect(waiterResult?.filter((item) => item.role === "user")).toHaveLength(1);
		sm.appendMessage({ role: "user", content: "same", timestamp: 2 });
		const nextInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] });
		const next = await coordinator.prepareRequest(currentModel, ctx, nextInput);
		expect(next?.filter((item) => item.role === "user" && JSON.stringify(item.content).includes("same"))).toHaveLength(2);
	});

	test("does not accept a checkpoint append that reports success without writing", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "current", timestamp: 1 });
		const requestInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] });
		let calls = 0;
		let appends = 0;
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel }) => { calls++; return { details: details(modelKey(selectedModel)) }; },
			appendCheckpoint: () => { appends++; },
			appendCheckpointBypass: () => {}, shouldAutoCompact: () => false,
		});
		const ctx = { ...context([oldModel, currentModel]), sessionManager: sm, model: currentModel } as ExtensionContext;
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		expect(await coordinator.prepareRequest(currentModel, ctx, requestInput)).toBeUndefined();
		expect(calls).toBe(1);
		expect(appends).toBe(1);
		expect(findNativeCheckpoint(sm.getBranch(), modelKey(currentModel)).status).toBe("none");
	});

	test("does not grant request identity when the saved checkpoint differs from the supplied details", async () => {
		const oldModel = model("old", "openai-codex", 1_000_000);
		const currentModel = model("new", "openai-codex", 1_000_000);
		const sm = SessionManager.inMemory(process.cwd());
		for (let index = 0; index < 5; index++) {
			sm.appendMessage({ role: "user", content: `H${index}:` + "h".repeat(99_997), timestamp: index + 1 });
		}
		const currentId = sm.appendMessage({ role: "user", content: "draft", timestamp: 6 });
		sm.appendContextEdit(currentId, { content: "start ".repeat(30_000) + "MIDDLE_CONSTRAINT_MUST_SURVIVE" + " finish".repeat(30_000) });
		const requestInput = effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] });
		const currentUser = requestInput.at(-1)!;
		let calls = 0;
		const saved: NativeCompactionDetails[] = [];
		const coordinator = createSessionCoordinator({ resolveCompactionHashes: resolveFixtureHashes,
			getBranch: () => sm.getBranch(), getAllTools: () => [],
			createCheckpoint: async ({ model: selectedModel, input }) => {
				calls++;
				return { details: {
					...details(modelKey(selectedModel), `opaque-${calls}`),
					replacementHistory: buildReplacementHistory(input, { type: "compaction", encrypted_content: `opaque-${calls}` }),
				} };
			},
			appendCheckpoint: value => {
				const written = saved.length === 0 ? { ...value, preservedInput: [], preservedInputSources: [] } : value;
				saved.push(written);
				sm.appendCustomEntry(NATIVE_COMPACTION_KIND, written);
			},
			appendCheckpointBypass: () => {}, shouldAutoCompact: () => true,
		});
		const ctx = { ...context([oldModel, currentModel]), sessionManager: sm, model: currentModel } as ExtensionContext;
		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, ctx);
		const final = await coordinator.prepareRequest(currentModel, ctx, requestInput);
		expect(calls).toBe(2);
		expect(saved).toHaveLength(2);
		expect(saved[1]?.preservedInput ?? []).not.toContainEqual(currentUser);
		expect(effectiveInputForBranch({ branch: sm.getBranch(), model: currentModel, tools: [] })).not.toContainEqual(currentUser);
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content) === JSON.stringify(currentUser.content))).toHaveLength(1);
	});

	test("does not drop a new user that repeats a preserved user's content", async () => {
		const currentModel = model("old");
		const branch: SessionEntry[] = [customEntry({ ...details(modelKey(currentModel)), preservedInput: [userInput("same")] }), userEntry("same", "current")];
		const coordinator = createCoordinator(branch);

		await expect(coordinator.prepareRequest(currentModel, context([currentModel]), [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
			userInput("same"),
		])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
			userInput("same"),
		]);
	});

	test("keeps a duplicate user after omitted pre-checkpoint history", async () => {
		const currentModel = model("old");
		const branch: SessionEntry[] = [
			userEntry("old"),
			userEntry("same"),
			customEntry({
				...details(modelKey(currentModel)),
				preservedInput: [userInput("same")],
			}),
		];
		const coordinator = createCoordinator(branch);

		await expect(coordinator.prepareRequest(currentModel, context([currentModel]), [
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
			userInput("same"),
		])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "opaque" },
			userInput("same"),
			userInput("same"),
		]);
	});

	test("keeps a new same-text user after a checkpoint preserves the prior turn", async () => {
		const currentModel = model("old");
		const oldUser = { type: "message", id: "old-turn", role: "user", content: [{ type: "input_text", text: "same" }] };
		const newUser = { type: "message", id: "new-turn", role: "user", content: [{ type: "input_text", text: "same" }] };
		const branch: SessionEntry[] = [
			userEntry("same", "old-entry"),
			{
				id: "assistant",
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: { role: "assistant", provider: currentModel.provider, api: currentModel.api, model: currentModel.id, content: [{ type: "text", text: "answer" }] },
			} as never,
			customEntry({
				...details(modelKey(currentModel)),
				replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
				preservedInput: [oldUser],
			}),
		];
		const coordinator = createCoordinator(branch);
		const prefix = effectiveInputForBranch({ branch, model: currentModel, tools: [], allowCheckpointModelMismatch: true });

		const result = await coordinator.prepareRequest(currentModel, context([currentModel]), [...prefix, newUser]);
		expect(result?.at(-1)).toEqual(newUser);
		expect(result?.find((item) => item.id === "new-turn")).toEqual(newUser);
	});

	test("manual compaction does not run model-transition compaction", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const branch: SessionEntry[] = [userEntry("history")];
		const compactedWith: string[] = [];
		const coordinator = createCoordinator(branch, async (selectedModel) => {
			compactedWith.push(modelKey(selectedModel));
			return details(modelKey(selectedModel), "transition");
		});

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		await expect(coordinator.prepareCompaction(currentModel, context([oldModel, currentModel]))).resolves.toEqual([userInput("history")]);
		expect(compactedWith).toEqual([]);
	});

	test("manual compaction still honors cancellation", async () => {
		const currentModel = model("current");
		const controller = new AbortController();
		controller.abort(new Error("canceled"));
		const coordinator = createCoordinator([userEntry("history")]);

		await expect(coordinator.prepareCompaction(
			currentModel,
			context([currentModel]),
			false,
			controller.signal,
		)).rejects.toThrow("canceled");
	});

	test("runs automatic compaction before the provider request", async () => {
		const currentModel = model("old");
		const branch: SessionEntry[] = [userEntry("history")];
		let compactedInput: ResponseItem[] | undefined;
		const coordinator = createCoordinator(
			branch,
			async (_selectedModel, input) => {
				compactedInput = input;
				return details(modelKey(currentModel), "automatic");
			},
			() => true,
		);

		const input = await coordinator.prepareRequest(currentModel, context([currentModel]), [userInput("history"), userInput("new")]);
		expect(compactedInput).toEqual([userInput("history")]);
		expect(input).toEqual([{ type: "compaction", encrypted_content: "automatic" }, userInput("new")]);
	});

	test.each([100_000, 1])("allows a provider attempt after automatic compaction fails with estimated window %i", async (window) => {
		const currentModel = model("old", "openai-codex", window);
		const branch: SessionEntry[] = [userEntry("history")];
		let failures = 0;
		const coordinator = createCoordinator(
			branch,
			async () => {
				throw new Error("server_error");
			},
			() => true,
			undefined,
			() => failures++,
		);

		await expect(coordinator.prepareRequest(currentModel, context([currentModel]), [userInput("history"), userInput("new")])).resolves.toBeUndefined();
		expect(failures).toBe(1);
		expect(branch.filter((entry) => entry.type === "custom" && entry.customType === NATIVE_COMPACTION_BYPASS_KIND)).toHaveLength(0);
	});

	test("preserves a duplicate current user during automatic compaction", async () => {
		const currentModel = model("old");
		const branch: SessionEntry[] = [userEntry("same", "old-entry")];
		const oldUser = { type: "message", id: "old-turn", role: "user", content: [{ type: "input_text", text: "same" }] };
		const coordinator = createCoordinator(
			branch,
			async (_selectedModel, input) => {
				expect(input).toEqual([userInput("same")]);
				return {
					...details(modelKey(currentModel), "automatic"),
					replacementHistory: [oldUser, { type: "compaction", encrypted_content: "automatic" }],
				};
			},
			() => true,
		);

		const input = await coordinator.prepareRequest(currentModel, context([currentModel]), [userInput("same"), userInput("same")]);
		expect(input?.filter((item) => item.role === "user")).toEqual([oldUser, userInput("same")]);
	});

	test("presents separate transition and automatic compactions", async () => {
		const oldModel = model("old");
		const currentModel = model("new");
		const branch: SessionEntry[] = [userEntry("current")];
		let calls = 0;
		const operations: RemoteCompactionReason[] = [];
		const coordinator = createCoordinator(
			branch,
			async (selectedModel, input) => {
				calls++;
				if (calls === 1) {
					expect(selectedModel).toBe(oldModel);
					expect(input).toEqual([]);
					return details(modelKey(oldModel), "transition");
				}
				expect(selectedModel).toEqual(currentModel);
				expect(input).toEqual([{ type: "compaction", encrypted_content: "transition" }, userInput("current")]);
				return {
					...details(modelKey(currentModel), "automatic"),
					replacementHistory: [userInput("current"), { type: "compaction", encrypted_content: "automatic" }],
				};
			},
			() => true,
			(reason) => operations.push(reason),
		);

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		const input = await coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("current")]);

		expect(calls).toBe(2);
		expect(operations).toEqual(["model-transition", "automatic"]);
		expect(input?.filter((item) => item.role === "user")).toEqual([userInput("current")]);
	});

	test("uses the current model for a persisted known hash when the old model is unavailable", async () => {
		const currentModel = model("new");
		const retiredKey = "openai-codex:openai-codex-responses:gpt-5.5";
		const branch: SessionEntry[] = [customEntry({ ...details(retiredKey), compHash: "2911" })];
		let usedModel: string | undefined;
		const coordinator = createCoordinator(branch, async (selectedModel) => {
			usedModel = modelKey(selectedModel);
			return details(modelKey(selectedModel), "recovered");
		});

		await coordinator.recoverCurrentModel(currentModel, context([currentModel]));
		expect(usedModel).toBe(modelKey(currentModel));
	});

});
