import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
	convertToLlm,
	sessionEntryToContextMessages,
	type SessionEntry,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { calculateCost, type Message, type Model, type Usage } from "@earendil-works/pi-ai";

export const NATIVE_COMPACTION_KIND = "openai-codex-native-compaction";
export const NATIVE_COMPACTION_BYPASS_KIND = "openai-codex-native-compaction-bypass";
export const FAILED_REQUEST_KIND = "openai-codex-failed-request";
export const NATIVE_COMPACTION_VERSION = 2;
export const NATIVE_COMPACTION_BYPASS_VERSION = 1;
export const REMOTE_COMPACTION_FEATURE = "remote_compaction_v2";
const RETAINED_MESSAGE_TOKEN_BUDGET = 64_000;

const MAX_REMOTE_RETRIES = 2;
const V2_COMPACTION_IDLE_TIMEOUT_MS = 300_000;
const MAX_RETAINED_AGENT_MESSAGE_TOKENS = 10_000;

const FAIL_CLOSED_ERROR_PATTERN = /(?:credential|policy|auth(?:entication|orization)?|access[_ -]?denied|malformed|misalignment[_ -]?policy|cyber[_ -]?policy|invalid[_ -]?image|safety[_ -]?policy|policy[_ -]?(?:violation|denied|failure|failed)|unauthorized|forbidden|permission|api[_ -]?key|invalid[_ -]?api[_ -]?key|auth(?:entication)?[_ -]?(?:failure|failed|denied|error)|(?:invalid|expired|bearer|refresh)[_ -]?token|cancel(?:led|ed|lation)?|aborted|insufficient[_ -]?quota|quota[_ -]?exceeded|usage[_ -]?not[_ -]?included|available[_ -]?balance|insufficient[_ -]?funds|out[_ -]?of[_ -]?budget|billing|protocol[_ -]?(?:failure|error))/i;
const NON_RETRYABLE_FALLBACK_ERROR_CODES = new Set([
	"context_length_exceeded",
	"context_window_exceeded",
	"invalid_prompt",
	"invalid_request",
	"invalid_request_error",
	"model_not_found",
	"usage_limit_reached",
	"usage_limit_exceeded",
	"retry_limit",
]);
const RETRYABLE_COMPACTION_ERROR_CODES = new Set([
	"internal_server_error",
	"server_error",
	"service_unavailable",
	"server_overloaded",
	"server_is_overloaded",
	"server_overload",
	"rate_limit_reached",
	"rate_limit_exceeded",
	"usage_limit_reached",
	"usage_limit_exceeded",
	"slow_down",
	"timeout",
	"gateway_timeout",
	"upstream_error",
	"connection_reset",
	"connection_closed",
	"try_again",
	"internal_server",
	"gateway_error",
	"temporary_unavailable",
	"temporarily_unavailable",
]);
const SSE_MODEL_FALLBACK_ERROR_CODES = new Set([
	"context_length_exceeded",
	"context_window_exceeded",
	"invalid_prompt",
	"model_not_found",
	"server_overloaded",
	"server_is_overloaded",
	"server_overload",
	"slow_down",
]);
const USAGE_LIMIT_MESSAGE_PATTERN = /(?:usage[_ -]?(?:limit|quota|reached|exhausted|exceeded)|quota(?:[_ -]?(?:reached|exhausted|exceeded|depleted|limit))?)/i;
const RETRYABLE_COMPACTION_ERROR_PATTERN = /(?:server[_ -]?(?:error|(?:is[_ -]?)?overload(?:ed)?)|service[_ -]?unavailable|temporar(?:y|ily)[_ -]?unavailable|upstream|internal[_ -]?server|gateway|timeout|try[_ -]?again|connection[_ -]?(?:reset|closed)|rate[_ -]?limit|slow[_ -]?down)/i;

export function isFailClosedCompactionError(message: string): boolean {
	return FAIL_CLOSED_ERROR_PATTERN.test(message);
}

export function isContextWindowCompactionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	if (isFailClosedCompactionError(message) || USAGE_LIMIT_MESSAGE_PATTERN.test(message) || /invalid_prompt/i.test(message)) return false;
	if (typeof error === "object" && error !== null && "contextOverflowRecovery" in error) {
		return (error as { contextOverflowRecovery?: unknown }).contextOverflowRecovery === true;
	}
	const code = compactionErrorCode(error);
	if (code !== undefined) return code === "context_length_exceeded" || code === "context_window_exceeded";
	if (compactionRetry(error) !== undefined) return false;
	return /(?:context_length_exceeded|context_window_exceeded)/i.test(message);
}

export type JsonObject = Record<string, unknown>;
export type ResponseItem = JsonObject & { type?: string };

export type FailedRequestDiagnostics = {
	phase: "before_provider_request";
	code: string;
	recoveryAttempted: boolean;
};

export type FailedRequestDetails = {
	kind: typeof FAILED_REQUEST_KIND;
	entryId: string;
	/** Legacy markers may contain this; new markers resolve it from the branch in memory. */
	content?: unknown;
	diagnostics?: FailedRequestDiagnostics;
};

export interface NativeCompactionDetails {
	kind: typeof NATIVE_COMPACTION_KIND;
	version: typeof NATIVE_COMPACTION_VERSION;
	modelKey: string;
	compHash?: string;
	preservedInput?: ResponseItem[];
	replacementHistory: ResponseItem[];
}

export type NativeCheckpoint = {
	entryIndex: number;
	entryId: string;
	details: NativeCompactionDetails;
};

export type NativeCompactionBypass = {
	kind: typeof NATIVE_COMPACTION_BYPASS_KIND;
	version: typeof NATIVE_COMPACTION_BYPASS_VERSION;
	gateEntryId: string;
	targetModelKey: string;
};

export type CheckpointLookup =
	| { status: "none" }
	| { status: "invalid"; entryIndex: number; entryId: string }
	| { status: "bypassed"; entryIndex: number; entryId: string; bypass: NativeCompactionBypass }
	| { status: "valid"; checkpoint: NativeCheckpoint };

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOpenAICodexModel(model: unknown): model is Model<"openai-codex-responses"> {
	if (!isJsonObject(model)) return false;
	return model.provider === "openai-codex" && model.api === "openai-codex-responses";
}

export function modelKey(model: Pick<Model<any>, "provider" | "api" | "id">): string {
	return `${model.provider}:${model.api}:${model.id}`;
}

function isContentItem(value: unknown): boolean {
	if (!isJsonObject(value) || typeof value.type !== "string") return false;
	switch (value.type) {
		case "input_text":
		case "output_text":
			return typeof value.text === "string";
		case "input_image":
			return typeof value.image_url === "string"
				&& (value.detail === undefined || ["auto", "low", "high", "original"].includes(value.detail as string));
		case "input_audio":
			return typeof value.audio_url === "string";
		default:
			return false;
	}
}

function isAgentMessageContent(value: unknown): boolean {
	if (!isJsonObject(value) || typeof value.type !== "string") return false;
	return value.type === "input_text"
		? typeof value.text === "string"
		: value.type === "encrypted_content" && typeof value.encrypted_content === "string";
}

function isReasoningSummary(value: unknown): boolean {
	return isJsonObject(value) && value.type === "summary_text" && typeof value.text === "string";
}

function isReasoningContent(value: unknown): boolean {
	return isJsonObject(value)
		&& (value.type === "reasoning_text" || value.type === "text")
		&& typeof value.text === "string";
}

function isToolOutputContent(value: unknown): boolean {
	if (!isJsonObject(value) || typeof value.type !== "string") return false;
	return value.type === "input_text"
		? typeof value.text === "string"
		: value.type === "input_image"
			? typeof value.image_url === "string"
				&& (value.detail === undefined || ["auto", "low", "high", "original"].includes(value.detail as string))
			: value.type === "input_audio"
				? typeof value.audio_url === "string"
				: value.type === "encrypted_content" && typeof value.encrypted_content === "string";
}

function isToolOutput(value: unknown): boolean {
	return typeof value === "string" || (Array.isArray(value) && value.every(isToolOutputContent));
}

