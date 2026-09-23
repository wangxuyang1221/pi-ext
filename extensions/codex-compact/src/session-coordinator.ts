import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { compactionHash } from "./capabilities.js";
import { effectiveContextWindow, loadConfig } from "./config.js";
import {
	HistoryPrefixMismatchError,
	FAILED_REQUEST_KIND,
	NATIVE_COMPACTION_BYPASS_KIND,
	NATIVE_COMPACTION_BYPASS_VERSION,
	createBranchInputSnapshot,
	effectiveInputForBranch,
	findNativeCheckpoint,
	toolsWithRequestFormats,
	isContextWindowCompactionError,
	isFailClosedCompactionError,
	isOpenAICodexModel,
	isJsonObject,
	modelKey,
	approximateCompactionRequestTokens,
	type FailedRequestDetails,
	type FailedRequestDiagnostics,
	type JsonObject,
	type NativeCompactionBypass,
	type NativeCompactionDetails,
	type CheckpointLookup,
	type ResponseItem,
} from "./native-compaction.js";

export type ModelSelectLike = {
	model: Model<any>;
	previousModel?: Model<any>;
};

export type RemoteCompactionReason = "manual" | "automatic" | "model-transition" | "context-recovery";

export type CheckpointFactory = (params: {
	ctx: ExtensionContext;
	model: Model<any>;
	input: ReturnType<typeof effectiveInputForBranch>;
	basePayload?: JsonObject;
	signal?: AbortSignal;
}) => Promise<{ details: NativeCompactionDetails }>;

export type SessionCoordinatorDeps = {
	getBranch: (ctx: ExtensionContext) => SessionEntry[];
	getAllTools: () => Parameters<typeof effectiveInputForBranch>[0]["tools"];
	createCheckpoint: CheckpointFactory;
	appendCheckpoint: (details: NativeCompactionDetails) => void;
	appendCheckpointBypass: (bypass: NativeCompactionBypass) => void;
	appendFailedRequest?: (details: FailedRequestDetails) => void;
	onAutomaticCompactionFailure?: (ctx: ExtensionContext, error: unknown) => void;
	shouldAutoCompact?: (params: {
		ctx: ExtensionContext;
		model: Model<any>;
		input: ResponseItem[];
		reason?: "automatic" | "downshift";
	}) => boolean;
	runCompaction?: <T>(
		ctx: ExtensionContext,
		reason: RemoteCompactionReason,
		operation: () => Promise<T>,
	) => Promise<T>;
};

type PendingTransition = {
	previousModel: Model<any>;
	targetModelKey: string;
	reason: "hash" | "downshift";
};

type ActiveFailedRequest = FailedRequestDetails & {
	markerIndex: number;
	hasBranchUser: boolean;
	hasNewerUser: boolean;
};

function isModelDownshift(previousModel: Model<any>, currentModel: Model<any>): boolean {
	return modelKey(previousModel) !== modelKey(currentModel)
		&& typeof previousModel.contextWindow === "number"
		&& typeof currentModel.contextWindow === "number"
		&& previousModel.contextWindow > currentModel.contextWindow;
}

function hashesDiffer(previousHash: string | undefined, currentHash: string | undefined): boolean {
	return previousHash !== undefined && currentHash !== undefined && previousHash !== currentHash;
}

function needsTransitionCompaction(previousModel: Model<any>, currentModel: Model<any>): boolean {
	return hashesDiffer(compactionHash(previousModel), compactionHash(currentModel));
}

function shouldRetryWithCurrentModel(error: unknown): boolean {
	if (typeof error === "object" && error !== null && "retryWithCurrentModel" in error) {
		return (error as { retryWithCurrentModel?: unknown }).retryWithCurrentModel === true;
	}
	const message = error instanceof Error ? error.message : String(error);
	if (isFailClosedCompactionError(message) || /(?:auth|account|invalid compaction)/i.test(message)) return false;
	return /(?:\b(?:400|403|408|409|429|5\d\d)\b|invalid request|unexpected status|context window|context_length_exceeded|invalid_prompt|usage limit|server overloaded|internal server|retry limit)/i.test(message);
}

function fitsContextWindow(
	ctx: ExtensionContext,
	model: Model<any>,
	input: ResponseItem[],
	basePayload: JsonObject | undefined,
	tools: unknown[],
): boolean {
	return approximateCompactionRequestTokens({
		input,
		instructions: typeof basePayload?.instructions === "string" ? basePayload.instructions : ctx.getSystemPrompt(),
		tools: Array.isArray(basePayload?.tools) ? basePayload.tools : tools,
	}) <= effectiveContextWindow(loadConfig(ctx.cwd ?? "", ctx.isProjectTrusted?.() ?? false), model.contextWindow);
}

function conversationLeafId(branch: SessionEntry[]): string | undefined {
	return branch.findLast((entry) => entry.type !== "custom")?.id;
}

function isRealUserEntry(entry: SessionEntry): entry is Extract<SessionEntry, { type: "message" }> {
	return entry.type === "message" && entry.message.role === "user";
}

function isSuccessfulAssistantEntry(entry: SessionEntry): boolean {
	return entry.type === "message"
		&& entry.message.role === "assistant"
		&& entry.message.stopReason !== "error"
		&& entry.message.stopReason !== "aborted";
}

