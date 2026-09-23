import { fixtureSnapshot, resolveFixtureHashes } from "./fixtures/compaction-metadata.js";
import { describe, expect, test, vi } from "vitest";
import { convertToLlm, SessionManager, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import type { Model } from "@earendil-works/pi-ai";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, convertToLlm: vi.fn(actual.convertToLlm) };
});
import { createSessionCoordinator, type RemoteCompactionReason } from "../src/session-coordinator.js";
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
	} as unknown as SessionEntry;
}

function userEntry(text: string, id = "user"): SessionEntry {
	return {
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
		type: "message",
		message: { role: "user", content: [{ type: "text", text }] },
	} as unknown as SessionEntry;
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
	test.each([true, false])("uses Pi's newest ordinary summary after model selection, overlap: %s", async (overlap) => {
		const currentModel = getBuiltinModel("openai-codex", "gpt-5.6-sol")!;
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
		await streamSimple(currentModel, { messages: convertToLlm(sm.buildSessionProjection().messages) }, {
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
		const branch = [userEntry("same", "history"), userEntry("same", "branch-current")];
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
		const currentModel = getBuiltinModel("openai-codex", "gpt-5.6-sol")!;
		const sm = SessionManager.inMemory(process.cwd());
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
		expect(checkpoint.checkpoint.details.preservedInput).toEqual([requestInput[0]]);
		expect(final?.filter((item) => item.role === "user")).toEqual([requestInput[0]]);
		expect(JSON.stringify(final)).toContain("input_image");
	});
	test("does not append a checkpoint after a new edit arrives during automatic compaction", async () => {
		const currentModel = model("new", "openai-codex", 1_000_000);
		const sm = SessionManager.inMemory(process.cwd());
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
	test("does not treat a later custom message as an unanswered branch user", async () => {
		const currentModel = model("new");
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "earlier user", timestamp: 1 });
		sm.appendCustomMessageEntry("note", "later custom", false);
		const branch = sm.getBranch();
		const requestInput = effectiveInputForBranch({ branch, model: currentModel, tools: [] });
		const seen: ResponseItem[][] = [];
		const coordinator = createCoordinator(branch, async (_selected, input) => {
			seen.push(input);
			return details(modelKey(currentModel));
		}, () => true);
		await coordinator.prepareRequest(currentModel, context([currentModel]), requestInput);
		expect(seen[0]).toEqual(requestInput);
		const checkpoint = findNativeCheckpoint(branch, modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toBeUndefined();
	});
	test("invalidates an old transition before retrying or committing after model selection", async () => {
		const old = model("old"), target = model("new"), next = model("other");
		const branch = [customEntry(details(modelKey(old))), userEntry("continue")];
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
		const branch = [customEntry(details(modelKey(currentModel))), userEntry(secret, "failed-user")];
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
		const branch = [
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
		const branch = [
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
		const branch = [
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
		const branch = [
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
		const branch = [
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
		const branch = [customEntry(details(modelKey(currentModel))), userEntry("failed", "failed-user")];
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
		const branch = [
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
		const branch = [{
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

		const input = await coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")]);

		expect(compactedWith).toEqual([modelKey(oldModel)]);
		expect(input).toEqual([{ type: "compaction", encrypted_content: "resumed" }, userInput("hello")]);
	});

	test("compacts on a context-window downshift only at the auto limit", async () => {
		const oldModel = model("old", "openai-codex", 200_000);
		const currentModel = model("other", "openai-codex", 100_000);
		let calls = 0;
		let thresholdChecks = 0;
		const coordinator = createCoordinator([], async (selectedModel) => {
			calls++;
			return details(modelKey(selectedModel), "downshift");
		}, () => thresholdChecks++ === 0);

		await coordinator.selectModel({ model: currentModel, previousModel: oldModel }, context([oldModel, currentModel]));
		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("hello")])).resolves.toEqual([
			{ type: "compaction", encrypted_content: "downshift" },
			userInput("hello"),
		]);
		expect(calls).toBe(1);
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
		const branch = [
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
		const branch = [
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
		const branch = [
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
		const branch = [
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
		const branch = [
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
		const branch = [
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
		const branch = [customEntry({ ...details(modelKey(oldModel)), compHash: "2911" })];
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
		const branch = [userEntry("early constraint".repeat(100), "old"), userEntry("latest task", "new")];
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
		const branch = [userEntry(oldText, "old"), userEntry(newText, "new")];
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
		const branch = [customEntry(details(modelKey(oldModel)))];
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
		const branch = [
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
		const branch = [
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
		const branch = [userEntry("current")];
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
		const branch = [customEntry({ ...details(modelKey(oldModel), "old"), preservedInput: [fullUser] })];
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
		const coordinator = createCoordinator(branch, async (selectedModel, input) => {
			calls++;
			if (calls === 1) {
				expect(selectedModel).toBe(oldModel);
				expect(input).toEqual([]);
			} else {
				expect(selectedModel).toBe(currentModel);
				expect(input.filter((item) => item.role === "user")).toEqual([requestInput[0]]);
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
		const checkpoint = findNativeCheckpoint(branch, modelKey(currentModel));
		expect(checkpoint.status).toBe("valid");
		if (checkpoint.status !== "valid") return;
		expect(checkpoint.checkpoint.details.preservedInput).toEqual([requestInput[0]]);
		expect(final?.filter((item) => item.role === "user" && JSON.stringify(item.content).includes("MIDDLE_CONSTRAINT_MUST_SURVIVE"))).toEqual([requestInput[0]]);
	});

	test.each([0, 100, 100_000])("persists the edited request through two compactions with history size %i", async (historySize) => {
		const oldModel = { ...getBuiltinModel("openai-codex", "gpt-5.5")!, contextWindow: 1_000_000 };
		const currentModel = { ...getBuiltinModel("openai-codex", "gpt-5.6-sol")!, contextWindow: 1_000_000 };
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
		await streamSimple(currentModel, { messages: convertToLlm(sm.buildSessionProjection().messages) }, {
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
				expect(selectedModel).toBe(currentModel);
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
				const written = saved.length === 0 ? { ...value, preservedInput: [] } : value;
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
		const branch = [customEntry({ ...details(modelKey(currentModel)), preservedInput: [userInput("same")] }), userEntry("same", "current")];
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
		const branch = [
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
		const branch = [
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
		const branch = [userEntry("history")];
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
		const branch = [userEntry("history")];
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

	test("continues an in-window request after automatic compaction fails", async () => {
		const currentModel = model("old");
		const branch = [userEntry("history")];
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
		const branch = [userEntry("same", "old-entry")];
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
		const branch = [userEntry("current")];
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
				expect(selectedModel).toBe(currentModel);
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
		const branch = [customEntry({ ...details(retiredKey), compHash: "2911" })];
		let usedModel: string | undefined;
		const coordinator = createCoordinator(branch, async (selectedModel) => {
			usedModel = modelKey(selectedModel);
			return details(modelKey(selectedModel), "recovered");
		});

		await coordinator.recoverCurrentModel(currentModel, context([currentModel]));
		expect(usedModel).toBe(modelKey(currentModel));
	});

});