function isResponseItem(value: unknown): value is ResponseItem {
	if (!isJsonObject(value)) return false;
	if (typeof value.type !== "string") {
		return typeof value.role === "string"
			&& (typeof value.content === "string" || (Array.isArray(value.content) && value.content.every(isContentItem)));
	}
	switch (value.type) {
		case "additional_tools":
			return typeof value.role === "string" && Array.isArray(value.tools) && value.tools.every(isJsonObject);
		case "message":
			return typeof value.role === "string"
				&& (typeof value.content === "string" || (Array.isArray(value.content) && value.content.every(isContentItem)));
		case "agent_message":
			return Array.isArray(value.content)
				&& value.content.every(isAgentMessageContent)
				&& typeof value.author === "string"
				&& typeof value.recipient === "string";
		case "function_call":
			return typeof value.call_id === "string"
				&& typeof value.name === "string"
				&& typeof value.arguments === "string"
				&& (value.encrypted_function_args === undefined
					|| (Array.isArray(value.encrypted_function_args) && value.encrypted_function_args.every((item) => typeof item === "string")));
		case "function_call_output":
		case "custom_tool_call_output":
			return typeof value.call_id === "string" && isToolOutput(value.output);
		case "custom_tool_call":
			return typeof value.call_id === "string" && typeof value.name === "string" && typeof value.input === "string";
		case "reasoning":
			return (value.encrypted_content === undefined || typeof value.encrypted_content === "string")
				&& (value.summary === undefined || (Array.isArray(value.summary) && value.summary.every(isReasoningSummary)))
				&& (value.content === undefined || (Array.isArray(value.content) && value.content.every(isReasoningContent)))
				&& (value.encrypted_content !== undefined || value.summary !== undefined || value.content !== undefined);
		case "compaction":
		case "context_compaction":
			return typeof value.encrypted_content === "string";
		case "tool_search_call":
			return (value.call_id === undefined || typeof value.call_id === "string") && typeof value.execution === "string";
		case "tool_search_output":
			return (value.call_id === undefined || typeof value.call_id === "string")
				&& typeof value.status === "string"
				&& typeof value.execution === "string"
				&& Array.isArray(value.tools)
				&& value.tools.every(isJsonObject);
		default:
			return false;
	}
}

export function parseNativeCompactionDetails(value: unknown): NativeCompactionDetails | undefined {
	if (!isJsonObject(value)) return undefined;
	if (value.kind !== NATIVE_COMPACTION_KIND || value.version !== NATIVE_COMPACTION_VERSION) return undefined;
	if (typeof value.modelKey !== "string" || !Array.isArray(value.replacementHistory)) return undefined;
	if (value.compHash !== undefined && typeof value.compHash !== "string") return undefined;

	const replacementHistory = value.replacementHistory.filter(isResponseItem);
	if (replacementHistory.length !== value.replacementHistory.length) return undefined;
	const preservedInput = Array.isArray(value.preservedInput) ? value.preservedInput.filter(isResponseItem) : undefined;
	if (value.preservedInput !== undefined) {
		if (!Array.isArray(value.preservedInput) || preservedInput === undefined || preservedInput.length !== value.preservedInput.length) return undefined;
	}
	if (value.strategy !== undefined && value.strategy !== "v2") return undefined;
	const compactionItems = replacementHistory.filter((item) => item.type === "compaction");
	if (
		compactionItems.length !== 1 ||
		typeof compactionItems[0]?.encrypted_content !== "string" ||
		replacementHistory.at(-1)?.type !== "compaction"
	) {
		return undefined;
	}

	return {
		kind: NATIVE_COMPACTION_KIND,
		version: NATIVE_COMPACTION_VERSION,
		modelKey: value.modelKey,
		...(typeof value.compHash === "string" ? { compHash: value.compHash } : {}),
		...(preservedInput ? { preservedInput: preservedInput.map((item) => structuredClone(item)) } : {}),
		replacementHistory: replacementHistory.map((item) => structuredClone(item)),
	};
}

export function parseNativeCompactionBypass(value: unknown): NativeCompactionBypass | undefined {
	if (!isJsonObject(value)) return undefined;
	if (value.kind !== NATIVE_COMPACTION_BYPASS_KIND || value.version !== NATIVE_COMPACTION_BYPASS_VERSION) return undefined;
	if (typeof value.gateEntryId !== "string" || !value.gateEntryId || typeof value.targetModelKey !== "string" || !value.targetModelKey) return undefined;
	return {
		kind: NATIVE_COMPACTION_BYPASS_KIND,
		version: NATIVE_COMPACTION_BYPASS_VERSION,
		gateEntryId: value.gateEntryId,
		targetModelKey: value.targetModelKey,
	};
}

export function findNativeCheckpoint(branch: SessionEntry[], targetModelKey?: string): CheckpointLookup {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (!entry) continue;
		if (entry.type === "custom" && entry.customType === NATIVE_COMPACTION_BYPASS_KIND) {
			const bypass = parseNativeCompactionBypass(entry.data);
			if (bypass && (targetModelKey === undefined || bypass.targetModelKey === targetModelKey)) {
				return { status: "bypassed", entryIndex: index, entryId: entry.id, bypass };
			}
			continue;
		}

		let rawDetails: unknown;
		if (entry.type === "compaction") {
			if (!isJsonObject(entry.details) || entry.details.kind !== NATIVE_COMPACTION_KIND) {
				return { status: "none" };
			}
			rawDetails = entry.details;
		} else if (entry.type === "custom" && entry.customType === NATIVE_COMPACTION_KIND) {
			rawDetails = entry.data;
		} else {
			continue;
		}

		if (isJsonObject(rawDetails) && rawDetails.strategy === "token-budget") return { status: "none" };
		if (isJsonObject(rawDetails) && (rawDetails.version === 1 || rawDetails.strategy === "v1")) {
			return { status: "none" };
		}
		const details = parseNativeCompactionDetails(rawDetails);
		if (details) {
			return {
				status: "valid",
				checkpoint: { entryIndex: index, entryId: entry.id, details },
			};
		}
		return { status: "invalid", entryIndex: index, entryId: entry.id };
	}
	return { status: "none" };
}

function assistantInputTokens(entry: SessionEntry): number | undefined {
	if (entry.type !== "message") return undefined;
	const message = entry.message as unknown as JsonObject;
	if (
		message.role !== "assistant"
		|| message.provider !== "openai-codex"
		|| message.api !== "openai-codex-responses"
		|| message.stopReason === "error"
		|| message.stopReason === "aborted"
	) return undefined;
	const usage = isJsonObject(message.usage) ? message.usage : undefined;
	if (!usage || typeof usage.input !== "number" || !Number.isFinite(usage.input)) return undefined;
	const cacheRead = typeof usage.cacheRead === "number" && Number.isFinite(usage.cacheRead) ? usage.cacheRead : 0;
	const cacheWrite = typeof usage.cacheWrite === "number" && Number.isFinite(usage.cacheWrite) ? usage.cacheWrite : 0;
	return Math.max(0, usage.input + cacheRead + cacheWrite);
}

/**
 * Finds the Codex body-after-prefix baseline for the active compaction window.
 * Server-observed assistant usage wins; a current native checkpoint provides the
 * estimate used before the first response in a new window.
 */
export function estimateCompactionWindowPrefillTokens(params: {
	branch: SessionEntry[];
	stablePrefixTokens: number;
	targetModelKey?: string;
}): number | undefined {
	const checkpoint = findNativeCheckpoint(params.branch, params.targetModelKey);
	const checkpointIndex = checkpoint.status === "valid" ? checkpoint.checkpoint.entryIndex : -1;
	const observed = params.branch.slice(checkpointIndex + 1).map(assistantInputTokens).find((value) => value !== undefined);
	if (observed !== undefined) return observed;
	if (checkpoint.status !== "valid") return undefined;
	return approximateResponseItemTokens(checkpoint.checkpoint.details.replacementHistory)
		+ Math.max(0, Math.floor(params.stablePrefixTokens));
}

// Pi's extension loader does not expose Pi AI's internal Responses converter.
function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Matches Pi AI's deterministic shortHash for cross-provider Responses item IDs. */
function piShortHash(value: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		h1 = Math.imul(h1 ^ code, 2654435761);
		h2 = Math.imul(h2 ^ code, 1597334677);
	}
	h1 = (Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)) | 0;
	h2 = (Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)) | 0;
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function normalizedItemId(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64).replace(/_+$/, "");
	return sanitized.startsWith("fc_") ? sanitized : `fc_${sanitized}`.slice(0, 64);
}

function textSignature(value: unknown): { id?: string; phase?: "commentary" | "final_answer" } {
	if (typeof value !== "string" || !value) return {};
	try {
		const parsed = JSON.parse(value) as JsonObject;
		return {
			id: typeof parsed.id === "string" ? parsed.id : undefined,
			phase: parsed.phase === "commentary" || parsed.phase === "final_answer" ? parsed.phase : undefined,
		};
	} catch {
		return { id: value };
	}
}