function activeFailedRequests(branch: SessionEntry[]): ActiveFailedRequest[] {
	let lastSuccessfulAssistantIndex = -1;
	for (let index = 0; index < branch.length; index++) {
		if (isSuccessfulAssistantEntry(branch[index]!)) lastSuccessfulAssistantIndex = index;
	}

	const byEntryId = new Map<string, ActiveFailedRequest>();
	for (let index = lastSuccessfulAssistantIndex + 1; index < branch.length; index++) {
		const entry = branch[index];
		if (entry?.type !== "custom" || entry.customType !== FAILED_REQUEST_KIND || !isJsonObject(entry.data)) continue;
		const data = entry.data;
		if (data.kind !== FAILED_REQUEST_KIND || typeof data.entryId !== "string") continue;
		let referencedUser: Extract<SessionEntry, { type: "message" }> | undefined;
		const referencedIndex = branch.findIndex((candidate) => candidate.id === data.entryId);
		if (referencedIndex >= 0) {
			const referencedEntry = branch[referencedIndex];
			if (!referencedEntry || !isRealUserEntry(referencedEntry) || referencedIndex <= lastSuccessfulAssistantIndex || referencedIndex >= index) continue;
			referencedUser = referencedEntry;
		}
		byEntryId.set(data.entryId, {
			kind: FAILED_REQUEST_KIND,
			entryId: data.entryId,
			markerIndex: index,
			hasBranchUser: referencedUser !== undefined,
			hasNewerUser: branch.slice(index + 1).some(isRealUserEntry),
			...(referencedUser
				? { content: structuredClone(messageContent(referencedUser)) }
				: data.content !== undefined ? { content: structuredClone(data.content) } : {}),
		});
	}
	return [...byEntryId.values()].sort((left, right) => left.markerIndex - right.markerIndex);
}

function branchWithoutFailedRequests(branch: SessionEntry[], failed: ActiveFailedRequest[]): SessionEntry[] {
	const failedUserIds = new Set(failed.filter((request) => request.hasBranchUser).map((request) => request.entryId));
	return failedUserIds.size === 0 ? branch : branch.filter((entry) => !failedUserIds.has(entry.id));
}

function sameFailedRequestContent(left: unknown, right: unknown): boolean {
	return isDeepStrictEqual(left, right) || textContent(left) === textContent(right);
}

function requestInputWithoutFailedRequests(
	requestInput: ResponseItem[] | undefined,
	failed: ActiveFailedRequest[],
): ResponseItem[] | undefined {
	if (!requestInput || failed.length === 0) return requestInput;
	const lastUserIndex = requestInput.findLastIndex((item) => item.role === "user");
	if (lastUserIndex < 0) return requestInput;
	const latest = failed.at(-1);
	const latestIsReusedEntry = latest !== undefined
		&& !latest.hasNewerUser
		&& latest.content !== undefined
		&& sameFailedRequestContent(requestInput[lastUserIndex]?.content, latest.content);
	const stale = failed.filter((request) => request !== latest || !latestIsReusedEntry).reverse();
	const matchedIndices = new Set<number>();
	for (const request of stale) {
		if (request.content === undefined) continue;
		const failedIndex = requestInput.findLastIndex((item, index) =>
			index < lastUserIndex
			&& !matchedIndices.has(index)
			&& item.role === "user"
			&& sameFailedRequestContent(item.content, request.content),
		);
		if (failedIndex >= 0) matchedIndices.add(failedIndex);
	}
	return matchedIndices.size === 0
		? requestInput
		: requestInput.filter((_item, index) => !matchedIndices.has(index));
}

function hasBranchTailAfterCheckpoint(branch: SessionEntry[], checkpoint: CheckpointLookup, excludeEntryId?: string): boolean {
	return checkpoint.status !== "valid"
		|| branch.slice(checkpoint.checkpoint.entryIndex + 1).some((entry) => entry.id !== excludeEntryId && isContextEntry(entry));
}

function textContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(textContent).join("");
	if (!isJsonObject(value)) return "";
	if (value.type === "image") {
		return `[image:${typeof value.mimeType === "string" ? value.mimeType : ""}:${typeof value.data === "string" ? value.data : ""}]`;
	}
	if (value.type === "input_image" || value.type === "image_url") {
		const url = typeof value.image_url === "string" ? value.image_url : "";
		const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
		return match ? `[image:${match[1]}:${match[2]}]` : `[image-url:${url}]`;
	}
	if (typeof value.text === "string") return value.text;
	return Object.values(value).map(textContent).join("");
}

function messageContent(entry: Extract<SessionEntry, { type: "message" }>): unknown {
	return (entry.message as unknown as JsonObject).content;
}

function isContextEntry(entry: SessionEntry): boolean {
	return entry.type === "message" || entry.type === "custom_message";
}

type CurrentRequest =
	| { kind: "branch"; entryId: string; requestIndex: number; item: ResponseItem }
	| { kind: "checkpoint"; requestIndex: number; item: ResponseItem }
	| undefined;

