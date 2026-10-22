import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { emptyCompactionHashSnapshot, type CompactionHashSnapshot } from "./capabilities.js";
import { effectiveContextWindow, loadConfig } from "./config.js";
import { resolveRequestProjection } from "./request-projection.js";
import { accountingFingerprint } from "./usage-accounting.js";
import { createBranchProjectionSnapshot } from "./session-projection.js";
import {
	HistoryPrefixMismatchError,
	FAILED_REQUEST_KIND,
	NATIVE_COMPACTION_BYPASS_KIND,
	NATIVE_COMPACTION_BYPASS_VERSION,
	createBranchInputSnapshot,
	compactionInputPlan,
	appendPreservedInput,
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
	type RequestProjectionPolicy,
	type InputViewOptions,
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
	protectedInput?: ResponseItem[];
	replayContextWindow?: number;
	basePayload?: JsonObject;
	signal?: AbortSignal;
	compactionHashes: CompactionHashSnapshot;
}) => Promise<{ details: NativeCompactionDetails }>;

export type ResolveCompactionHashes = (
	ctx: ExtensionContext, currentModel: Model<any>, signal?: AbortSignal,
) => Promise<CompactionHashSnapshot>;

export type SessionCoordinatorDeps = {
	getBranch: (ctx: ExtensionContext) => SessionEntry[];
	getAllTools: () => Parameters<typeof effectiveInputForBranch>[0]["tools"];
	createCheckpoint: CheckpointFactory;
	resolveCompactionHashes: ResolveCompactionHashes;
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

type PendingSelection = {
	previousModel: Model<any>;
	targetModelKey: string;
};

type PendingTransition = PendingSelection & {
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

function transitionForSelection(
	selection: PendingSelection, currentModel: Model<any>, hashes: CompactionHashSnapshot,
): PendingTransition | undefined {
	if (hashesDiffer(hashes.hashFor(selection.previousModel), hashes.hashFor(currentModel))) {
		return { ...selection, reason: "hash" };
	}
	if (isModelDownshift(selection.previousModel, currentModel)) return { ...selection, reason: "downshift" };
	return undefined;
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
		tools: basePayload !== undefined ? (Array.isArray(basePayload.tools) ? basePayload.tools : []) : tools,
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

class StaleCompactionError extends Error {}

type CurrentRequest = (({ kind: "branch"; entryId: string } | { kind: "checkpoint" }) & {
	requestIndex: number; item: ResponseItem; excludeEntryIds?: string[];
	suffix?: ResponseItem[]; suffixSources?: (string | null)[];
}) | undefined;

type RequestReceipt = {
	suffix?: ResponseItem[];
	suffixSources?: (string | null)[];
	requestIndex: number;
	item: ResponseItem;
	sourceEntryId?: string;
	checkpointEntryId: string;
	conversationLeafId?: string;
};

type RequestContinuity = {
	sessionId: string;
	generation: number;
	targetModelKey: string;
	requestInput: ResponseItem[] | undefined;
	compactionHashes: CompactionHashSnapshot;
	signal?: AbortSignal;
	receipt?: RequestReceipt;
	automaticCompactionAttempted?: boolean;
	assertEvidence?: () => void;
	tools?: ReturnType<SessionCoordinatorDeps["getAllTools"]>;
	projectionPolicy?: RequestProjectionPolicy;
	projectionAttempted?: boolean;
	automaticAttemptKey?: string;
	requestSuffix?: ResponseItem[];
};

function resolveCurrentRequest(
	snapshot: ReturnType<typeof createBranchInputSnapshot>,
	requestInput: ResponseItem[] | undefined,
	historyModel: Model<any>,
	currentModel: Model<any>,
	systemPromptInput: ResponseItem[],
): CurrentRequest {
	if (!requestInput) return undefined;
	let requestIndex = requestInput.findLastIndex((item) => item.role === "user");
	if (requestIndex < 0) return undefined;
	const branch = snapshot.projection.branch as SessionEntry[];
	const candidateIndex = branch.findLastIndex((entry) => entry.type === "message" && entry.message.role === "user");
	const candidate = candidateIndex < 0 ? undefined : branch[candidateIndex];
	const eligible = candidate && candidate.type === "message" && !branch.slice(candidateIndex + 1).some(entry =>
		entry.type === "message" && (entry.message.role === "toolResult" || (entry.message.role === "assistant" && entry.message.stopReason !== "error" && entry.message.stopReason !== "aborted")));
	const models = isDeepStrictEqual(historyModel, currentModel) ? [historyModel] : [historyModel, currentModel];
	const matches = new Set<string>();
	const indices = new Set<number>();
	let selectedSources: (string | null)[] | undefined;
	if (eligible) {
		for (const selectedModel of models) {
			for (const kind of ["effective", "pi-context", "full-history"] as const) {
				const view = snapshot.view(selectedModel, kind, { allowCheckpointModelMismatch: true });
				for (const offset of systemPromptInput.length > 0 ? [0, systemPromptInput.length] : [0]) {
					const prefix = offset === 0 ? view.items : [...systemPromptInput, ...view.items];
					if (prefix.length !== requestInput.length || !prefix.every((item, index) => isDeepStrictEqual(item, requestInput[index]))) continue;
					for (const [sourceIndex, source] of view.userSources) {
						if (source !== candidate!.id) continue;
						matches.add(source);
						requestIndex = sourceIndex + offset;
						indices.add(requestIndex);
						selectedSources = requestInput.slice(requestIndex).map((_, index) => view.userSources.get(sourceIndex + index) ?? null);
					}
				}
			}
		}
	}
	if (eligible && matches.size === 1 && indices.size === 1 && matches.has(candidate!.id)) {
		const lookup = snapshot.checkpoint(currentModel);
		if (lookup.status !== "valid" || candidateIndex > lookup.checkpoint.entryIndex) {
			return { kind: "branch", entryId: candidate!.id, requestIndex, item: requestInput[requestIndex]!,
				excludeEntryIds: branch.slice(candidateIndex).map(entry => entry.id), suffix: requestInput.slice(requestIndex), suffixSources: selectedSources };
		}
		if (lookup.checkpoint.details.preservedInputSources?.includes(candidate!.id)) {
			return { kind: "checkpoint", requestIndex, item: requestInput[requestIndex]!,
				suffix: requestInput.slice(requestIndex), suffixSources: selectedSources };
		}
	}
	if (matches.size > 1 || indices.size > 1) return undefined;
	if (checkpointPreservedCurrentUser(branch, requestInput, modelKey(currentModel), snapshot.checkpoint(currentModel))) {
		return { kind: "checkpoint", requestIndex, item: requestInput[requestIndex]! };
	}
	return undefined;
}

function inputViews(snapshot: ReturnType<typeof createBranchInputSnapshot>, model: Model<any>, excludeEntryId?: string, excludeEntryIds?: string[]) {
	const options = { excludeEntryId, excludeEntryIds, allowCheckpointModelMismatch: true };
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
	if (currentRequest.kind === "branch") return appendPreservedInput(details, currentRequest.suffix ?? [currentRequest.item], currentRequest.suffixSources ?? [currentRequest.entryId]);
	return appendPreservedInput(details, currentRequest.suffix ?? [currentRequest.item], currentRequest.suffixSources);
}

function checkpointContainsSuffix(details: NativeCompactionDetails, suffix: ResponseItem[]): boolean {
	return suffix.length > 0 && isDeepStrictEqual(details.preservedInput?.slice(-suffix.length), suffix);
}

function historyForRequest(snapshot: ReturnType<typeof createBranchInputSnapshot>, model: Model<any>, request: CurrentRequest, options: InputViewOptions = {}): ResponseItem[] {
	const view = snapshot.view(model, "effective", { ...options, allowCheckpointModelMismatch: true,
		excludeEntryId: request?.kind === "branch" ? request.entryId : undefined, excludeEntryIds: request?.excludeEntryIds });
	if (request?.kind !== "checkpoint") return view.items;
	const suffix = request.suffix ?? [request.item];
	const source = request.suffixSources?.[0];
	const matches: number[] = [];
	for (let index = 0; index < view.items.length; index++) {
		if (source && view.userSources.get(index) !== source) continue;
		if (isDeepStrictEqual(view.items[index], suffix[0]) && isDeepStrictEqual(view.items.slice(index, index + suffix.length), suffix)) matches.push(index);
	}
	if (matches.length !== 1) throw new Error("The preserved request occurrence cannot be identified for repeated Codex compaction.");
	const start = matches[0]!;
	return view.items.filter((_, index) => index < start || index >= start + suffix.length);
}

function rebindCheckpoint(details: NativeCompactionDetails, modelKeyValue: string, compHash: string | undefined): NativeCompactionDetails {
	const { compHash: _previousHash, ...withoutHash } = details;
	return {
		...withoutHash,
		modelKey: modelKeyValue,
		...(compHash ? { compHash } : {}),
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
	hashes: CompactionHashSnapshot,
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
	return transitionForSelection({ previousModel, targetModelKey: modelKey(currentModel) }, currentModel, hashes);
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
	const pendingBySession = new Map<string, PendingSelection>();
	const transitionBySession = new Map<string, Promise<void>>();
	const automaticCompactionBySession = new Map<string, Promise<void>>();
	const observedRequests = new Map<string, { branch: string; tools: string; prompt: string; model: string; payload: JsonObject; policy?: RequestProjectionPolicy }>();
	const automaticAttempts = new Map<string, string>();
	let generation = 0;
	const requestSnapshot = (branch: SessionEntry[], tools: ReturnType<SessionCoordinatorDeps["getAllTools"]>, continuity?: RequestContinuity) =>
		createBranchInputSnapshot({ branch, tools, projectionPolicy: continuity?.projectionPolicy });
	const ensureCurrent = (ctx: ExtensionContext, targetModelKey: string, startGeneration: number, signal?: AbortSignal): void => {
		ensureNotAborted(signal);
		if (generation !== startGeneration || (ctx.model && modelKey(ctx.model) !== targetModelKey)) {
			throw new StaleCompactionError("The session changed while Codex model-transition compaction was running.");
		}
	};
	const validReceipt = (
		ctx: ExtensionContext,
		model: Model<any>,
		snapshot: ReturnType<typeof createBranchInputSnapshot>,
		requestInput: ResponseItem[] | undefined,
		continuity?: RequestContinuity,
		signal?: AbortSignal,
	): RequestReceipt | undefined => {
		if (!continuity?.receipt) return undefined;
		const receipt = continuity.receipt;
		const branch = snapshot.projection.branch as SessionEntry[];
		const checkpoint = snapshot.checkpoint(model);
		const sourceIndex = receipt.sourceEntryId === undefined
			? undefined
			: branch.findIndex((entry) => entry.id === receipt.sourceEntryId);
		const requestItem = requestInput?.[receipt.requestIndex];
		if (ctx.sessionManager.getSessionId() !== continuity.sessionId
			|| generation !== continuity.generation
			|| modelKey(model) !== continuity.targetModelKey
			|| (ctx.model && modelKey(ctx.model) !== continuity.targetModelKey)
			|| requestInput !== continuity.requestInput
			|| (signal ?? ctx.signal)?.aborted
			|| checkpoint.status !== "valid"
			|| checkpoint.checkpoint.entryId !== receipt.checkpointEntryId
			|| checkpoint.checkpoint.details.modelKey !== continuity.targetModelKey
			|| conversationLeafId(branch) !== receipt.conversationLeafId
			|| branch.slice(checkpoint.checkpoint.entryIndex + 1).some(isContextEntry)
			|| (sourceIndex !== undefined && (sourceIndex < 0 || sourceIndex >= checkpoint.checkpoint.entryIndex))
			|| !requestItem
			|| requestItem.role !== "user"
			|| !isDeepStrictEqual(requestInput?.slice(receipt.requestIndex, receipt.requestIndex + (receipt.suffix?.length ?? 1)), receipt.suffix ?? [receipt.item])
			|| !isDeepStrictEqual(requestItem, receipt.item)
			|| !checkpointContainsSuffix(checkpoint.checkpoint.details, receipt.suffix ?? [receipt.item])) {
			continuity.receipt = undefined;
			return undefined;
		}
		return receipt;
	};
	const resolveRequest = (
		ctx: ExtensionContext,
		snapshot: ReturnType<typeof createBranchInputSnapshot>,
		requestInput: ResponseItem[] | undefined,
		historyModel: Model<any>,
		currentModel: Model<any>,
		systemPromptInput: ResponseItem[],
		continuity?: RequestContinuity,
		signal?: AbortSignal,
	): CurrentRequest => {
		const receipt = validReceipt(ctx, currentModel, snapshot, requestInput, continuity, signal);
		return receipt
			? { kind: "checkpoint", requestIndex: receipt.requestIndex, item: receipt.item, suffix: receipt.suffix, suffixSources: receipt.suffixSources }
			: resolveCurrentRequest(snapshot, requestInput, historyModel, currentModel, systemPromptInput);
	};
	const saveCheckpoint = (
		ctx: ExtensionContext,
		model: Model<any>,
		details: NativeCompactionDetails,
		currentRequest: CurrentRequest,
		before: SessionEntry[],
		continuity?: RequestContinuity,
		signal?: AbortSignal,
	): void => {
		continuity?.assertEvidence?.();
		if (!isDeepStrictEqual(deps.getBranch(ctx), before)) {
			throw new StaleCompactionError("The session changed before committing Codex compaction.");
		}
		const priorReceipt = continuity?.receipt;
		if (continuity) continuity.receipt = undefined;
		if (!continuity || !currentRequest) {
			deps.appendCheckpoint(details);
			return;
		}
		const beforeIds = before.map((entry) => entry.id);
		const leafId = conversationLeafId(before);
		deps.appendCheckpoint(details);
		try {
			const after = deps.getBranch(ctx);
			const checkpoint = findNativeCheckpoint(after, modelKey(model));
			const requestItem = continuity.requestInput?.[currentRequest.requestIndex];
			if (ctx.sessionManager.getSessionId() !== continuity.sessionId
				|| generation !== continuity.generation
				|| modelKey(model) !== continuity.targetModelKey
				|| (ctx.model && modelKey(ctx.model) !== continuity.targetModelKey)
				|| (signal ?? ctx.signal)?.aborted
				|| after.length !== beforeIds.length + 1
				|| !beforeIds.every((id, index) => after[index]?.id === id)
				|| checkpoint.status !== "valid"
				|| checkpoint.checkpoint.entryIndex !== beforeIds.length
				|| beforeIds.includes(checkpoint.checkpoint.entryId)
				|| checkpoint.checkpoint.details.modelKey !== continuity.targetModelKey
				|| !isDeepStrictEqual(checkpoint.checkpoint.details, details)
				|| conversationLeafId(after) !== leafId
				|| !requestItem
				|| requestItem.role !== "user"
				|| !isDeepStrictEqual(continuity.requestInput?.slice(currentRequest.requestIndex, currentRequest.requestIndex + (currentRequest.suffix?.length ?? 1)), currentRequest.suffix ?? [currentRequest.item])
				|| !isDeepStrictEqual(requestItem, currentRequest.item)
				|| !checkpointContainsSuffix(checkpoint.checkpoint.details, currentRequest.suffix ?? [currentRequest.item])) return;
			continuity.receipt = {
				suffix: currentRequest.suffix,
				suffixSources: currentRequest.suffixSources,
				requestIndex: currentRequest.requestIndex,
				item: priorReceipt && isDeepStrictEqual(priorReceipt.item, currentRequest.item)
					? priorReceipt.item : structuredClone(currentRequest.item),
				...(currentRequest.kind === "branch" ? { sourceEntryId: currentRequest.entryId }
					: priorReceipt?.sourceEntryId ? { sourceEntryId: priorReceipt.sourceEntryId } : {}),
				checkpointEntryId: checkpoint.checkpoint.entryId,
				conversationLeafId: leafId,
			};
		} catch {
			// The checkpoint is saved, but its identity cannot be confirmed.
		}
	};

	const clear = (): void => {
		generation++;
		pendingBySession.clear();
		transitionBySession.clear();
		automaticCompactionBySession.clear();
		observedRequests.clear();
		automaticAttempts.clear();
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
		hashes: CompactionHashSnapshot,
		excludeLastAssistantError = false,
		signal?: AbortSignal,
		continuity?: RequestContinuity,
	): Promise<void> => {
		const operationSignal = signal ?? ctx.signal;
		for (let attempt = 0; attempt < 3; attempt++) {
			ensureCurrent(ctx, targetModelKey, startGeneration, operationSignal);
			const branch = deps.getBranch(ctx);
			const branchBefore = structuredClone(branch);
			const leafId = conversationLeafId(branch);
			const snapshot = requestSnapshot(branch, toolsWithRequestFormats(continuity?.tools ?? deps.getAllTools(), basePayload, requestInput), continuity);
			const currentRequest = resolveRequest(ctx, snapshot, requestInput, previousModel, currentModel, systemPromptItems(ctx, currentModel), continuity, operationSignal);
			const options = { excludeEntryId: currentRequest?.kind === "branch" ? currentRequest.entryId : undefined, excludeEntryIds: currentRequest?.excludeEntryIds, allowCheckpointModelMismatch: true, excludeLastAssistantError };
			const input = historyForRequest(snapshot, previousModel, currentRequest, options);
			let native: Awaited<ReturnType<CheckpointFactory>>;
			try {
				native = await deps.createCheckpoint({
					ctx,
					model: previousModel,
					input,
					protectedInput: currentRequest ? currentRequest.suffix ?? [currentRequest.item] : continuity?.requestSuffix ?? [],
					replayContextWindow: currentModel.contextWindow,
					basePayload,
					signal: operationSignal,
					compactionHashes: hashes,
				});
			} catch (firstError) {
				ensureCurrent(ctx, targetModelKey, startGeneration, operationSignal);
				if (
					(modelKey(currentModel) === modelKey(previousModel) && hashes.hashFor(currentModel) === hashes.hashFor(previousModel))
					|| !shouldRetryWithCurrentModel(firstError)
				) throw firstError;
				try {
					native = await deps.createCheckpoint({
						ctx,
						model: currentModel,
						input: historyForRequest(snapshot, currentModel, currentRequest, options),
						protectedInput: currentRequest ? currentRequest.suffix ?? [currentRequest.item] : continuity?.requestSuffix ?? [],
						replayContextWindow: currentModel.contextWindow,
						basePayload,
						signal: operationSignal,
						compactionHashes: hashes,
					});
				} catch (fallbackError) {
					throw fallbackError;
				}
			}
			ensureCurrent(ctx, targetModelKey, startGeneration, operationSignal);
			if (conversationLeafId(deps.getBranch(ctx)) !== leafId) continue;
			saveCheckpoint(ctx, currentModel, rebindCheckpoint(
				preserveCurrentUser(native.details, currentRequest),
				targetModelKey,
				hashes.hashFor(currentModel),
			), currentRequest, branchBefore, continuity, operationSignal);
			pendingBySession.delete(sessionId);
			return;
		}
		throw new StaleCompactionError("The session changed while Codex model-transition compaction was running.");
	};

	const recoverCurrentModelInternal = async (
		model: Model<any>,
		ctx: ExtensionContext,
		hashes: CompactionHashSnapshot,
		basePayload?: JsonObject,
		requestInput?: ResponseItem[],
		excludeLastAssistantError = false,
		signal?: AbortSignal,
		continuity?: RequestContinuity,
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
		const currentHash = hashes.hashFor(model);
		const hashTransition = hashesDiffer(previousHash, currentHash);
		const downshift = previousModel ? isModelDownshift(previousModel, model) : false;
		if (!hashTransition && !downshift) return;
		if (!hashTransition) {
			const branch = deps.getBranch(ctx);
			const snapshot = requestSnapshot(branch, toolsWithRequestFormats(continuity?.tools ?? deps.getAllTools(), basePayload, requestInput), continuity);
			const currentRequest = resolveRequest(ctx, snapshot, requestInput, previousModel ?? model, model, systemPromptItems(ctx, model), continuity, operationSignal);
			const input = [...historyForRequest(snapshot, model, currentRequest, { excludeLastAssistantError }),
				...(currentRequest ? currentRequest.suffix ?? [currentRequest.item] : [])];
			if (deps.shouldAutoCompact?.({ ctx, model, input, reason: "downshift" }) !== true) return;
		}
		const startGeneration = generation;
		const gateLeafId = conversationLeafId(deps.getBranch(ctx));
		const transition = runRemoteCompaction(ctx, "model-transition", async () => {
			if (previousModel) {
				await runTransition(sessionId, ctx, previousModel, modelKey(model), model, basePayload, startGeneration, requestInput, hashes, excludeLastAssistantError, operationSignal, continuity);
				return;
			}
			const branch = deps.getBranch(ctx);
			const branchBefore = structuredClone(branch);
			const leafId = conversationLeafId(branch);
			const snapshot = requestSnapshot(branch, toolsWithRequestFormats(continuity?.tools ?? deps.getAllTools(), basePayload, requestInput), continuity);
			const currentRequest = resolveRequest(ctx, snapshot, requestInput, model, model, systemPromptItems(ctx, model), continuity, operationSignal);
			const native = await deps.createCheckpoint({
				ctx,
				model,
				input: historyForRequest(snapshot, model, currentRequest, { excludeLastAssistantError }),
				protectedInput: currentRequest ? currentRequest.suffix ?? [currentRequest.item] : continuity?.requestSuffix ?? [],
				basePayload,
				signal: operationSignal,
				compactionHashes: hashes,
			});
			ensureCurrent(ctx, modelKey(model), startGeneration, operationSignal);
			if (conversationLeafId(deps.getBranch(ctx)) !== leafId) {
				throw new StaleCompactionError("The session changed while Codex model-transition compaction was running.");
			}
			saveCheckpoint(ctx, model, rebindCheckpoint(
				preserveCurrentUser(native.details, currentRequest),
				modelKey(model),
				currentHash,
			), currentRequest, branchBefore, continuity, operationSignal);
		});
		transitionBySession.set(sessionId, transition);
		try {
			await transition;
		} catch (transitionError) {
			if (!(transitionError instanceof StaleCompactionError) && !isContextWindowCompactionError(transitionError)) {
				bypassFailedGate(ctx, model, checkpoint.checkpoint.entryId, startGeneration, gateLeafId);
			}
			throw transitionError;
		} finally {
			if (transitionBySession.get(sessionId) === transition) transitionBySession.delete(sessionId);
		}
	};
	const recoverCurrentModel = async (
		model: Model<any>,
		ctx: ExtensionContext,
		basePayload?: JsonObject,
		requestInput?: ResponseItem[],
		excludeLastAssistantError = false,
		signal?: AbortSignal,
	): Promise<void> => {
		const startSessionId = ctx.sessionManager.getSessionId();
		const startGeneration = generation;
		const operationSignal = signal ?? ctx.signal;
		const branch = structuredClone(deps.getBranch(ctx));
		const tools = structuredClone(deps.getAllTools());
		const prompt = ctx.getSystemPrompt();
		const originalModel = model;
		model = structuredClone(model);
		basePayload = basePayload && structuredClone(basePayload);
		requestInput = requestInput && structuredClone(requestInput);
		const assertEvidence = () => {
			if (!isDeepStrictEqual(tools, deps.getAllTools()) || prompt !== ctx.getSystemPrompt()
				|| !isDeepStrictEqual(model, originalModel) || (ctx.model && !isDeepStrictEqual(model, ctx.model))) {
				throw new StaleCompactionError("The request declarations, prompt or model changed while recovering Codex compaction.");
			}
		};
		const projectionPolicy = requestInput && basePayload && branch.some(entry => entry.type === "message" && entry.message.role === "system")
			? resolveRequestProjection(branch, model, tools, requestInput, basePayload) : undefined;
		const hashes = isOpenAICodexModel(model)
			? await deps.resolveCompactionHashes(ctx, model, operationSignal)
			: emptyCompactionHashSnapshot("unsupported");
		ensureCurrent(ctx, modelKey(model), startGeneration, operationSignal);
		assertEvidence();
		if (!isDeepStrictEqual(branch, deps.getBranch(ctx))) throw new StaleCompactionError("The session changed while resolving Codex metadata.");
		if (ctx.sessionManager.getSessionId() !== startSessionId || (signal === undefined && ctx.signal !== operationSignal)) {
			throw new StaleCompactionError("The session changed while resolving Codex metadata.");
		}
		return recoverCurrentModelInternal(model, ctx, hashes, basePayload, requestInput, excludeLastAssistantError, operationSignal, {
			sessionId: startSessionId, generation: startGeneration, targetModelKey: modelKey(model), requestInput,
			compactionHashes: hashes, signal: operationSignal, assertEvidence, tools, projectionPolicy,
		});
	};

	const selectModel = async (event: ModelSelectLike, ctx: ExtensionContext): Promise<void> => {
		generation++;
		const sessionId = ctx.sessionManager.getSessionId();
		automaticAttempts.delete(sessionId);
		observedRequests.delete(sessionId);
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
		if (modelKey(event.model) === modelKey(transitionPreviousModel)) {
			pendingBySession.delete(sessionId);
			return;
		}
		pendingBySession.set(sessionId, {
			previousModel: transitionPreviousModel,
			targetModelKey: modelKey(event.model),
		});
	};

	const prepareRequestInternal = async (
		model: Model<any>,
		ctx: ExtensionContext,
		requestInput: ResponseItem[] | undefined,
		basePayload: JsonObject | undefined,
		skipAutomaticCompaction: boolean,
		continuity: RequestContinuity,
	): Promise<ResponseItem[] | undefined> => {
		const sessionId = ctx.sessionManager.getSessionId();
		const requestGeneration = continuity.generation;
		const requestSignal = continuity.signal;
		const hashes = continuity.compactionHashes;
		const ensureRequestCurrent = () => {
			continuity.assertEvidence?.();
			ensureCurrent(ctx, modelKey(model), requestGeneration, requestSignal);
			if (ctx.sessionManager.getSessionId() !== continuity.sessionId || ctx.signal !== requestSignal) {
				throw new StaleCompactionError("The session changed while preparing the Codex request.");
			}
		};
		ensureRequestCurrent();
		const originalRequestInput = requestInput;
		requestInput = requestInputWithoutFailedRequests(requestInput, activeFailedRequests(rawGetBranch(ctx)));
		const requestInputWasSanitized = requestInput !== originalRequestInput;
		if (requestInput !== continuity.requestInput) continuity.receipt = undefined;
		continuity.requestInput = requestInput;
		let transitionCompactionCompleted = false;
		const activeTransition = transitionBySession.get(sessionId);
		if (activeTransition) {
			await activeTransition;
			ensureRequestCurrent();
			return prepareRequestInternal(model, ctx, requestInput, basePayload, false, continuity);
		}
		const branchBefore = deps.getBranch(ctx);
		const tools = toolsWithRequestFormats(continuity.tools ?? deps.getAllTools(), basePayload, requestInput);
		const snapshot = requestSnapshot(branchBefore, tools, continuity);
		let selection = pendingBySession.get(sessionId);
		const checkpoint = snapshot.checkpoint(model);
		if (
			selection
			&& checkpoint.status === "valid"
			&& checkpoint.checkpoint.details.modelKey === modelKey(model)
		) {
			pendingBySession.delete(sessionId);
			selection = undefined;
		}
		const checkpointModelKey = checkpoint.status === "valid"
			? checkpoint.checkpoint.details.modelKey
			: undefined;
		if (selection && selection.targetModelKey !== modelKey(model)) {
			throw new Error("The pending Codex model transition targets a different model.");
		}
		let pending = selection && transitionForSelection(selection, model, hashes);
		if (selection && !pending) pendingBySession.delete(sessionId);
		if (!pending && checkpoint.status === "none") {
			pending = pendingTransitionFromBranch(branchBefore, model, ctx, hashes);
			if (pending) pendingBySession.set(sessionId, { previousModel: pending.previousModel, targetModelKey: pending.targetModelKey });
		}
		if (!requestInput && (pending || checkpoint.status === "valid")) {
			throw new Error("The Codex request input is unavailable while replaying compaction state.");
		}
		const historyModel = pending?.previousModel
			?? (checkpointModelKey && checkpointModelKey !== modelKey(model) ? resolveModel(ctx, checkpointModelKey) : undefined)
			?? model;
		const systemPromptInput = systemPromptItems(ctx, model);
		const initialCurrentRequest = resolveRequest(ctx, snapshot, requestInput, historyModel, model, systemPromptInput, continuity, requestSignal);
		const excludedEntryId = initialCurrentRequest?.kind === "branch" ? initialCurrentRequest.entryId : undefined;
		const historyViews = inputViews(snapshot, historyModel, excludedEntryId, initialCurrentRequest?.excludeEntryIds);
		const historyInput = historyViews.effective.items;
		const rawHistoryInput = historyViews.fullHistory.items;
		const piContextInput = historyViews.piContext.items;
		// Reuse views only within this synchronous snapshot. Later awaits may change
		// the branch or checkpoint, so subsequent phases rebuild from current facts.
		const sameHistoryModel = isDeepStrictEqual(historyModel, model);
		const currentViews = sameHistoryModel ? historyViews : inputViews(snapshot, model, excludedEntryId, initialCurrentRequest?.excludeEntryIds);
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
			if (checkpoint.status === "valid" && requestInput && basePayload && !continuity.projectionAttempted) {
				continuity.projectionAttempted = true;
				continuity.projectionPolicy = resolveRequestProjection(branchBefore, model, continuity.tools ?? deps.getAllTools(), requestInput, basePayload);
				return prepareRequestInternal(model, ctx, requestInput, basePayload, skipAutomaticCompaction, continuity);
			}
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
			throw error;
		}
		const initialTailStart = (requestInput?.length ?? 0) - tail.length;
		continuity.requestSuffix = initialCurrentRequest ? initialCurrentRequest.suffix ?? [initialCurrentRequest.item] : tail;


		const activeAutomaticCompaction = automaticCompactionBySession.get(sessionId);
		if (activeAutomaticCompaction) {
			await activeAutomaticCompaction;
			ensureRequestCurrent();
			return prepareRequestInternal(model, ctx, requestInput, basePayload, true, continuity);
		}
		if (pending && pending.targetModelKey === modelKey(model)) {
			const shouldRun = pending.reason === "hash"
				|| deps.shouldAutoCompact?.({ ctx, model, input: [...currentHistoryInput, ...tail], reason: pending.reason }) === true;
			if (!shouldRun) {
				pendingBySession.delete(sessionId);
			} else {
				const startGeneration = generation;
				const gateEntryId = checkpoint.status === "valid" ? checkpoint.checkpoint.entryId : conversationLeafId(branchBefore);
				const gateLeafId = conversationLeafId(branchBefore);
				const transition = runRemoteCompaction(ctx, "model-transition", () =>
					runTransition(sessionId, ctx, pending.previousModel, pending.targetModelKey, model, basePayload, startGeneration, requestInput, hashes, false, requestSignal, continuity),
				);
				transitionBySession.set(sessionId, transition);
				try {
					await transition;
					ensureRequestCurrent();
					transitionCompactionCompleted = true;
				} catch (transitionError) {
					if (!(transitionError instanceof StaleCompactionError) && !isContextWindowCompactionError(transitionError)) {
						bypassFailedGate(ctx, model, gateEntryId, startGeneration, gateLeafId);
					}
					throw transitionError;
				} finally {
					if (transitionBySession.get(sessionId) === transition) transitionBySession.delete(sessionId);
				}
				skipAutomaticCompaction = false;
			}
		}

		await recoverCurrentModelInternal(model, ctx, hashes, basePayload, requestInput, false, requestSignal, continuity);
		ensureRequestCurrent();
		const recoveredCheckpoint = findNativeCheckpoint(deps.getBranch(ctx), modelKey(model));
		if (recoveredCheckpoint.status === "valid" && recoveredCheckpoint.checkpoint.details.modelKey !== modelKey(model)) {
			const checkpointHash = recoveredCheckpoint.checkpoint.details.compHash;
			if (hashesDiffer(checkpointHash, hashes.hashFor(model))) {
				throw new Error("The latest Codex compaction checkpoint requires model-transition compaction first.");
			}
		}
		let branch = deps.getBranch(ctx);
		{
			const activeTransition = transitionBySession.get(sessionId);
			if (activeTransition) {
				await activeTransition;
				ensureRequestCurrent();
				return prepareRequestInternal(model, ctx, requestInput, basePayload, false, continuity);
			}
			const activeAutomaticCompaction = automaticCompactionBySession.get(sessionId);
			if (activeAutomaticCompaction) {
				await activeAutomaticCompaction;
				ensureRequestCurrent();
			} else if (!skipAutomaticCompaction && !continuity.automaticCompactionAttempted) {
				const automaticSnapshot = requestSnapshot(branch, tools, continuity);
				const currentRequest = resolveRequest(ctx, automaticSnapshot, requestInput, model, model, systemPromptInput, continuity, requestSignal);
				const automaticExcludeId = currentRequest?.kind === "branch" ? currentRequest.entryId : undefined;
				const currentHistory = historyForRequest(automaticSnapshot, model, currentRequest);
				const protectedInput = currentRequest?.kind === "checkpoint" ? currentRequest.suffix ?? [currentRequest.item] : tail;
				const completeInput = [...currentHistory, ...protectedInput];
				const capacityRepair = currentHistory.some(item => item.type !== "compaction" && item.type !== "context_compaction")
					&& !fitsContextWindow(ctx, model, completeInput, basePayload, tools);
				if (
					currentHistory.length > 0
					&&
					(transitionCompactionCompleted || capacityRepair || hasBranchTailAfterCheckpoint(branch, automaticSnapshot.checkpoint(model), automaticExcludeId))
					&& deps.shouldAutoCompact?.({ ctx, model, input: completeInput })
				) {
					continuity.automaticCompactionAttempted = true;
					if (continuity.automaticAttemptKey) automaticAttempts.set(sessionId, continuity.automaticAttemptKey);
					const startGeneration = generation;
					const leafId = conversationLeafId(branch);
					const branchBefore = structuredClone(branch);
					const automaticCompaction = runRemoteCompaction(ctx, "automatic", async () => {
						const native = await deps.createCheckpoint({
							ctx,
							model,
							input: currentHistory,
							protectedInput,
							basePayload,
							signal: requestSignal,
							compactionHashes: hashes,
						});
						ensureCurrent(ctx, modelKey(model), startGeneration, requestSignal);
						if (conversationLeafId(deps.getBranch(ctx)) !== leafId) {
							throw new StaleCompactionError("The session changed while Codex automatic compaction was running.");
						}
						saveCheckpoint(ctx, model, preserveCurrentUser(native.details, currentRequest), currentRequest, branchBefore, continuity, requestSignal);
					});
					automaticCompactionBySession.set(sessionId, automaticCompaction);
					try {
						await automaticCompaction;
					} catch (automaticError) {
						ensureRequestCurrent();
						if (
							ctx.signal?.aborted
							|| isContextWindowCompactionError(automaticError)
							|| isFailClosedCompactionError(automaticError instanceof Error ? automaticError.message : String(automaticError))
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
		const finalSnapshot = requestSnapshot(branch, tools, continuity);
		const currentCheckpoint = finalSnapshot.checkpoint(model);
		if (currentCheckpoint.status === "bypassed") {
			const currentRequest = resolveRequest(ctx, finalSnapshot, requestInput, model, model, systemPromptInput, continuity, requestSignal);
			const rawReplay = [
				...finalSnapshot.view(model, "effective", {
					excludeEntryId: currentRequest?.kind === "branch" ? currentRequest.entryId : undefined, excludeEntryIds: currentRequest?.excludeEntryIds,
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
		const finalReceipt = validReceipt(ctx, model, finalSnapshot, requestInput, continuity, requestSignal);
		if (finalReceipt) {
			const tailIndex = finalReceipt.requestIndex - initialTailStart;
			if (tailIndex >= 0 && tailIndex < tail.length && isDeepStrictEqual(tail[tailIndex], finalReceipt.item)) {
				tail = tail.filter((_item, index) => index < tailIndex || index >= tailIndex + (finalReceipt.suffix?.length ?? 1));
			}
		} else {
			const initialBranchRequest = initialCurrentRequest?.kind === "branch" ? initialCurrentRequest : undefined;
			const checkpointContainsInitialRequest = initialBranchRequest
				&& currentCheckpoint.checkpoint.entryIndex > (snapshot.projection.sourceIndexById.get(initialBranchRequest.entryId) ?? Number.MAX_SAFE_INTEGER)
				&& checkpointContainsSuffix(currentCheckpoint.checkpoint.details, initialBranchRequest.suffix ?? [initialBranchRequest.item]);
			if (checkpointContainsInitialRequest) {
				const tailIndex = initialBranchRequest.requestIndex - initialTailStart;
				if (tailIndex >= 0 && tailIndex < tail.length && sameUserOccurrence(tail[tailIndex]!, initialBranchRequest.item)) {
					tail = tail.filter((_item, index) => index < tailIndex || index >= tailIndex + (initialBranchRequest.suffix?.length ?? 1));
				}
			} else if (initialBranchRequest?.suffixSources && currentCheckpoint.checkpoint.details.preservedInputSources) {
				const saved = currentCheckpoint.checkpoint.details;
				const savedBySource = new Map(saved.preservedInputSources!.map((source, index) => [source, saved.preservedInput?.[index]]));
				const start = initialBranchRequest.requestIndex - initialTailStart;
				tail = tail.filter((item, index) => {
					const source = initialBranchRequest.suffixSources?.[index - start];
					return !source || !isDeepStrictEqual(item, savedBySource.get(source));
				});
			} else {
				const preservedUser = checkpointPreservedCurrentUser(branch, requestInput, modelKey(model), currentCheckpoint);
				if (preservedUser) {
					const preservedUserIndex = tail.findLastIndex((item) =>
						item.role === "user" && sameUserOccurrence(item, preservedUser),
					);
					if (preservedUserIndex >= 0) tail = tail.filter((_item, index) => index !== preservedUserIndex);
				}
			}
		}
		const finalRequest = resolveRequest(ctx, finalSnapshot, requestInput, model, model, systemPromptInput, continuity, requestSignal);
		return [
			...finalSnapshot.view(model, "effective", {
				excludeEntryId: finalRequest?.kind === "branch" ? finalRequest.entryId : undefined, excludeEntryIds: finalRequest?.excludeEntryIds,
				allowCheckpointModelMismatch: true,
			}).items,
			...tail,
		];
	};
	const prepareRequest = async (
		model: Model<any>,
		ctx: ExtensionContext,
		requestInput: ResponseItem[] | undefined,
		basePayload?: JsonObject,
		skipAutomaticCompaction = false,
	): Promise<ResponseItem[] | undefined> => {
		const sessionId = ctx.sessionManager.getSessionId();
		const startGeneration = generation;
		const operationSignal = ctx.signal;
		const initialBranch = structuredClone(deps.getBranch(ctx));
		const initialTools = structuredClone(deps.getAllTools());
		const initialPrompt = ctx.getSystemPrompt();
		const originalModel = model;
		model = structuredClone(model);
		requestInput = requestInput && structuredClone(requestInput);
		basePayload = basePayload && structuredClone(basePayload);
		const assertEvidence = () => {
			if (!isDeepStrictEqual(initialTools, deps.getAllTools()) || ctx.getSystemPrompt() !== initialPrompt
				|| !isDeepStrictEqual(originalModel, model) || (ctx.model && !isDeepStrictEqual(ctx.model, model))) throw new StaleCompactionError("The request declarations, prompt or model changed while preparing Codex compaction.");
		};
		const projectionPolicy = requestInput && basePayload && typeof basePayload.instructions === "string"
			&& initialBranch.some(entry => entry.type === "message" && entry.message.role === "system")
			? resolveRequestProjection(initialBranch, model, initialTools, requestInput, basePayload) : undefined;
		const hashes = isOpenAICodexModel(model)
			? await deps.resolveCompactionHashes(ctx, model, operationSignal)
			: emptyCompactionHashSnapshot("unsupported");
		ensureCurrent(ctx, modelKey(model), startGeneration, operationSignal);
		assertEvidence();
		if (!isDeepStrictEqual(initialBranch, deps.getBranch(ctx))) throw new StaleCompactionError("The session changed while resolving Codex metadata.");
		if (ctx.sessionManager.getSessionId() !== sessionId || ctx.signal !== operationSignal) {
			throw new StaleCompactionError("The session changed while resolving Codex metadata.");
		}
		const automaticAttemptKey = accountingFingerprint({ model, hash: hashes.hashFor(model), prompt: initialPrompt, tools: initialTools,
			current: requestInput?.findLast(item => item.role === "user"),
			history: createBranchProjectionSnapshot(initialBranch).fullHistory().flatMap(entry => entry.messages
				.filter(message => message.role !== "assistant" || (message.stopReason !== "error" && message.stopReason !== "aborted"))
				.map(message => [entry.sourceEntry.id, message])) });
		const result = await prepareRequestInternal(model, ctx, requestInput, basePayload, skipAutomaticCompaction, {
			sessionId,
			generation: startGeneration,
			targetModelKey: modelKey(model),
			requestInput,
			compactionHashes: hashes,
			signal: operationSignal,
			assertEvidence,
			tools: initialTools,
			projectionPolicy,
			projectionAttempted: projectionPolicy !== undefined,
			automaticAttemptKey,
			automaticCompactionAttempted: automaticAttempts.get(sessionId) === automaticAttemptKey,
		});
		if (basePayload) observedRequests.set(sessionId, { branch: accountingFingerprint(deps.getBranch(ctx)), tools: accountingFingerprint(initialTools),
			prompt: initialPrompt, model: modelKey(model), payload: basePayload, policy: projectionPolicy });
		return result;
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
		prepareCompactionPlan: async (model: Model<any>, ctx: ExtensionContext, excludeLastAssistantError = false, signal?: AbortSignal, basePayload?: JsonObject) => {
			const sessionId = ctx.sessionManager.getSessionId();
			const branch = structuredClone(deps.getBranch(ctx));
			const tools = structuredClone(deps.getAllTools());
			const prompt = ctx.getSystemPrompt();
			const startGeneration = generation;
			const modelSnapshot = structuredClone(model);
			const assertCurrent = () => {
				ensureCurrent(ctx, modelKey(modelSnapshot), startGeneration, signal ?? ctx.signal);
				if (ctx.sessionManager.getSessionId() !== sessionId || !isDeepStrictEqual(branch, deps.getBranch(ctx))
					|| !isDeepStrictEqual(tools, deps.getAllTools()) || ctx.getSystemPrompt() !== prompt
					|| !isDeepStrictEqual(modelSnapshot, ctx.model ?? model)) throw new Error("The session or declarations changed while preparing manual Codex compaction.");
			};
			const policy = loadConfig(ctx.cwd ?? "", ctx.isProjectTrusted?.() ?? false).manualProjection;
			const known = observedRequests.get(sessionId);
			const observed = !policy && known?.branch === accountingFingerprint(branch) && known.tools === accountingFingerprint(tools)
				&& known.prompt === prompt && known.model === modelKey(model) ? known : undefined;
			if (!policy && !observed?.policy && tools.length > 0) throw new Error("Codex compaction outside a verified provider request needs a declared manualProjection policy to verify tool visibility.");
			const pending = transitionBySession.get(sessionId);
			if (pending) await pending;
			assertCurrent();
			const snapshot = createBranchInputSnapshot({ branch, tools,
				projectionPolicy: policy ? { hiddenNames: new Set(policy.hiddenTools), ...(policy.forcedPrompt !== undefined ? { forcedPrompt: policy.forcedPrompt } : {}) } : observed?.policy });
			const plan = compactionInputPlan(snapshot, model, { excludeLastAssistantError });
			const wire = snapshot.view(model, "effective", { allowCheckpointModelMismatch: true, excludeLastAssistantError });
			return { ...plan, assertCurrent, basePayload: { ...basePayload, instructions: typeof observed?.payload.instructions === "string" ? observed.payload.instructions : wire.instructions || prompt,
				tools: observed ? (Array.isArray(observed.payload.tools) ? observed.payload.tools : []) : wire.tools ?? [] } };
		},
	};
}