function contentToUserParts(content: unknown): unknown[] {
	if (typeof content === "string") return content ? [{ type: "input_text", text: content }] : [];
	if (!Array.isArray(content)) return [];
	const parts: unknown[] = [];
	for (const part of content) {
		if (!isJsonObject(part)) continue;
		if (part.type === "text" && typeof part.text === "string") {
			parts.push({ type: "input_text", text: part.text });
		} else if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
			parts.push({ type: "input_image", detail: "auto", image_url: `data:${part.mimeType};base64,${part.data}` });
		}
	}
	return parts;
}

function toolResultOutput(message: JsonObject, model: Model<any>): unknown {
	const content = Array.isArray(message.content) ? message.content : [];
	const text = content
		.flatMap((part) => isJsonObject(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])
		.join("\n");
	const images = content.filter((part) => isJsonObject(part) && part.type === "image");
	if (images.length === 0 || !model.input.includes("image")) {
		return text || (images.length > 0 ? "(see attached image)" : "(no tool output)");
	}
	return [
		...(text ? [{ type: "input_text", text }] : []),
		...images.flatMap((part) =>
			typeof part.data === "string" && typeof part.mimeType === "string"
				? [{ type: "input_image", detail: "auto", image_url: `data:${part.mimeType};base64,${part.data}` }]
				: [],
		),
	];
}

function responseTool(tool: ToolInfo, deferLoading: boolean, supportsStrictMode: boolean): JsonObject {
	return {
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as unknown,
		...(supportsStrictMode ? { strict: null } : {}),
		...(deferLoading ? { defer_loading: true } : {}),
	};
}

function messagesToResponseItems(
	model: Model<any>,
	messages: Message[],
	tools: ToolInfo[],
	loadedToolNames = new Set<string>(),
): ResponseItem[] {
	const items: ResponseItem[] = [];
	const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
	const compat = model.compat as { supportsAdditionalTools?: boolean; supportsToolSearch?: boolean; supportsStrictMode?: boolean } | undefined;
	const supportsAdditionalTools = compat?.supportsAdditionalTools === true;
	const supportsToolSearch = compat?.supportsToolSearch === true;
	const supportsStrictMode = compat?.supportsStrictMode !== false;
	const pendingToolCalls = new Map<string, string>();
	const usedToolNames = new Set<string>();
	for (const message of messages as unknown as JsonObject[]) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (isJsonObject(block) && block.type === "toolCall" && typeof block.name === "string") usedToolNames.add(block.name);
		}
	}
	const flushOrphanedToolCalls = () => {
		for (const callId of pendingToolCalls.values()) {
			items.push({ type: "function_call_output", call_id: callId, output: "No result provided" });
			messageIndex++;
		}
		pendingToolCalls.clear();
	};
	let messageIndex = 0;

	for (const message of messages as unknown as JsonObject[]) {
		const itemCountBefore = items.length;
		if (message.role === "user") {
			flushOrphanedToolCalls();
			const content = contentToUserParts(message.content);
			if (content.length === 0) continue;
			items.push({ role: "user", content });
		} else if (message.role === "assistant" && Array.isArray(message.content)) {
			flushOrphanedToolCalls();
			if (message.stopReason === "error" || message.stopReason === "aborted") continue;
			const sameModel = message.provider === model.provider
				&& message.api === model.api
				&& message.model === model.id;
			const sameProviderApi = message.provider === model.provider && message.api === model.api;
			let textIndex = 0;
			for (const block of message.content) {
				if (!isJsonObject(block)) continue;
				if (block.type === "thinking") {
					if (!sameModel && block.redacted === true) continue;
					if (sameModel && typeof block.thinkingSignature === "string") {
						try {
							const reasoning = JSON.parse(block.thinkingSignature);
							if (isJsonObject(reasoning) && reasoning.type === "reasoning") items.push(structuredClone(reasoning));
						} catch {}
					} else if (!sameModel && typeof block.thinking === "string" && block.thinking.trim()) {
						const id = textIndex === 0 ? `msg_pi_${messageIndex}` : `msg_pi_${messageIndex}_${textIndex}`;
						textIndex++;
						items.push({
							type: "message",
							role: "assistant",
							id,
							status: "completed",
							phase: undefined,
							content: [{ type: "output_text", text: block.thinking, annotations: [] }],
						});
					}
					continue;
				}
				if (block.type === "text" && typeof block.text === "string") {
					const signature = sameModel ? textSignature(block.textSignature) : {};
					const fallbackId = textIndex === 0 ? `msg_pi_${messageIndex}` : `msg_pi_${messageIndex}_${textIndex}`;
					textIndex++;
					const rawId = signature.id || fallbackId;
					const id = rawId.length <= 64 ? rawId : `msg_${shortHash(rawId)}`;
					items.push({
						type: "message",
						role: "assistant",
						id,
						status: "completed",
						content: [{ type: "output_text", text: block.text, annotations: [] }],
						phase: signature.phase,
					});
					continue;
				}
				if (block.type === "toolCall" && typeof block.id === "string") {
					const [callId, rawItemId] = block.id.split("|");
					pendingToolCalls.set(block.id, callId);
					const itemId = sameProviderApi && !sameModel
						? undefined
						: message.provider !== model.provider || message.api !== model.api
							? (rawItemId ? `fc_${piShortHash(rawItemId)}` : undefined)
							: normalizedItemId(rawItemId);
					items.push({
						type: "function_call",
						call_id: callId,
						id: itemId,
						name: String(block.name ?? ""),
						arguments: JSON.stringify(block.arguments ?? {}),
					});
				}
			}
		} else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
			const [callId] = message.toolCallId.split("|");
			pendingToolCalls.delete(message.toolCallId);
			items.push({ type: "function_call_output", call_id: callId, output: toolResultOutput(message, model) });

			const addedTools = (supportsAdditionalTools || supportsToolSearch) && Array.isArray(message.addedToolNames)
				? message.addedToolNames.flatMap((name) => {
					if (typeof name !== "string" || usedToolNames.has(name) || loadedToolNames.has(name)) return [];
					const tool = toolsByName.get(name);
					if (!tool) return [];
					loadedToolNames.add(name);
					return [tool];
				})
				: [];
			if (addedTools.length > 0 && supportsAdditionalTools) {
				items.push({
					type: "additional_tools",
					role: "developer",
					tools: addedTools.map((tool) => responseTool(tool, false, supportsStrictMode)),
				});
			} else if (addedTools.length > 0 && supportsToolSearch) {
				const searchCallId = `pi_tool_load_${piShortHash(`${message.toolCallId}:${addedTools.map((tool) => tool.name).join(",")}`)}`;
				items.push({
					type: "tool_search_call",
					call_id: searchCallId,
					execution: "client",
					status: "completed",
					arguments: { query: addedTools.map((tool) => tool.name).join(" "), limit: addedTools.length },
				});
				items.push({
					type: "tool_search_output",
					call_id: searchCallId,
					execution: "client",
					status: "completed",
					tools: addedTools.map((tool) => responseTool(tool, true, supportsStrictMode)),
				});
			}
		}
		if (message.role === "assistant" && items.length === itemCountBefore) continue;
		messageIndex++;
	}
	flushOrphanedToolCalls();

	return items;
}

export function loadedToolNamesFromItems(items: ResponseItem[]): Set<string> {
	const loadedToolNames = new Set<string>();
	for (const item of items) {
		if ((item.type !== "additional_tools" && item.type !== "tool_search_output") || !Array.isArray(item.tools)) continue;
		for (const tool of item.tools) {
			if (isJsonObject(tool) && typeof tool.name === "string") loadedToolNames.add(tool.name);
		}
	}
	return loadedToolNames;
}

function entriesToResponseItems(
	model: Model<any>,
	entries: SessionEntry[],
	tools: ToolInfo[],
	includeCompactionSummary = false,
	loadedToolNames = new Set<string>(),
): ResponseItem[] {
	const messages = entries
		.filter((entry) => includeCompactionSummary || entry.type !== "compaction")
		.flatMap((entry) => sessionEntryToContextMessages(entry));
	return messagesToResponseItems(model, convertToLlm(messages), tools, loadedToolNames);
}

export function fullInputForBranch(params: {
	branch: SessionEntry[];
	model: Model<any>;
	tools: ToolInfo[];
}): ResponseItem[] {
	return entriesToResponseItems(params.model, params.branch, params.tools);
}