function resolveCurrentRequest(
	snapshot: ReturnType<typeof createBranchInputSnapshot>,
	requestInput: ResponseItem[] | undefined,
	historyModel: Model<any>,
	currentModel: Model<any>,
	systemPromptInput: ResponseItem[],
): CurrentRequest {
	if (!requestInput) return undefined;
	const requestIndex = requestInput.findLastIndex((item) => item.role === "user");
	if (requestIndex < 0) return undefined;
	const branch = snapshot.projection.branch as SessionEntry[];
	const candidateIndex = branch.findLastIndex((entry) => entry.type === "message" && entry.message.role === "user");
	const candidate = candidateIndex < 0 ? undefined : branch[candidateIndex];
	const eligible = candidate && candidate.type === "message" && !branch.slice(candidateIndex + 1).some(isContextEntry);
	const models = isDeepStrictEqual(historyModel, currentModel) ? [historyModel] : [historyModel, currentModel];
	const matches = new Set<string>();
	if (eligible) {
		for (const selectedModel of models) {
			for (const kind of ["effective", "pi-context", "full-history"] as const) {
				const view = snapshot.view(selectedModel, kind, { allowCheckpointModelMismatch: true });
				for (const offset of systemPromptInput.length > 0 ? [0, systemPromptInput.length] : [0]) {
					const prefix = offset === 0 ? view.items : [...systemPromptInput, ...view.items];
					if (prefix.length > requestInput.length || !prefix.every((item, index) => isDeepStrictEqual(item, requestInput[index]))) continue;
					const sourceIndex = requestIndex - offset;
					const source = view.userSources.get(sourceIndex);
					if (source) matches.add(source);
				}
			}
		}
	}
	if (eligible && matches.size === 1 && matches.has(candidate!.id)) {
		const lookup = snapshot.checkpoint(currentModel);
		if (lookup.status !== "valid" || candidateIndex > lookup.checkpoint.entryIndex) {
			return { kind: "branch", entryId: candidate!.id, requestIndex, item: requestInput[requestIndex]! };
		}
	}
	if (matches.size > 1) return undefined;
	if (checkpointPreservedCurrentUser(branch, requestInput, modelKey(currentModel), snapshot.checkpoint(currentModel))) {
		return { kind: "checkpoint", requestIndex, item: requestInput[requestIndex]! };
	}
	return undefined;
}

function inputViews(snapshot: ReturnType<typeof createBranchInputSnapshot>, model: Model<any>, excludeEntryId?: string) {
	const options = { excludeEntryId, allowCheckpointModelMismatch: true };
	return {
		effective: snapshot.view(model, "effective", options),
		piContext: snapshot.view(model, "pi-context", options),
		fullHistory: snapshot.view(model, "full-history", options),
	};
}

function systemPromptItems(ctx: ExtensionContext, model: Model<any>): ResponseItem[] {
	const prompt = ctx.getSystemPrompt();
	const supportsDeveloperRole = (model.compat as { supportsDeveloperRole?: boolean } | undefined)?.supportsDeveloperRole;
	return prompt ? [{ role: model.reasoning && supportsDeveloperRole !== false ? "developer" : "system", content: prompt }] : [];
}

function checkpointPreservedCurrentUser(branch: SessionEntry[], requestInput: ResponseItem[] | undefined, targetModelKey: string, lookup?: CheckpointLookup): ResponseItem | undefined {
	const checkpoint = lookup ?? findNativeCheckpoint(branch, targetModelKey);
	if (checkpoint.status !== "valid" || branch.slice(checkpoint.checkpoint.entryIndex + 1).some(isContextEntry)) return undefined;
	const checkpointUsers = [
		...checkpoint.checkpoint.details.replacementHistory,
		...(checkpoint.checkpoint.details.preservedInput ?? []),
	].filter((item) => item.role === "user");
	const requestUserCount = requestInput?.filter((item) => item.role === "user").length ?? 0;
	if (requestUserCount > checkpointUsers.length) return undefined;
	const requestUser = requestInput?.findLast((item) => item.role === "user");
	const checkpointUser = checkpointUsers.findLast((item) => item.role === "user");
	return requestUser && checkpointUser && isDeepStrictEqual(checkpointUser.content, requestUser.content) ? checkpointUser : undefined;
}

function preserveCurrentUser(
	details: NativeCompactionDetails,
	currentRequest: CurrentRequest,
): NativeCompactionDetails {
	if (!currentRequest) return details;
	if (currentRequest.kind === "branch") return appendPreservedInput(details, [currentRequest.item]);
	const existing = [...details.replacementHistory, ...(details.preservedInput ?? [])];
	return existing.some((item) => item.role === "user"
		&& sameUserOccurrence(item, currentRequest.item)
		&& isDeepStrictEqual(item.content, currentRequest.item.content))
		? details
		: appendPreservedInput(details, [currentRequest.item]);
}

function rebindCheckpoint(details: NativeCompactionDetails, modelKeyValue: string, compHash: string | undefined): NativeCompactionDetails {
	const { compHash: _previousHash, ...withoutHash } = details;
	return {
		...withoutHash,
		modelKey: modelKeyValue,
		...(compHash ? { compHash } : {}),
	};
}

function withoutLastUser(items: ResponseItem[]): ResponseItem[] {
	const lastUserIndex = items.findLastIndex((item) => item.role === "user");
	return lastUserIndex < 0 ? items : items.filter((_item, index) => index !== lastUserIndex);
}

function preserveRequestUser(details: NativeCompactionDetails, requestInput: ResponseItem[]): NativeCompactionDetails {
	const requestUser = requestInput.findLast((item) => item.role === "user");
	return requestUser ? appendPreservedInput(details, [requestUser]) : details;
}

function appendPreservedInput(details: NativeCompactionDetails, input: ResponseItem[]): NativeCompactionDetails {
	return {
		...details,
		preservedInput: [...(details.preservedInput ?? []), ...input.map((item) => structuredClone(item))],
	};
}

function ensureNotAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new Error("Compaction aborted.");
}

function sameUserOccurrence(left: ResponseItem, right: ResponseItem): boolean {
	const leftId = typeof left.id === "string" ? left.id : undefined;
	const rightId = typeof right.id === "string" ? right.id : undefined;
	if (leftId !== undefined || rightId !== undefined) return leftId !== undefined && leftId === rightId;
	return isDeepStrictEqual(left.content, right.content);
}

