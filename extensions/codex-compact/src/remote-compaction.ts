import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { compactionHash } from "./capabilities.js";
import {
	buildCodexHeaders,
	buildCompactionRequestBody,
	buildReplacementHistory,
	buildToolPayload,
	callRemoteCompaction,
	loadedToolNamesFromItems,
	modelKey,
	approximateCompactionRequestTokens,
	markContextOverflowRecovery,
	markFallbackEligibility,
	NATIVE_COMPACTION_KIND,
	NATIVE_COMPACTION_VERSION,
	trimFunctionCallHistoryToFitContextWindow,
	type JsonObject,
	type NativeCompactionDetails,
	type ResponseItem,
} from "./native-compaction.js";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

function resolveCodexResponsesUrl(baseUrl?: string): string {
	const normalized = (baseUrl?.trim() || DEFAULT_CODEX_BASE_URL).replace(/\/+$/, "");
	if (normalized.endsWith("/codex/responses")) return normalized;
	if (normalized.endsWith("/codex")) return `${normalized}/responses`;
	return `${normalized}/codex/responses`;
}

export type NativeCheckpointRequest = {
	ctx: ExtensionContext;
	model: Model<any>;
	input: ResponseItem[];
	basePayload?: JsonObject;
	turnState?: string;
	onTurnState?: (turnState: string) => void;
	signal?: AbortSignal;
	allTools: Parameters<typeof buildToolPayload>[0];
	activeToolNames: string[];
};

function compactionBasePayload(params: NativeCheckpointRequest): JsonObject {
	const base = { ...params.basePayload };
	const activeModel = params.ctx.model;
	const payloadModel = typeof base.model === "string" ? base.model : undefined;
	if (
		(activeModel && modelKey(activeModel) !== modelKey(params.model))
		|| (payloadModel !== undefined && payloadModel !== params.model.id)
	) {
		// A transition compacts with the previous model. Do not reuse settings
		// already mapped for the newly selected model.
		delete base.reasoning;
		delete base.service_tier;
		delete base.text;
		delete base.temperature;
	}
	if (!Object.hasOwn(base, "reasoning") && params.ctx.thinkingLevel) {
		const effort = params.model.thinkingLevelMap?.[params.ctx.thinkingLevel] ?? params.ctx.thinkingLevel;
		if (effort) base.reasoning = { effort, summary: "auto" };
	}
	return base;
}

/** Owns the V2 remote protocol seam. The lifecycle adapter supplies session facts. */
export async function createNativeCheckpoint(params: NativeCheckpointRequest): Promise<{
	details: NativeCompactionDetails;
	usage?: Awaited<ReturnType<typeof callRemoteCompaction>>["usage"];
}> {
	const auth = await params.ctx.modelRegistry.getApiKeyAndHeaders(params.model);
	if (!auth.ok || !auth.apiKey) {
		const error = markFallbackEligibility(
			new Error(auth.ok ? "OpenAI Codex authentication is unavailable." : auth.error),
			false,
		);
		throw error;
	}
	const sessionId = params.ctx.sessionManager.getSessionId();
	const baseUrl = auth.baseUrl ?? params.model.baseUrl;
	const basePayload = compactionBasePayload(params);
	const supportsStrictMode = (params.model.compat as { supportsStrictMode?: boolean } | undefined)?.supportsStrictMode !== false;
	const generatedTools = buildToolPayload(
		params.allTools,
		params.activeToolNames,
		supportsStrictMode,
		loadedToolNamesFromItems(params.input),
	);
	const tools = Array.isArray(basePayload.tools) ? basePayload.tools : generatedTools;
	const instructions = typeof basePayload.instructions === "string"
		? basePayload.instructions
		: params.ctx.getSystemPrompt();
	// Leave room for the stable request prefix and the V2 trigger item.
	const reservedTokens = approximateCompactionRequestTokens({
		input: [],
		instructions,
		tools,
	});
	const input = trimFunctionCallHistoryToFitContextWindow(
		params.input,
		params.model.contextWindow,
		reservedTokens,
	);
	if (approximateCompactionRequestTokens({
		input,
		instructions,
		tools,
	}) > params.model.contextWindow) {
		throw markContextOverflowRecovery(new Error(
			`OpenAI Codex compaction input exceeds this model's ${params.model.contextWindow} token context window after tool-output trimming.`,
		));
	}
	const headers = buildCodexHeaders({
		apiKey: auth.apiKey,
		headers: auth.headers,
		sessionId,
		turnState: params.turnState,
	});
	const body = buildCompactionRequestBody({
		basePayload,
		model: params.model,
		input,
		instructions,
		tools,
		sessionId,
	});
	const remote = await callRemoteCompaction({
		url: resolveCodexResponsesUrl(baseUrl),
		headers,
		body,
		model: params.model,
		signal: params.signal,
		onTurnState: params.onTurnState,
	});
	return {
		details: {
			kind: NATIVE_COMPACTION_KIND,
			version: NATIVE_COMPACTION_VERSION,
			modelKey: modelKey(params.model),
			...(compactionHash(params.model) ? { compHash: compactionHash(params.model) } : {}),
			replacementHistory: buildReplacementHistory(input, remote.compactionItem),
		},
		usage: remote.usage,
	};
}