export function piContextInputForBranch(params: {
	branch: SessionEntry[];
	model: Model<any>;
	tools: ToolInfo[];
}): ResponseItem[] {
	const checkpoint = findNativeCheckpoint(params.branch, modelKey(params.model));
	if (checkpoint.status === "invalid" || checkpoint.status === "bypassed") return fullInputForBranch(params);
	const remoteCheckpoint = checkpoint.status === "valid";
	const boundaryEnd = checkpoint.status === "valid" ? checkpoint.checkpoint.entryIndex : params.branch.length;
	let firstKeptEntryId: string | undefined;
	let compactionIndex = -1;
	for (let index = boundaryEnd - 1; index >= 0; index--) {
		const candidate = params.branch[index];
		if (candidate?.type === "compaction" && typeof candidate.firstKeptEntryId === "string") {
			firstKeptEntryId = candidate.firstKeptEntryId;
			compactionIndex = index;
			break;
		}
	}
	if (checkpoint.status === "valid") {
		const entry = params.branch[checkpoint.checkpoint.entryIndex];
		if (entry?.type === "compaction" && typeof entry.firstKeptEntryId === "string") {
			firstKeptEntryId = entry.firstKeptEntryId;
			compactionIndex = checkpoint.checkpoint.entryIndex;
		}
	}
	if (!firstKeptEntryId) return fullInputForBranch(params);
	const firstKeptIndex = params.branch.findIndex((candidate) => candidate.id === firstKeptEntryId);
	if (firstKeptIndex < 0) return fullInputForBranch(params);
	const contextEntries = remoteCheckpoint || compactionIndex < 0
		? params.branch.slice(firstKeptIndex)
		: [
			params.branch[compactionIndex]!,
			...params.branch.slice(firstKeptIndex, compactionIndex),
			...params.branch.slice(compactionIndex + 1),
		];
	return entriesToResponseItems(params.model, contextEntries, params.tools, !remoteCheckpoint);
}

export function effectiveInputForBranch(params: {
	branch: SessionEntry[];
	model: Model<any>;
	tools: ToolInfo[];
	excludeLastAssistantError?: boolean;
	allowCheckpointModelMismatch?: boolean;
}): ResponseItem[] {
	let branch = params.branch;
	if (params.excludeLastAssistantError) {
		const lastAssistantIndex = branch.findLastIndex(
			(entry) => entry.type === "message" && entry.message.role === "assistant",
		);
		if (lastAssistantIndex >= 0) {
			branch = branch.filter((_entry, index) => index !== lastAssistantIndex);
		}
	}

	const checkpoint = findNativeCheckpoint(branch, modelKey(params.model));
	if (checkpoint.status === "valid") {
		if (
			!params.allowCheckpointModelMismatch
			&& checkpoint.checkpoint.details.modelKey !== modelKey(params.model)
		) {
			throw new Error("The latest Codex compaction checkpoint requires model-transition compaction first.");
		}
		const prefix = [
			...checkpoint.checkpoint.details.replacementHistory.map((item) => structuredClone(item)),
			...(checkpoint.checkpoint.details.preservedInput ?? []).map((item) => structuredClone(item)),
		];
		return [
			...prefix,
			...entriesToResponseItems(
				params.model,
				branch.slice(checkpoint.checkpoint.entryIndex + 1),
				params.tools,
				false,
				loadedToolNamesFromItems(prefix),
			),
		];
	}

	return piContextInputForBranch({ branch, model: params.model, tools: params.tools });
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => {
			if (!isJsonObject(part)) return [];
			if (typeof part.text === "string") return [part.text];
			if (typeof part.encrypted_content === "string") return [part.encrypted_content];
			return [];
		})
		.join("");
}

function textOnly(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(textOnly).join("");
	if (!isJsonObject(value)) return "";
	if (value.type === "input_image" || value.type === "image_url") return "";
	if (typeof value.text === "string") return value.text;
	if (typeof value.encrypted_content === "string") return value.encrypted_content;
	return Object.values(value).map(textOnly).join("");
}

function responseItemText(item: ResponseItem): string {
	if (item.type === "message" || item.type === "agent_message" || item.type === undefined) {
		return contentText(item.content);
	}
	if (item.type === "function_call_output") {
		if (typeof item.output === "string") return item.output;
		return imagePartCount(item.output) > 0 ? textOnly(item.output) : JSON.stringify(item.output ?? "");
	}
	if (item.type === "function_call") return typeof item.arguments === "string" ? item.arguments : "";
	return "";
}

export function approximateTokenCount(value: unknown): number {
	const encoded = JSON.stringify(value);
	return Math.max(1, Math.ceil((encoded?.length ?? 0) / 4));
}

function imagePartCount(value: unknown): number {
	if (Array.isArray(value)) return value.reduce((total, part) => total + imagePartCount(part), 0);
	if (!isJsonObject(value)) return 0;
	if (value.type === "input_image" || value.type === "image_url") return 1;
	return Object.values(value).reduce<number>((total, part) => total + imagePartCount(part), 0);
}

function approximateTokens(item: ResponseItem): number {
	const imageTokens = imagePartCount(item) * 1_200;
	if (imageTokens > 0) return imageTokens + Math.max(0, Math.ceil(responseItemText(item).length / 4));
	if (item.type === "reasoning" || item.type === "compaction" || item.type === "context_compaction") {
		return approximateTokenCount(item);
	}
	if (item.type === "function_call" || (typeof item.type === "string" && item.type.includes("tool") && item.type !== "function_call_output")) {
		return Math.max(1, Math.ceil(JSON.stringify(item).length / 4));
	}
	return Math.max(1, Math.ceil(responseItemText(item).length / 4));
}

export function approximateResponseItemTokens(items: ResponseItem[]): number {
	return items.reduce((total, item) => total + approximateTokens(item), 0);
}

export function approximateCompactionRequestTokens(params: {
	input: ResponseItem[];
	instructions: string;
	tools?: unknown[];
}): number {
	return approximateResponseItemTokens(params.input) + approximateTokenCount({
		instructions: params.instructions,
		tools: params.tools,
		input: [{ type: "compaction_trigger" }],
	});
}

const CONTEXT_WINDOW_TRUNCATED_OUTPUT = "Output exceeded the available model context and was truncated";

function truncateFunctionOutput(item: ResponseItem): ResponseItem | undefined {
	if (
		item.type !== "function_call_output"
		&& item.type !== "custom_tool_call_output"
		&& item.type !== "tool_search_output"
	) return undefined;
	const copy = structuredClone(item);
	if (item.type === "tool_search_output") copy.tools = [];
	else copy.output = CONTEXT_WINDOW_TRUNCATED_OUTPUT;
	return copy;
}

/** Codex rewrites the newest truncatable tool output before an oversized request. */
export function trimFunctionCallHistoryToFitContextWindow(
	items: ResponseItem[],
	maxTokens: number,
	reservedTokens = 0,
): ResponseItem[] {
	const result = items.map((item) => structuredClone(item));
	const inputBudget = Math.max(0, maxTokens - reservedTokens);
	let excess = approximateResponseItemTokens(result) - inputBudget;
	if (excess <= 0) return result;
	for (const group of retainedMessageGroups(result).reverse()) {
		if (excess <= 0) break;
		const rewritten = truncateFunctionOutput(group.source);
		if (!rewritten) break;
		const current = approximateTokens(group.source);
		result[group.sourceIndex] = rewritten;
		excess -= current - approximateTokens(rewritten);
	}
	return result;
}

function truncateMessage(item: ResponseItem, maxTokens: number): ResponseItem | undefined {
	if ((item.type !== "message" && item.type !== undefined) || maxTokens <= 0) return undefined;
	const copy = structuredClone(item);
	let remainingCharacters = maxTokens * 4;

	if (typeof copy.content === "string") {
		copy.content = copy.content.slice(0, Math.max(0, remainingCharacters));
		return copy.content ? copy : undefined;
	}
	if (!Array.isArray(copy.content)) return copy;

	const truncatedContent = copy.content.flatMap((part) => {
		if (!isJsonObject(part) || typeof part.text !== "string") return [part];
		if (remainingCharacters <= 0) return [];
		const text = part.text.slice(0, Math.max(0, remainingCharacters));
		remainingCharacters -= text.length;
		return text ? [{ ...part, text }] : [];
	});
	copy.content = truncatedContent;
	return truncatedContent.length > 0 ? copy : undefined;
}