function requestTail(
	requestInput: ResponseItem[] | undefined,
	prefixes: ResponseItem[][],
	systemPromptInput: ResponseItem[],
): ResponseItem[] {
	if (!requestInput) return [];
	const candidates = prefixes.flatMap((value) => systemPromptInput.length > 0 ? [value, [...systemPromptInput, ...value]] : [value]);
	let longestMatch = 0;
	for (const prefix of candidates) {
		let matched = 0;
		while (matched < prefix.length && matched < requestInput.length && isDeepStrictEqual(prefix[matched], requestInput[matched])) matched++;
		longestMatch = Math.max(longestMatch, matched);
		if (matched === prefix.length) {
			return requestInput.slice(prefix.length);
		}
	}
	throw new HistoryPrefixMismatchError(longestMatch);
}

function resolveModel(ctx: ExtensionContext, key: string): Model<any> | undefined {
	const parts = key.split(":");
	if (parts.length < 3) return undefined;
	const model = ctx.modelRegistry.find(parts[0]!, parts.slice(2).join(":"));
	return model && modelKey(model) === key ? model : undefined;
}

function pendingTransitionFromBranch(
	branch: SessionEntry[],
	currentModel: Model<any>,
	ctx: ExtensionContext,
): PendingTransition | undefined {
	const selectedIndex = branch.findLastIndex((entry) =>
		entry.type === "model_change" && entry.provider === currentModel.provider && entry.modelId === currentModel.id,
	);
	const historyEnd = selectedIndex >= 0 ? selectedIndex : branch.length;
	if (selectedIndex >= 0 && branch.slice(selectedIndex + 1).some((entry) => entry.type === "message" && entry.message.role === "assistant")) return undefined;
	const previousAssistant = branch.slice(0, historyEnd).findLast((entry) => {
		if (entry.type !== "message") return false;
		const message = entry.message as unknown as JsonObject;
		return message.role === "assistant"
			&& typeof message.provider === "string"
			&& typeof message.api === "string"
			&& typeof message.model === "string";
	});
	if (!previousAssistant || previousAssistant.type !== "message") return undefined;
	const previousMessage = previousAssistant.message as unknown as JsonObject;
	const previousModel = resolveModel(ctx, modelKey({
		provider: previousMessage.provider as string,
		api: previousMessage.api as string,
		id: previousMessage.model as string,
	}));
	if (!previousModel || !isOpenAICodexModel(previousModel)) return undefined;
	const hashTransition = needsTransitionCompaction(previousModel, currentModel);
	if (!hashTransition && !isModelDownshift(previousModel, currentModel)) return undefined;
	return {
		previousModel,
		targetModelKey: modelKey(currentModel),
		reason: hashTransition ? "hash" : "downshift",
	};
}

