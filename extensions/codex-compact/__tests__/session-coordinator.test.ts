import { describe, expect, test } from "vitest";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { createSessionCoordinator, type RemoteCompactionReason } from "../src/session-coordinator.js";
import {
	effectiveInputForBranch,
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
	return createSessionCoordinator({
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

		await expect(coordinator.prepareRequest(currentModel, context([oldModel, currentModel]), [userInput("different")])).rejects.toThrow("request changed");
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