const CONTEXTUAL_USER_WRAPPERS: Array<[string, string]> = [
	["<environment_context>", "</environment_context>"],
	["<environments_instructions>", "</environments_instructions>"],
	["<context_window>", "</context_window>"],
	["<context_window_guidance>", "</context_window_guidance>"],
	["<skills_instructions>", "</skills_instructions>"],
	["<tools>", "</tools>"],
	["<permissions instructions>", "</permissions instructions>"],
	["<model_switch>", "</model_switch>"],
	["<git_attribution>", "</git_attribution>"],
	["<plugins_instructions>", "</plugins_instructions>"],
	["<realtime_conversation>", "</realtime_conversation>"],
	["<personality_spec>", "</personality_spec>"],
	["<rollout_budget>", "</rollout_budget>"],
	["<turn_aborted>", "</turn_aborted>"],
	["<subagent_notification>", "</subagent_notification>"],
	["<user_instructions>", "</user_instructions>"],
	["<user_shell_command>", "</user_shell_command>"],
	["<additional_context>", "</additional_context>"],
];

function isContextualUserText(value: string): boolean {
	const text = value.trimStart();
	const lower = text.toLowerCase();
	if (lower.startsWith("# agents.md instructions")) return lower.trimEnd().endsWith("</instructions>");
	if (lower.startsWith("<codex_internal_context")) {
		return /^<codex_internal_context source="[a-z][a-z0-9_]*">[\s\S]*<\/codex_internal_context>\s*$/.test(text);
	}
	if (lower.startsWith("<goal_context>")) return lower.trimEnd().endsWith("</goal_context>");
	if (lower.startsWith("<skill>")) return lower.trimEnd().endsWith("</skill>");
	if (lower.startsWith("<recommended_plugins>")) return lower.trimEnd().endsWith("</recommended_plugins>");
	if (lower.startsWith("<external_") && lower.includes(">")) {
		const opening = lower.match(/^<(external_[a-z0-9_-]+)>/);
		return opening !== null && lower.trimEnd().endsWith(`</${opening[1]}>`);
	}
	if (lower.startsWith("warning: the maximum number of unified exec processes you can keep open is")) return true;
	if (lower.startsWith("warning: your account was flagged for potentially high-risk cyber activity")) return true;
	if (lower.startsWith("warning: apply_patch was requested via ")) {
		return lower.trimEnd().endsWith("use the apply_patch tool instead of exec_command.");
	}
	return CONTEXTUAL_USER_WRAPPERS.some(([open, close]) =>
		lower.startsWith(open) && lower.trimEnd().endsWith(close),
	);
}

function isHookPromptText(value: string): boolean {
	return /^<hook_prompt\b[^>]*hook_run_id=(?:"[^"]+"|'[^']+')\s*>[\s\S]*<\/hook_prompt>\s*$/i.test(value.trim());
}

function isRetainedUserMessage(item: ResponseItem): boolean {
	if (typeof item.content === "string") return !isContextualUserText(item.content);
	if (!Array.isArray(item.content)) return true;
	let hookPrompt = false;
	let onlyContextOrHook = true;
	for (const part of item.content) {
		if (!isJsonObject(part) || typeof part.text !== "string") {
			onlyContextOrHook = false;
			continue;
		}
		if (isHookPromptText(part.text)) {
			hookPrompt = true;
			continue;
		}
		if (isContextualUserText(part.text)) continue;
		onlyContextOrHook = false;
	}
	return hookPrompt ? onlyContextOrHook : !item.content.some(
		(part) => isJsonObject(part) && typeof part.text === "string" && isContextualUserText(part.text),
	);
}

function isFinalAnswerAgentMessage(item: ResponseItem): boolean {
	if (item.type !== "agent_message" || !Array.isArray(item.content)) return false;
	const first = item.content[0];
	return isJsonObject(first)
		&& first.type === "input_text"
		&& typeof first.text === "string"
		&& first.text.startsWith("Message Type: FINAL_ANSWER\n");
}

function isDescendantProgressAgentMessage(item: ResponseItem): boolean {
	if (item.type !== "agent_message" || !Array.isArray(item.content)) return false;
	if (typeof item.author !== "string" || typeof item.recipient !== "string") return false;
	const first = item.content[0];
	return item.author.startsWith(`${item.recipient}/`)
		&& isJsonObject(first)
		&& first.type === "input_text"
		&& typeof first.text === "string"
		&& first.text.startsWith("Message Type: MESSAGE\n");
}

function retainedMessageTokens(item: ResponseItem): number {
	if (typeof item.content === "string") return Math.max(1, Math.ceil(item.content.length / 4));
	if (!Array.isArray(item.content)) return 1;
	return Math.max(1, item.content.reduce((total, part) => {
		if (!isJsonObject(part) || (part.type !== "input_text" && part.type !== "output_text") || typeof part.text !== "string") return total;
		return total + Math.ceil(part.text.length / 4);
	}, 0));
}

function retainedItemTokens(item: ResponseItem): number {
	return item.type === "agent_message" ? approximateTokens(item) : retainedMessageTokens(item);
}

const IMAGE_RESIZE_NOTICE_START = "<image_resize_notice>";
const IMAGE_RESIZE_NOTICE_END = "</image_resize_notice>";

type RetainedMessageGroup = {
	source: ResponseItem;
	sourceIndex: number;
	notice?: ResponseItem;
};

function isImageResizeNotice(item: ResponseItem): boolean {
	if (item.type !== "message" || item.role !== "developer" || !Array.isArray(item.content) || item.content.length !== 1) return false;
	const part = item.content[0];
	if (!isJsonObject(part) || part.type !== "input_text" || typeof part.text !== "string") return false;
	const text = part.text.trim().toLowerCase();
	return text.startsWith(IMAGE_RESIZE_NOTICE_START)
		&& text.endsWith(IMAGE_RESIZE_NOTICE_END);
}

function retainedMessageGroups(items: ResponseItem[]): RetainedMessageGroup[] {
	const groups: RetainedMessageGroup[] = [];
	for (let index = 0; index < items.length; index++) {
		const source = items[index]!;
		const notice = items[index + 1];
		if (notice && isImageResizeNotice(notice)) {
			groups.push({ source, sourceIndex: index, notice });
			index++;
		} else {
			groups.push({ source, sourceIndex: index });
		}
	}
	return groups;
}

/** Keeps the newest complete user turn for a confirmed overflow recovery. */
export function latestRemoteCompactionSuffix(
	items: ResponseItem[],
	maxTokens: number,
	reservedTokens = 0,
): ResponseItem[] {
	const budget = Math.max(0, maxTokens - reservedTokens);
	const userStarts = items.flatMap((item, index) => item.role === "user" ? [index] : []);
	if (userStarts.length === 0) return [];
	const candidateStart = userStarts.at(-1)!;
	const candidate = trimFunctionCallHistoryToFitContextWindow(items.slice(candidateStart), maxTokens, reservedTokens);
	if (approximateResponseItemTokens(candidate) > budget) return [];
	if (candidateStart === 0 && userStarts.length === 1 && JSON.stringify(candidate) === JSON.stringify(items)) return [];
	if (candidateStart > 0 && (items[candidateStart - 1]?.type === "compaction" || items[candidateStart - 1]?.type === "context_compaction")) {
		const withCheckpoint = trimFunctionCallHistoryToFitContextWindow(items.slice(candidateStart - 1), maxTokens, reservedTokens);
		if (approximateResponseItemTokens(withCheckpoint) <= budget) return withCheckpoint;
	}
	return candidate;
}

function retainedByCodex(item: ResponseItem): boolean {
	if (item.type === "agent_message") {
		return !isDescendantProgressAgentMessage(item)
			&& !isFinalAnswerAgentMessage(item)
			&& approximateTokens(item) <= MAX_RETAINED_AGENT_MESSAGE_TOKENS;
	}
	if (item.type !== "message" && item.type !== undefined) return false;
	return item.role === "user" && isRetainedUserMessage(item);
}

/** Mirrors current Codex V2's retained message whitelist and 64k newest-first budget. */
export function retainRecentMessages(items: ResponseItem[], maxTokens = RETAINED_MESSAGE_TOKEN_BUDGET): ResponseItem[] {
	let remaining = maxTokens;
	const retained: ResponseItem[] = [];
	for (const group of retainedMessageGroups(items).reverse()) {
		if (remaining <= 0 || !retainedByCodex(group.source)) continue;
		const noticeTokens = group.notice ? retainedMessageTokens(group.notice) : 0;
		const sourceTokens = retainedItemTokens(group.source);
		const tokens = sourceTokens + noticeTokens;
		if (tokens <= remaining) {
			if (group.notice) retained.push(structuredClone(group.notice));
			retained.push(structuredClone(group.source));
			remaining -= tokens;
			continue;
		}
		if (remaining <= noticeTokens) continue;
		const sourceBudget = remaining - noticeTokens;
		const truncated = (group.source.type === "message" || group.source.type === undefined)
			? truncateMessage(group.source, sourceBudget)
			: undefined;
		if (truncated) {
			if (group.notice) retained.push(structuredClone(group.notice));
			retained.push(truncated);
			remaining = 0;
		}
	}
	return retained.reverse();
}