export function createSessionCoordinator(deps: SessionCoordinatorDeps) {
	const rawGetBranch = deps.getBranch;
	deps = {
		...deps,
		getBranch: (ctx) => {
			const branch = rawGetBranch(ctx);
			return branchWithoutFailedRequests(branch, activeFailedRequests(branch));
		}
	};
	const runRemoteCompaction = <T>(
		ctx: ExtensionContext,
		reason: RemoteCompactionReason,
		operation: () => Promise<T>,
	): Promise<T> => deps.runCompaction?.(ctx, reason, operation) ?? operation();
	const pendingBySession = new Map<string, PendingTransition>();
	const transitionBySession = new Map<string, Promise<void>>();
	const automaticCompactionBySession = new Map<string, Promise<void>>();
	let generation = 0;
	const ensureCurrent = (ctx: ExtensionContext, targetModelKey: string, startGeneration: number, signal?: AbortSignal): void => {
		ensureNotAborted(signal);
		if (generation !== startGeneration || (ctx.model && modelKey(ctx.model) !== targetModelKey)) {
			throw new Error("The session changed while Codex model-transition compaction was running.");
		}
	};

	const clear = (): void => {
		generation++;
		pendingBySession.clear();
		transitionBySession.clear();
		automaticCompactionBySession.clear();
	};

	const recordFailedRequest = (
		ctx: ExtensionContext,
		requestInput: ResponseItem[] | undefined,
		diagnostics?: FailedRequestDiagnostics,
	): void => {
		const requestUser = requestInput?.findLast((item) => item.role === "user");
		if (!requestUser) return;
		const latestModelVisible = rawGetBranch(ctx).findLast((entry) =>
			entry.type === "message" || entry.type === "custom_message",
		);
		if (!latestModelVisible || !isRealUserEntry(latestModelVisible)) return;
		if (!sameFailedRequestContent(messageContent(latestModelVisible), requestUser.content)) return;
		deps.appendFailedRequest?.({
			kind: FAILED_REQUEST_KIND,
			entryId: latestModelVisible.id,
			...(diagnostics ? { diagnostics: structuredClone(diagnostics) } : {}),
		});
	};

	const bypassFailedGate = (
		ctx: ExtensionContext,
		model: Model<any>,
		gateEntryId: string | undefined,
		startGeneration: number,
		leafId: string | undefined,
	): void => {
		if (ctx.signal?.aborted || generation !== startGeneration
			|| (ctx.model && modelKey(ctx.model) !== modelKey(model))
			|| conversationLeafId(deps.getBranch(ctx)) !== leafId) return;
		pendingBySession.delete(ctx.sessionManager.getSessionId());
		if (!gateEntryId) return;
		try {
			deps.appendCheckpointBypass({
				kind: NATIVE_COMPACTION_BYPASS_KIND,
				version: NATIVE_COMPACTION_BYPASS_VERSION,
				gateEntryId,
				targetModelKey: modelKey(model),
			});
		} catch {}
	};

	const runTransition = async (
		sessionId: string,
		ctx: ExtensionContext,
		previousModel: Model<any>,
		targetModelKey: string,
		currentModel: Model<any>,
		basePayload: JsonObject | undefined,
		startGeneration: number,
		requestInput: ResponseItem[] | undefined,
		excludeLastAssistantError = false,
		signal?: AbortSignal,
	): Promise<void> => {
		const operationSignal = signal ?? ctx.signal;
		for (let attempt = 0; attempt < 3; attempt++) {
			ensureCurrent(ctx, targetModelKey, startGeneration, operationSignal);
			const branch = deps.getBranch(ctx);
			const leafId = conversationLeafId(branch);
			const snapshot = createBranchInputSnapshot({ branch, tools: toolsWithRequestFormats(deps.getAllTools(), basePayload, requestInput) });
			const currentRequest = resolveCurrentRequest(snapshot, requestInput, previousModel, currentModel, systemPromptItems(ctx, currentModel));
			const options = { excludeEntryId: currentRequest?.kind === "branch" ? currentRequest.entryId : undefined, allowCheckpointModelMismatch: true, excludeLastAssistantError };
			const input = snapshot.view(previousModel, "effective", options).items;
			let native: Awaited<ReturnType<CheckpointFactory>>;
			try {
				native = await deps.createCheckpoint({
					ctx,
					model: previousModel,
					input,
					basePayload,
					signal: operationSignal,
				});
			} catch (firstError) {
				ensureCurrent(ctx, targetModelKey, startGeneration, operationSignal);
				if (
					(modelKey(currentModel) === modelKey(previousModel) && compactionHash(currentModel) === compactionHash(previousModel))
					|| !shouldRetryWithCurrentModel(firstError)
				) throw firstError;
				try {
					native = await deps.createCheckpoint({
						ctx,
						model: currentModel,
						input: snapshot.view(currentModel, "effective", options).items,
						basePayload,
						signal: operationSignal,
					});
				} catch (fallbackError) {
					throw fallbackError;
				}
			}
			ensureCurrent(ctx, targetModelKey, startGeneration, operationSignal);
			if (conversationLeafId(deps.getBranch(ctx)) !== leafId) continue;
			deps.appendCheckpoint(rebindCheckpoint(
				preserveCurrentUser(native.details, currentRequest),
				targetModelKey,
				compactionHash(currentModel),
			));
			pendingBySession.delete(sessionId);
			return;
		}
		throw new Error("The session changed while Codex model-transition compaction was running.");
	};

	const recoverCurrentModel = async (
		model: Model<any>,
		ctx: ExtensionContext,
		basePayload?: JsonObject,
		requestInput?: ResponseItem[],
		excludeLastAssistantError = false,
		signal?: AbortSignal,
	): Promise<void> => {
		if (!isOpenAICodexModel(model)) return;
		const operationSignal = signal ?? ctx.signal;
		const sessionId = ctx.sessionManager.getSessionId();
		const checkpoint = findNativeCheckpoint(deps.getBranch(ctx), modelKey(model));
		if (checkpoint.status !== "valid") return;
		const pending = transitionBySession.get(sessionId);
		if (pending) {
			await pending.catch(() => undefined);
			return;
		}
		const previousModel = resolveModel(ctx, checkpoint.checkpoint.details.modelKey);
		const previousHash = checkpoint.checkpoint.details.compHash;
		const currentHash = compactionHash(model);
		const hashTransition = hashesDiffer(previousHash, currentHash);
		const downshift = previousModel ? isModelDownshift(previousModel, model) : false;
		if (!hashTransition && !downshift) return;
		if (!hashTransition) {
			const branch = deps.getBranch(ctx);
			const snapshot = createBranchInputSnapshot({ branch, tools: toolsWithRequestFormats(deps.getAllTools(), basePayload, requestInput) });
			const currentRequest = resolveCurrentRequest(snapshot, requestInput, previousModel ?? model, model, systemPromptItems(ctx, model));
			const input = snapshot.view(model, "effective", {
				excludeEntryId: currentRequest?.kind === "branch" ? currentRequest.entryId : undefined,
				allowCheckpointModelMismatch: true, excludeLastAssistantError,
			}).items;
			if (deps.shouldAutoCompact?.({ ctx, model, input, reason: "downshift" }) !== true) return;
		}
		const startGeneration = generation;
		const gateLeafId = conversationLeafId(deps.getBranch(ctx));
		const transition = runRemoteCompaction(ctx, "model-transition", async () => {
			if (previousModel) {
				await runTransition(sessionId, ctx, previousModel, modelKey(model), model, basePayload, startGeneration, requestInput, excludeLastAssistantError, operationSignal);
				return;
			}
			const branch = deps.getBranch(ctx);
			const leafId = conversationLeafId(branch);
			const snapshot = createBranchInputSnapshot({ branch, tools: toolsWithRequestFormats(deps.getAllTools(), basePayload, requestInput) });
			const currentRequest = resolveCurrentRequest(snapshot, requestInput, model, model, systemPromptItems(ctx, model));
			const native = await deps.createCheckpoint({
				ctx,
				model,
				input: snapshot.view(model, "effective", {
					excludeEntryId: currentRequest?.kind === "branch" ? currentRequest.entryId : undefined,
					allowCheckpointModelMismatch: true, excludeLastAssistantError,
				}).items,
				basePayload,
				signal: operationSignal,
			});
			ensureCurrent(ctx, modelKey(model), startGeneration, operationSignal);
			if (conversationLeafId(deps.getBranch(ctx)) !== leafId) {
				throw new Error("The session changed while Codex model-transition compaction was running.");
			}
			deps.appendCheckpoint(rebindCheckpoint(
				preserveCurrentUser(native.details, currentRequest),
				modelKey(model),
				currentHash,
			));
		});
		transitionBySession.set(sessionId, transition);
		try {
			await transition;
		} catch (transitionError) {
			if (!isContextWindowCompactionError(transitionError)) {
				bypassFailedGate(ctx, model, checkpoint.checkpoint.entryId, startGeneration, gateLeafId);
			}
			throw transitionError;
		} finally {
			if (transitionBySession.get(sessionId) === transition) transitionBySession.delete(sessionId);
		}
	};

	const selectModel = async (event: ModelSelectLike, ctx: ExtensionContext): Promise<void> => {
		generation++;
		const sessionId = ctx.sessionManager.getSessionId();
		transitionBySession.delete(sessionId);
		automaticCompactionBySession.delete(sessionId);
		const previousModel = event.previousModel;
		if (!isOpenAICodexModel(event.model) || !previousModel) {
			pendingBySession.delete(sessionId);
			return;
		}
		if (!isOpenAICodexModel(previousModel)) {
			pendingBySession.delete(sessionId);
			return;
		}
		const pending = pendingBySession.get(sessionId);
		const transitionPreviousModel = pending?.previousModel ?? previousModel;
		const hashTransition = needsTransitionCompaction(transitionPreviousModel, event.model);
		const downshift = isModelDownshift(transitionPreviousModel, event.model);
		if (!hashTransition && !downshift) {
			pendingBySession.delete(sessionId);
			return;
		}
		if (
			pending
			&& modelKey(event.model) === modelKey(pending.previousModel)
			&& compactionHash(event.model) === compactionHash(pending.previousModel)
		) {
			pendingBySession.delete(sessionId);
			return;
		}
		pendingBySession.set(sessionId, {
			previousModel: pending?.previousModel ?? previousModel,
			targetModelKey: modelKey(event.model),
			reason: hashTransition ? "hash" : "downshift",
		});
	};

	const prepareRequest = async (
		model: Model<any>,
		ctx: ExtensionContext,
		requestInput: ResponseItem[] | undefined,
		basePayload?: JsonObject,
		skipAutomaticCompaction = false,
	): Promise<ResponseItem[] | undefined> => {
		const sessionId = ctx.sessionManager.getSessionId();
		const requestGeneration = generation;
		const requestSignal = ctx.signal;
		const ensureRequestCurrent = () => ensureCurrent(ctx, modelKey(model), requestGeneration, requestSignal);
		ensureRequestCurrent();
		const originalRequestInput = requestInput;
		requestInput = requestInputWithoutFailedRequests(requestInput, activeFailedRequests(rawGetBranch(ctx)));
		const requestInputWasSanitized = requestInput !== originalRequestInput;
		let transitionCompactionCompleted = false;
		const activeTransition = transitionBySession.get(sessionId);
		if (activeTransition) {
			await activeTransition;
			ensureRequestCurrent();
			return prepareRequest(model, ctx, requestInput, basePayload, false);
		}
		const branchBefore = deps.getBranch(ctx);
		const tools = toolsWithRequestFormats(deps.getAllTools(), basePayload, requestInput);
		const snapshot = createBranchInputSnapshot({ branch: branchBefore, tools });
		let pending = pendingBySession.get(sessionId);
		const checkpoint = snapshot.checkpoint(model);
		if (!pending && checkpoint.status === "none") {
			const recoveredTransition = pendingTransitionFromBranch(branchBefore, model, ctx);
			pending = recoveredTransition;
			if (pending) pendingBySession.set(sessionId, pending);
		}
		if (
			pending
			&& checkpoint.status === "valid"
			&& checkpoint.checkpoint.details.modelKey === modelKey(model)
		) {
			pendingBySession.delete(sessionId);
			pending = undefined;
		}
		const checkpointModelKey = checkpoint.status === "valid"
			? checkpoint.checkpoint.details.modelKey
			: undefined;
		if (pending && pending.targetModelKey !== modelKey(model)) {
			throw new Error("The pending Codex model transition targets a different model.");
		}
		if (!requestInput && (pending || checkpoint.status === "valid")) {
			throw new Error("The Codex request input is unavailable while replaying compaction state.");
		}
		const historyModel = pending?.previousModel
			?? (checkpointModelKey && checkpointModelKey !== modelKey(model) ? resolveModel(ctx, checkpointModelKey) : undefined)
			?? model;
		const systemPromptInput = systemPromptItems(ctx, model);
		const initialCurrentRequest = resolveCurrentRequest(snapshot, requestInput, historyModel, model, systemPromptInput);
		const excludedEntryId = initialCurrentRequest?.kind === "branch" ? initialCurrentRequest.entryId : undefined;
		const historyViews = inputViews(snapshot, historyModel, excludedEntryId);
		const historyInput = historyViews.effective.items;
		const rawHistoryInput = historyViews.fullHistory.items;
		const piContextInput = historyViews.piContext.items;
		// Reuse views only within this synchronous snapshot. Later awaits may change
		// the branch or checkpoint, so subsequent phases rebuild from current facts.
		const sameHistoryModel = isDeepStrictEqual(historyModel, model);
		const currentViews = sameHistoryModel ? historyViews : inputViews(snapshot, model, excludedEntryId);
		const currentHistoryInput = currentViews.effective.items;
		const currentRawHistoryInput = currentViews.fullHistory.items;
		const currentPiContextInput = currentViews.piContext.items;
		let tail: ResponseItem[];
		try {
			tail = requestTail(
				requestInput,
				[historyInput, piContextInput, rawHistoryInput, currentHistoryInput, currentPiContextInput, currentRawHistoryInput],
				systemPromptInput,
			);
		} catch (error) {
			// An unmatched Pi payload may contain only its retained tail, not the
			// encrypted checkpoint. Recompacting it would silently erase history.
			if (checkpoint.status === "valid") throw error;
			if (checkpoint.status === "bypassed") {
				if (
					!requestInput
					|| requestInput.some((item) => item.type === "compaction" || item.type === "context_compaction")
					|| !fitsContextWindow(ctx, model, requestInput, basePayload, tools)
				) {
					throw new Error("The raw request cannot be replayed within this model's context window after the Codex checkpoint was bypassed.");
				}
				return requestInput;
			}
			if (!pending) return requestInputWasSanitized ? requestInput : undefined;
			const gateEntryId = conversationLeafId(branchBefore);
			const gateGeneration = generation;
			const gateLeafId = conversationLeafId(branchBefore);
			try {
				return await runRemoteCompaction(ctx, "context-recovery", async () => {
					const compactionInput = withoutLastUser(requestInput!);
					const createCheckpointFor = (selectedModel: Model<any>) => deps.createCheckpoint({
						ctx,
						model: selectedModel,
						input: compactionInput,
						basePayload,
						signal: ctx.signal,
					});
					let native: Awaited<ReturnType<CheckpointFactory>>;
					try {
						native = await createCheckpointFor(historyModel);
					} catch (firstError) {
						ensureRequestCurrent();
						if (
							(modelKey(model) === modelKey(historyModel) && compactionHash(model) === compactionHash(historyModel))
							|| !shouldRetryWithCurrentModel(firstError)
						) throw firstError;
						try {
							native = await createCheckpointFor(model);
						} catch (fallbackError) {
							throw fallbackError;
						}
					}
					ensureRequestCurrent();
					if (conversationLeafId(deps.getBranch(ctx)) !== gateLeafId) {
						throw new Error("The session changed while Codex model-transition compaction was running.");
					}
					const details = rebindCheckpoint(
						preserveRequestUser(native.details, requestInput!),
						modelKey(model),
						compactionHash(model),
					);
					deps.appendCheckpoint(details);
					pendingBySession.delete(sessionId);
					return [...details.replacementHistory, ...(details.preservedInput ?? [])];
				});
			} catch (recoveryError) {
				if (!isContextWindowCompactionError(recoveryError)) {
					bypassFailedGate(ctx, model, gateEntryId, gateGeneration, gateLeafId);
				}
				throw recoveryError;
			}
		}
		const initialTailStart = (requestInput?.length ?? 0) - tail.length;


		const activeAutomaticCompaction = automaticCompactionBySession.get(sessionId);
		if (activeAutomaticCompaction) {
			await activeAutomaticCompaction;
			ensureRequestCurrent();
			return prepareRequest(model, ctx, requestInput, basePayload, true);
		}
		if (pending && pending.targetModelKey === modelKey(model)) {
			const shouldRun = pending.reason === "hash"
				|| deps.shouldAutoCompact?.({ ctx, model, input: currentHistoryInput, reason: pending.reason }) === true;
			if (!shouldRun) {
				pendingBySession.delete(sessionId);
			} else {
				const startGeneration = generation;
				const gateEntryId = checkpoint.status === "valid" ? checkpoint.checkpoint.entryId : conversationLeafId(branchBefore);
				const gateLeafId = conversationLeafId(branchBefore);
				const transition = runRemoteCompaction(ctx, "model-transition", () =>
					runTransition(sessionId, ctx, pending.previousModel, pending.targetModelKey, model, basePayload, startGeneration, requestInput),
				);
				transitionBySession.set(sessionId, transition);
				try {
					await transition;
					ensureRequestCurrent();
					transitionCompactionCompleted = true;
				} catch (transitionError) {
					if (!isContextWindowCompactionError(transitionError)) {
						bypassFailedGate(ctx, model, gateEntryId, startGeneration, gateLeafId);
					}
					throw transitionError;
				} finally {
					if (transitionBySession.get(sessionId) === transition) transitionBySession.delete(sessionId);
				}
				skipAutomaticCompaction = false;
			}
		}

		await recoverCurrentModel(model, ctx, basePayload, requestInput);
		ensureRequestCurrent();
		const recoveredCheckpoint = findNativeCheckpoint(deps.getBranch(ctx), modelKey(model));
		if (recoveredCheckpoint.status === "valid" && recoveredCheckpoint.checkpoint.details.modelKey !== modelKey(model)) {
			const checkpointHash = recoveredCheckpoint.checkpoint.details.compHash;
			if (hashesDiffer(checkpointHash, compactionHash(model))) {
				throw new Error("The latest Codex compaction checkpoint requires model-transition compaction first.");
			}
		}
		let branch = deps.getBranch(ctx);
		{
			const activeTransition = transitionBySession.get(sessionId);
			if (activeTransition) {
				await activeTransition;
				ensureRequestCurrent();
				return prepareRequest(model, ctx, requestInput, basePayload, false);
			}
			const activeAutomaticCompaction = automaticCompactionBySession.get(sessionId);
			if (activeAutomaticCompaction) {
				await activeAutomaticCompaction;
				ensureRequestCurrent();
			} else if (!skipAutomaticCompaction) {
				const automaticSnapshot = createBranchInputSnapshot({ branch, tools });
				const currentRequest = resolveCurrentRequest(automaticSnapshot, requestInput, model, model, systemPromptInput);
				const automaticExcludeId = currentRequest?.kind === "branch" ? currentRequest.entryId : undefined;
				const currentHistory = automaticSnapshot.view(model, "effective", {
					excludeEntryId: automaticExcludeId, allowCheckpointModelMismatch: true,
				}).items;
				if (
					(transitionCompactionCompleted || hasBranchTailAfterCheckpoint(branch, automaticSnapshot.checkpoint(model), automaticExcludeId))
					&& deps.shouldAutoCompact?.({ ctx, model, input: currentHistory })
				) {
					const startGeneration = generation;
					const leafId = conversationLeafId(branch);
					const automaticCompaction = runRemoteCompaction(ctx, "automatic", async () => {
						const native = await deps.createCheckpoint({
							ctx,
							model,
							input: currentHistory,
							basePayload,
							signal: ctx.signal,
						});
						ensureCurrent(ctx, modelKey(model), startGeneration, requestSignal);
						if (conversationLeafId(deps.getBranch(ctx)) !== leafId) {
							throw new Error("The session changed while Codex automatic compaction was running.");
						}
						deps.appendCheckpoint(preserveCurrentUser(native.details, currentRequest));
					});
					automaticCompactionBySession.set(sessionId, automaticCompaction);
					try {
						await automaticCompaction;
					} catch (automaticError) {
						ensureRequestCurrent();
						const unchangedInput = [...currentHistory, ...tail];
						if (
							ctx.signal?.aborted
							|| isContextWindowCompactionError(automaticError)
							|| !fitsContextWindow(ctx, model, unchangedInput, basePayload, tools)
						) throw automaticError;
						try {
							deps.onAutomaticCompactionFailure?.(ctx, automaticError);
						} catch {}
					} finally {
						if (automaticCompactionBySession.get(sessionId) === automaticCompaction) automaticCompactionBySession.delete(sessionId);
					}
				}
			}
			branch = deps.getBranch(ctx);
		}
		const finalSnapshot = createBranchInputSnapshot({ branch, tools });
		const currentCheckpoint = finalSnapshot.checkpoint(model);
		if (currentCheckpoint.status === "bypassed") {
			const currentRequest = resolveCurrentRequest(finalSnapshot, requestInput, model, model, systemPromptInput);
			const rawReplay = [
				...finalSnapshot.view(model, "effective", {
					excludeEntryId: currentRequest?.kind === "branch" ? currentRequest.entryId : undefined,
					allowCheckpointModelMismatch: true,
				}).items,
				...tail,
			];
			if (!fitsContextWindow(ctx, model, rawReplay, basePayload, tools)) {
				throw new Error("The complete branch cannot be replayed within this model's context window after the Codex checkpoint was bypassed.");
			}
			return rawReplay;
		}
		if (currentCheckpoint.status !== "valid") return requestInputWasSanitized ? requestInput : undefined;
		const initialBranchRequest = initialCurrentRequest?.kind === "branch" ? initialCurrentRequest : undefined;
		const checkpointContainsInitialRequest = initialBranchRequest
			&& currentCheckpoint.checkpoint.entryIndex > (snapshot.projection.sourceIndexById.get(initialBranchRequest.entryId) ?? Number.MAX_SAFE_INTEGER)
			&& [...currentCheckpoint.checkpoint.details.replacementHistory, ...(currentCheckpoint.checkpoint.details.preservedInput ?? [])]
				.some((item) => item.role === "user"
					&& sameUserOccurrence(item, initialBranchRequest.item)
					&& isDeepStrictEqual(item.content, initialBranchRequest.item.content));
		if (checkpointContainsInitialRequest) {
			const tailIndex = initialBranchRequest.requestIndex - initialTailStart;
			if (tailIndex >= 0 && tailIndex < tail.length && sameUserOccurrence(tail[tailIndex]!, initialBranchRequest.item)) {
				tail = tail.filter((_item, index) => index !== tailIndex);
			}
		} else {
			const preservedUser = checkpointPreservedCurrentUser(branch, requestInput, modelKey(model), currentCheckpoint);
			if (preservedUser) {
				const preservedUserIndex = tail.findLastIndex((item) =>
					item.role === "user" && sameUserOccurrence(item, preservedUser),
				);
				if (preservedUserIndex >= 0) tail = tail.filter((_item, index) => index !== preservedUserIndex);
			}
		}
		const finalRequest = resolveCurrentRequest(finalSnapshot, requestInput, model, model, systemPromptInput);
		return [
			...finalSnapshot.view(model, "effective", {
				excludeEntryId: finalRequest?.kind === "branch" ? finalRequest.entryId : undefined,
				allowCheckpointModelMismatch: true,
			}).items,
			...tail,
		];
	};

	const prepareCompaction = async (
		model: Model<any>,
		ctx: ExtensionContext,
		excludeLastAssistantError = false,
		signal?: AbortSignal,
		basePayload?: JsonObject,
	): Promise<ResponseItem[]> => {
		if (!isOpenAICodexModel(model)) return [];
		const operationSignal = signal ?? ctx.signal;
		const sessionId = ctx.sessionManager.getSessionId();
		const activeTransition = transitionBySession.get(sessionId);
		if (activeTransition) await activeTransition;
		ensureNotAborted(operationSignal);
		const currentBranch = deps.getBranch(ctx);
		return createBranchInputSnapshot({
			branch: currentBranch,
			tools: toolsWithRequestFormats(deps.getAllTools(), basePayload),
		}).view(model, "effective", { allowCheckpointModelMismatch: true, excludeLastAssistantError }).items;
	};

	return {
		clear,
		recordFailedRequest,
		selectModel,
		recoverCurrentModel,
		prepareRequest,
		prepareCompaction,
	};
}