export function buildReplacementHistory(
	preCompactionInput: ResponseItem[],
	compactionItem: ResponseItem,
): ResponseItem[] {
	if (compactionItem.type !== "compaction" || typeof compactionItem.encrypted_content !== "string") {
		throw new Error("OpenAI Codex did not return a valid compaction item.");
	}
	return [...retainRecentMessages(preCompactionInput), structuredClone(compactionItem)];
}

export function buildToolPayload(
	allTools: ToolInfo[],
	activeToolNames: string[],
	supportsStrictMode = true,
	excludedToolNames?: ReadonlySet<string>,
): unknown[] | undefined {
	const active = new Set(activeToolNames);
	const tools = allTools.filter((tool) => active.has(tool.name) && !excludedToolNames?.has(tool.name));
	return tools.length > 0 ? tools.map((tool) => responseTool(tool, false, supportsStrictMode)) : undefined;
}

export function buildCompactionRequestBody(params: {
	basePayload?: JsonObject;
	model: Model<any>;
	input: ResponseItem[];
	instructions: string;
	tools?: unknown[];
	sessionId: string;
}): JsonObject {
	const base = params.basePayload ? structuredClone(params.basePayload) : {};
	const previousText = isJsonObject(base.text) && typeof base.text.verbosity === "string"
		? { verbosity: base.text.verbosity }
		: { verbosity: "low" };
	const instructions = typeof base.instructions === "string" ? base.instructions : params.instructions;
	const requestTools = Array.isArray(base.tools) ? base.tools : params.tools;
	const body: JsonObject = {
		model: params.model.id,
		store: false,
		stream: true,
		instructions,
		input: [...params.input.map((item) => structuredClone(item)), { type: "compaction_trigger" }],
		tool_choice: "auto",
		parallel_tool_calls: true,
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: params.sessionId,
		text: previousText,
	};
	if (requestTools) body.tools = requestTools;
	if (isJsonObject(base.reasoning)) body.reasoning = structuredClone(base.reasoning);
	if (typeof base.service_tier === "string") body.service_tier = base.service_tier;
	return body;
}

function extractCodexAccountId(token: string): string {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("Invalid token");
		const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as JsonObject;
		const auth = payload["https://api.openai.com/auth"];
		if (!isJsonObject(auth) || typeof auth.chatgpt_account_id !== "string") throw new Error("Missing account ID");
		return auth.chatgpt_account_id;
	} catch {
		throw new Error("Failed to extract the ChatGPT account ID from the OpenAI Codex token.");
	}
}

export function mergeFeatureHeader(existing: string | null | undefined): string {
	const features = (existing ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	return [...new Set([...features, REMOTE_COMPACTION_FEATURE])].join(",");
}

export function buildCodexHeaders(params: {
	apiKey: string;
	headers?: Record<string, string | null>;
	sessionId: string;
	turnState?: string;
}): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(params.headers ?? {})) {
		if (value === null) headers.delete(name);
		else headers.set(name, value);
	}
	headers.set("authorization", `Bearer ${params.apiKey}`);
	headers.set("chatgpt-account-id", extractCodexAccountId(params.apiKey));
	headers.set("originator", "pi");
	headers.set("user-agent", "pi-codex-compact");
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");
	headers.set("session-id", params.sessionId);
	headers.set("x-client-request-id", params.sessionId);
	if (params.turnState) headers.set("x-codex-turn-state", params.turnState);
	const features = mergeFeatureHeader(headers.get("x-codex-beta-features"));
	if (features) headers.set("x-codex-beta-features", features);
	else headers.delete("x-codex-beta-features");
	return headers;
}

function parseRetryDelay(response: Response): number | undefined {
	const retryAfterMilliseconds = response.headers.get("retry-after-ms");
	if (retryAfterMilliseconds !== null) {
		const milliseconds = Number(retryAfterMilliseconds);
		if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
	}
	const retryAfter = response.headers.get("retry-after");
	if (!retryAfter) return undefined;
	const seconds = Number(retryAfter);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(retryAfter);
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 409 || status === 429 || status >= 500;
}

function canFallbackForStatus(status: number, body: string): boolean {
	if (![400, 403, 404, 408, 409, 429].includes(status) && status < 500) return false;
	if (status === 403 && !/(?:model|invalid request|not found|overloaded)/i.test(body)) return false;
	if (status === 404 && !/(?:model|invalid request|overloaded)/i.test(body)) return false;
	return !isFailClosedCompactionError(body);
}

export function markFallbackEligibility(error: Error, eligible: boolean): Error & { retryWithCurrentModel: boolean } {
	Object.defineProperty(error, "retryWithCurrentModel", { value: eligible, enumerable: false, configurable: true });
	return error as Error & { retryWithCurrentModel: boolean };
}

export function markContextOverflowRecovery(error: Error): Error & { contextOverflowRecovery: boolean; retryWithCurrentModel: boolean } {
	Object.defineProperty(error, "contextOverflowRecovery", { value: true, enumerable: false, configurable: true });
	return markFallbackEligibility(markCompactionRetry(error, "none"), false) as Error & { contextOverflowRecovery: boolean; retryWithCurrentModel: boolean };
}

type CompactionRetry = "none" | "automatic" | "explicit";

function compactionRetry(error: unknown): CompactionRetry | undefined {
	if (typeof error !== "object" || error === null || !("compactionRetry" in error)) return undefined;
	const value = (error as { compactionRetry?: unknown }).compactionRetry;
	return value === "none" || value === "automatic" || value === "explicit" ? value : undefined;
}

function compactionErrorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("compactionCode" in error)) return undefined;
	const value = (error as { compactionCode?: unknown }).compactionCode;
	return typeof value === "string" ? value : undefined;
}

function markCompactionRetry<T extends Error>(error: T, retry: CompactionRetry): T {
	Object.defineProperty(error, "compactionRetry", { value: retry, enumerable: false, configurable: true });
	return error;
}

function markCompactionCode<T extends Error>(error: T, code: string): T {
	if (code) Object.defineProperty(error, "compactionCode", { value: code, enumerable: false, configurable: true });
	return error;
}

function shouldRetryCompaction(error: unknown): boolean {
	const retry = compactionRetry(error);
	return retry === "automatic" || retry === "explicit";
}

function normalizedErrorCode(code: string): string {
	return code.trim().toLowerCase();
}

const CANONICAL_COMPACTION_ERROR_CODES = new Set([
	...NON_RETRYABLE_FALLBACK_ERROR_CODES,
	...RETRYABLE_COMPACTION_ERROR_CODES,
	...SSE_MODEL_FALLBACK_ERROR_CODES,
	"insufficient_quota",
	"quota_exceeded",
	"usage_not_included",
	"invalid_api_key",
	"authentication_error",
	"unauthorized",
	"forbidden",
	"permission_denied",
	"access_denied",
	"auth_error",
	"authorization_error",
	"credential_error",
	"expired_token",
	"invalid_credential",
	"invalid_token",
	"token_expired",
	"billing_error",
	"billing_issue",
	"billing_required",
	"insufficient_funds",
	"out_of_budget",
	"policy_violation",
	"misalignment_policy_violation",
	"cyber_policy",
	"invalid_image",
	"invalid_image_request",
	"content_filter",
	"bio_policy",
	"canceled",
	"cancelled",
	"aborted",
	"connection_failed",
	"response.failed",
	"response.incomplete",
]);

export function compactionFailureClassification(error: unknown): string {
	const code = compactionErrorCode(error);
	if (code) {
		const normalized = normalizedErrorCode(code);
		if (CANONICAL_COMPACTION_ERROR_CODES.has(normalized)) return normalized;
	}
	if (typeof error === "object" && error !== null && "contextOverflowRecovery" in error) return "context_window_exceeded";
	const message = error instanceof Error ? error.message : String(error);
	const status = /\((\d{3})\):/.exec(message)?.[1];
	if (status) return `http_${status}`;
	if (/(?:auth|api[_ -]?key|token|credential)/i.test(message)) return "authentication";
	if (/(?:policy|forbidden|permission|quota|usage[_ -]?limit|billing|out[_ -]?of[_ -]?budget|insufficient[_ -]?funds)/i.test(message)) return "policy_or_quota";
	if (/(?:timeout|timed out)/i.test(message)) return "timeout";
	if (/(?:network|websocket|connection|fetch)/i.test(message)) return "network";
	if (/(?:context_length_exceeded|context_window_exceeded)/i.test(message)) return "context_window_exceeded";
	return "compaction_failed";
}

function retryDelayFromMessage(message: string): number | undefined {
	const match = /try again in\s+([\d.]+)\s*(ms|milliseconds?|s|seconds?)/i.exec(message);
	if (!match) return undefined;
	const value = Number(match[1]);
	if (!Number.isFinite(value) || value < 0) return undefined;
	return /^(?:ms|milliseconds?)$/i.test(match[2]!) ? value : value * 1000;
}

function withRetryDelay<T extends Error>(error: T, message: string): T {
	const delayMs = retryDelayFromMessage(message);
	if (delayMs !== undefined) Object.defineProperty(error, "retryAfterMs", { value: delayMs, enumerable: false, configurable: true });
	return error;
}

function isKnownCompactionErrorCode(code: string): boolean {
	return !code
		|| NON_RETRYABLE_FALLBACK_ERROR_CODES.has(code)
		|| RETRYABLE_COMPACTION_ERROR_CODES.has(code);
}

function classifySseCompactionError(code: string, message: string): Error {
	const detail = code
		? `OpenAI Codex compaction failed (${code}): ${message}`
		: message || "OpenAI Codex compaction failed.";
	const normalizedCode = normalizedErrorCode(code);
	const machineDetails = `${normalizedCode} ${message}`;
	const usageLimitMessage = USAGE_LIMIT_MESSAGE_PATTERN.test(machineDetails);
	const tag = <T extends Error>(error: T): T => markCompactionCode(error, normalizedCode);
	if (normalizedCode !== "content_filter" && isFailClosedCompactionError(machineDetails)) {
		return tag(markFallbackEligibility(markCompactionRetry(new Error(detail), "none"), false));
	}
	if (!usageLimitMessage && SSE_MODEL_FALLBACK_ERROR_CODES.has(normalizedCode) && !RETRYABLE_COMPACTION_ERROR_CODES.has(normalizedCode)) {
		return tag(markFallbackEligibility(markCompactionRetry(withRetryDelay(new Error(detail), message), "none"), true));
	}
	if (!normalizedCode || !isKnownCompactionErrorCode(normalizedCode)) {
		return tag(markFallbackEligibility(markCompactionRetry(withRetryDelay(new Error(detail), message), "explicit"), false));
	}
	if (
		RETRYABLE_COMPACTION_ERROR_CODES.has(normalizedCode)
		|| RETRYABLE_COMPACTION_ERROR_PATTERN.test(machineDetails)
	) {
		return tag(markFallbackEligibility(
			markCompactionRetry(withRetryDelay(new Error(detail), message), "explicit"),
			!usageLimitMessage && SSE_MODEL_FALLBACK_ERROR_CODES.has(normalizedCode),
		));
	}
	return tag(markFallbackEligibility(markCompactionRetry(withRetryDelay(new Error(detail), message), "none"), false));
}

function errorCodeFromResponseBody(body: string): string {
	try {
		const parsed = JSON.parse(body) as unknown;
		const error = isJsonObject(parsed) && isJsonObject(parsed.error) ? parsed.error : parsed;
		if (!isJsonObject(error)) return "";
		const code = typeof error.code === "string" ? error.code : error.type;
		return typeof code === "string" ? code : "";
	} catch {
		return "";
	}
}

function classifyHttpCompactionError(
	status: number,
	body: string,
	prefix: string,
): { error: Error & { retryWithCurrentModel: boolean }; retryable: boolean } {
	const code = normalizedErrorCode(errorCodeFromResponseBody(body));
	const machineDetails = `${code} ${body}`;
	const knownMessage = /(?:context|invalid request|model|not found|overloaded|rate[_ -]?limit)/i.test(body)
		|| USAGE_LIMIT_MESSAGE_PATTERN.test(body)
		|| isFailClosedCompactionError(machineDetails)
		|| RETRYABLE_COMPACTION_ERROR_PATTERN.test(body);
	const malformedClientError = status === 400 && !code && !knownMessage;
	const unknownCode = Boolean(code) && !isKnownCompactionErrorCode(code) && !isFailClosedCompactionError(machineDetails);
	const fallback = !malformedClientError
		&& !unknownCode
		&& !USAGE_LIMIT_MESSAGE_PATTERN.test(machineDetails)
		&& canFallbackForStatus(status, body);
	const terminal = malformedClientError
		|| (unknownCode && !isRetryableStatus(status))
		|| isFailClosedCompactionError(machineDetails)
		|| NON_RETRYABLE_FALLBACK_ERROR_CODES.has(code)
		|| USAGE_LIMIT_MESSAGE_PATTERN.test(body);
	const retryable = isRetryableStatus(status) && !terminal;
	const error = markCompactionRetry(
		new Error(`${prefix} (${status}): ${body || "HTTP error"}`),
		retryable ? "explicit" : "none",
	);
	return { error: markFallbackEligibility(markCompactionCode(error, code), fallback), retryable };
}

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("Compaction aborted");
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) throw abortError(signal);
	if (ms <= 0) return;
	try {
		await sleep(ms, undefined, signal ? { signal } : undefined);
	} catch (error) {
		if (signal?.aborted) throw abortError(signal);
		throw error;
	}
}

async function withCompactionTimeout<T>(
	operation: () => Promise<T>,
	timeoutMs: number,
	message: string,
	onTimeout?: (error: Error) => void,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeoutError = markFallbackEligibility(
		markCompactionRetry(new Error(message), "explicit"),
		false,
	);
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(timeoutError);
			onTimeout?.(timeoutError);
		}, timeoutMs);
	});
	try {
		return await Promise.race([operation(), timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function parseSseResponse(
	response: Response,
	signal?: AbortSignal,
	idleTimeoutMs = V2_COMPACTION_IDLE_TIMEOUT_MS,
): Promise<{ item: ResponseItem; usage?: unknown; serviceTier?: string }> {
	if (!response.body) {
		throw markFallbackEligibility(
			markCompactionRetry(new Error("OpenAI Codex returned an empty compaction stream."), "explicit"),
			false,
		);
	}
	const reader = response.body.getReader();
	if (signal?.aborted) {
		await reader.cancel();
		reader.releaseLock();
		throw abortError(signal);
	}
	const decoder = new TextDecoder();
	let buffer = "";
	let completed = false;
	let usage: unknown;
	let serviceTier: string | undefined;
	const compactionItems: ResponseItem[] = [];
	const onAbort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	const processBlock = (block: string) => {
		const data = block
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n")
			.trim();
		if (!data || data === "[DONE]") return;
		let event: unknown;
		try {
			event = JSON.parse(data);
		} catch {
			throw markFallbackEligibility(
				markCompactionRetry(new Error("OpenAI Codex returned malformed compaction SSE data."), "none"),
				false,
			);
		}
		if (!isJsonObject(event)) {
			throw markFallbackEligibility(
				markCompactionRetry(new Error("OpenAI Codex returned a non-object compaction SSE data frame."), "none"),
				false,
			);
		}
		if (event.type === "response.output_item.done") {
			if (!isResponseItem(event.item)) {
				throw markFallbackEligibility(
					markCompactionRetry(new Error("OpenAI Codex returned a malformed response.output_item.done item."), "none"),
					false,
				);
			}
			if (event.item.type === "compaction") compactionItems.push(event.item);
		}
		if (event.type === "error") {
			const nested = isJsonObject(event.error) ? event.error : {};
			const code = typeof event.code === "string"
				? event.code
				: typeof nested.code === "string"
					? nested.code
					: "";
			const message = typeof event.message === "string" && event.message.trim()
				? event.message
				: typeof nested.message === "string" && nested.message.trim()
					? nested.message
					: "";
			if (!message && !code) {
				throw markFallbackEligibility(
					markCompactionRetry(new Error("OpenAI Codex compaction failed."), "none"),
					false,
				);
			}
			throw classifySseCompactionError(code, message);
		}
		if (event.type === "response.failed") {
			const response = isJsonObject(event.response) ? event.response : {};
			const failure = isJsonObject(response.error) ? response.error : {};
			const code = typeof failure.code === "string"
				? failure.code
				: typeof failure.type === "string"
					? failure.type
					: "response.failed";
			const message = typeof failure.message === "string"
				? failure.message
				: "OpenAI Codex compaction ended with response.failed.";
			throw classifySseCompactionError(code, message);
		}
		if (event.type === "response.incomplete") {
			const response = isJsonObject(event.response) ? event.response : {};
			const details = isJsonObject(event.incomplete_details)
				? event.incomplete_details
				: isJsonObject(response.incomplete_details)
					? response.incomplete_details
					: {};
			const reason = typeof details.reason === "string" ? details.reason : "unknown";
			const message = typeof details.message === "string" && details.message.trim()
				? details.message
				: `OpenAI Codex compaction ended with response.incomplete (${reason}).`;
			const normalizedReason = normalizedErrorCode(reason);
			const explicitRetry = normalizedReason === "content_filter" || (
				!isFailClosedCompactionError(`${reason} ${message}`)
				&& !/invalid[_ -]?(?:prompt|request)|malformed|protocol/i.test(`${reason} ${message}`)
			);
			const retry = normalizedReason === "context_length_exceeded" || normalizedReason === "context_window_exceeded"
				? "automatic"
				: explicitRetry ? "explicit" : "automatic";
			const error = markCompactionCode(markCompactionRetry(
				withRetryDelay(new Error(message), message),
				retry,
			), normalizedReason);
			throw markFallbackEligibility(error, false);
		}
		if (event.type !== "response.output_item.done" && (typeof event.code === "string" || typeof event.message === "string" || isJsonObject(event.error))) {
			const nested = isJsonObject(event.error) ? event.error : {};
			const code = typeof event.code === "string"
				? event.code
				: typeof nested.code === "string"
					? nested.code
					: "";
			const message = typeof event.message === "string"
				? event.message
				: typeof nested.message === "string"
					? nested.message
					: "";
			throw classifySseCompactionError(code, message);
		}
		if (event.type === "response.completed") {
			const response = isJsonObject(event.response) ? event.response : undefined;
			if (typeof response?.id !== "string") {
				throw markFallbackEligibility(
					markCompactionRetry(new Error("OpenAI Codex returned a malformed response.completed response."), "none"),
					false,
				);
			}
			completed = true;
			usage = response.usage;
			if (typeof response.service_tier === "string") serviceTier = response.service_tier;
		}
	};

	try {
		while (!completed) {
			const { done, value } = await withCompactionTimeout(
				() => reader.read(),
				idleTimeoutMs,
				"OpenAI Codex compaction stream idle timeout.",
			);
			buffer += decoder.decode(value, { stream: !done });
			buffer = buffer.replace(/\r\n/g, "\n");
			let boundary = buffer.indexOf("\n\n");
			while (!completed && boundary >= 0) {
				processBlock(buffer.slice(0, boundary));
				buffer = buffer.slice(boundary + 2);
				boundary = buffer.indexOf("\n\n");
			}
			if (done) break;
		}
		if (!completed && buffer.trim()) processBlock(buffer);
	} finally {
		signal?.removeEventListener("abort", onAbort);
		try {
			await reader.cancel();
		} catch {}
		try {
			reader.releaseLock();
		} catch {}
	}
	if (!completed) {
		throw markFallbackEligibility(
			markCompactionRetry(
				new Error("OpenAI Codex compaction stream closed before response.completed."),
				"explicit",
			),
			false,
		);
	}
	if (compactionItems.length !== 1) {
		throw markCompactionRetry(
			new Error(`OpenAI Codex returned ${compactionItems.length} compaction items; expected exactly one.`),
			"none",
		);
	}
	const item = compactionItems[0]!;
	if (typeof item.encrypted_content !== "string") {
		throw markCompactionRetry(
			new Error("OpenAI Codex returned a compaction item without encrypted_content."),
			"none",
		);
	}
	return { item, usage, serviceTier };
}

function serviceTierMultiplier(model: Model<any>, requestTier: string | undefined, responseTier: string | undefined): number {
	const tier = responseTier === "default" ? requestTier : responseTier ?? requestTier;
	if (tier === "flex") return 0.5;
	if (tier === "priority") return model.id === "gpt-5.5" ? 2.5 : 2;
	return 1;
}

function usageFromResponse(
	model: Model<any>,
	value: unknown,
	requestTier: string | undefined,
	responseTier: string | undefined,
): Usage | undefined {
	if (!isJsonObject(value)) return undefined;
	const inputTokens = typeof value.input_tokens === "number" ? value.input_tokens : 0;
	const outputTokens = typeof value.output_tokens === "number" ? value.output_tokens : 0;
	const details = isJsonObject(value.input_tokens_details) ? value.input_tokens_details : undefined;
	const cacheRead = typeof details?.cached_tokens === "number" ? details.cached_tokens : 0;
	const cacheWrite = typeof details?.cache_write_tokens === "number" ? details.cache_write_tokens : 0;
	const usage: Usage = {
		input: Math.max(0, inputTokens - cacheRead - cacheWrite),
		output: outputTokens,
		cacheRead,
		cacheWrite,
		totalTokens: typeof value.total_tokens === "number" ? value.total_tokens : inputTokens + outputTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, usage);
	const multiplier = serviceTierMultiplier(model, requestTier, responseTier);
	usage.cost.input *= multiplier;
	usage.cost.output *= multiplier;
	usage.cost.cacheRead *= multiplier;
	usage.cost.cacheWrite *= multiplier;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage;
}

export async function callRemoteCompaction(params: {
	url: string;
	headers: Headers;
	body: JsonObject;
	model: Model<any>;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	onTurnState?: (turnState: string) => void;
}) {
	const fetchImpl = params.fetchImpl ?? fetch;
	let lastError: unknown;
	let turnStateCaptured = params.headers.has("x-codex-turn-state");
	for (let attempt = 0; attempt <= MAX_REMOTE_RETRIES; attempt++) {
		const attemptController = new AbortController();
		const relayAbort = () => attemptController.abort(params.signal?.reason);
		if (params.signal?.aborted) attemptController.abort(params.signal.reason);
		else params.signal?.addEventListener("abort", relayAbort, { once: true });
		try {
			try {
				const response = await withCompactionTimeout(
					() => fetchImpl(params.url, {
						method: "POST",
						headers: params.headers,
						body: JSON.stringify(params.body),
						signal: attemptController.signal,
					}),
					V2_COMPACTION_IDLE_TIMEOUT_MS,
					"OpenAI Codex compaction request timed out.",
					(error) => attemptController.abort(error),
				);
				const responseTurnState = response.headers.get("x-codex-turn-state");
				if (responseTurnState && !turnStateCaptured) {
					params.headers.set("x-codex-turn-state", responseTurnState);
					params.onTurnState?.(responseTurnState);
					turnStateCaptured = true;
				}
				if (!response.ok) {
					const body = await response.text().catch(() => "");
					const classified = classifyHttpCompactionError(
						response.status,
						body || response.statusText,
						"OpenAI Codex compaction failed",
					);
					if (!classified.retryable || attempt === MAX_REMOTE_RETRIES) throw classified.error;
					lastError = classified.error;
					await delay(parseRetryDelay(response) ?? 1000 * 2 ** attempt, params.signal);
					continue;
				}
				const parsed = await parseSseResponse(response, params.signal, V2_COMPACTION_IDLE_TIMEOUT_MS);
				return {
					compactionItem: parsed.item,
					usage: usageFromResponse(
						params.model,
						parsed.usage,
						typeof params.body.service_tier === "string" ? params.body.service_tier : undefined,
						parsed.serviceTier,
					),
				};
			} finally {
				params.signal?.removeEventListener("abort", relayAbort);
				attemptController.abort();
			}
		} catch (error) {
			const classified = error instanceof Error ? error : new Error(String(error));
			if (params.signal?.aborted) {
				throw markFallbackEligibility(markCompactionRetry(classified, "none"), false);
			}
			if (compactionRetry(classified) === undefined) markCompactionRetry(classified, "explicit");
			if (!shouldRetryCompaction(classified)) throw classified;
			lastError = classified;
			if (attempt === MAX_REMOTE_RETRIES) throw classified;
			const retryAfterMs = isJsonObject(classified) && typeof classified.retryAfterMs === "number" ? classified.retryAfterMs : undefined;
			await delay(retryAfterMs ?? 1000 * 2 ** attempt, params.signal);
		}
	}
	throw lastError instanceof Error ? lastError : new Error("OpenAI Codex compaction failed");
}

export function stripInputFromPayload(payload: JsonObject): JsonObject {
	const shape = structuredClone(payload);
	delete shape.input;
	delete shape.messages;
	delete shape.previous_response_id;
	return shape;
}
