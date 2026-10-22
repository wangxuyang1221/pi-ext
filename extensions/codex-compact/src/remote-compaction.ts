import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, type Model } from "@earendil-works/pi-ai";
import { effectiveContextWindow, loadConfig } from "./config.js";
import {
	buildCodexHeaders,
	buildCompactionRequestBody,
	retainRecentMessages,
	approximateResponseItemTokens,
	buildToolPayload,
	callRemoteCompaction,
	loadedToolNamesFromItems,
	modelKey,
	approximateCompactionRequestTokens,
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
	/** Request-owned suffix excluded from remote history, but included in the final capacity budget. */
	protectedInput?: ResponseItem[];
	replayContextWindow?: number;
	basePayload?: JsonObject;
	turnState?: string;
	onTurnState?: (turnState: string) => void;
	signal?: AbortSignal;
	compHash?: string;
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
	const thinkingLevel = params.ctx.thinkingLevel;
	if (thinkingLevel === "off" || params.model.reasoning === false) {
		delete base.reasoning;
		if (params.model.reasoning && params.model.thinkingLevelMap?.off !== null) {
			base.reasoning = { effort: params.model.thinkingLevelMap?.off ?? "none" };
		}
	} else if (!Object.hasOwn(base, "reasoning") && thinkingLevel) {
		const level = clampThinkingLevel(params.model, thinkingLevel);
		if (level !== "off") {
			const effort = params.model.thinkingLevelMap?.[level] ?? level;
			base.reasoning = { effort, summary: "auto" };
		}
	}
	return base;
}

/** Owns the V2 remote protocol seam. The lifecycle adapter supplies session facts. */
export async function createNativeCheckpoint(params: NativeCheckpointRequest): Promise<{
	details: NativeCompactionDetails;
	usage?: Awaited<ReturnType<typeof callRemoteCompaction>>["usage"];
}> {
	params = { ...params, ...structuredClone({ model: params.model, input: params.input, protectedInput: params.protectedInput,
		basePayload: params.basePayload, allTools: params.allTools, activeToolNames: params.activeToolNames }) };
	const sessionId = params.ctx.sessionManager.getSessionId();
	const basePayload = compactionBasePayload(params);
	const fallbackPrompt = params.ctx.getSystemPrompt();
	const config = loadConfig(params.ctx.cwd ?? "", params.ctx.isProjectTrusted?.() ?? false);
	const auth = await params.ctx.modelRegistry.getApiKeyAndHeaders(params.model);
	if (!auth.ok || !auth.apiKey) {
		const error = markFallbackEligibility(
			new Error(auth.ok ? "OpenAI Codex authentication is unavailable." : auth.error),
			false,
		);
		throw error;
	}
	const baseUrl = auth.baseUrl ?? params.model.baseUrl;
	const supportsStrictMode = (params.model.compat as { supportsStrictMode?: boolean } | undefined)?.supportsStrictMode !== false;
	const generatedTools = buildToolPayload(
		params.allTools,
		params.activeToolNames,
		supportsStrictMode,
		loadedToolNamesFromItems(params.input),
	);
	const tools = params.basePayload !== undefined ? (Array.isArray(basePayload.tools) ? basePayload.tools : []) : generatedTools;
	const instructions = typeof basePayload.instructions === "string"
		? basePayload.instructions
		: fallbackPrompt;
	// Leave room for the stable request prefix and the V2 trigger item.
	const reservedTokens = approximateCompactionRequestTokens({
		input: [],
		instructions,
		tools,
	});
	const contextWindow = effectiveContextWindow(config, params.model.contextWindow);
	const input = trimFunctionCallHistoryToFitContextWindow(
		params.input,
		contextWindow,
		reservedTokens,
	);
	// A local estimate is not proof that the request exceeds the server window.
	// Like Codex V2, send the retained history and let the server decide.
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
	const fixedTokens = approximateCompactionRequestTokens({ input: [remote.compactionItem, ...(params.protectedInput ?? [])], instructions, tools });
	const replayWindow = effectiveContextWindow(config, params.replayContextWindow ?? params.model.contextWindow);
	let budget = Math.max(0, Math.min(64_000, replayWindow - fixedTokens));
	let retained = retainRecentMessages(input, budget);
	if (fixedTokens + approximateResponseItemTokens(retained) > replayWindow) {
		// Truncation markers and wire structure are not part of the retention text budget.
		// Search at most log2(64001) steps, retaining only candidates that fit the final estimator.
		let low = 0;
		let high = budget;
		retained = [];
		while (low < high) {
			budget = Math.ceil((low + high) / 2);
			const candidate = retainRecentMessages(input, budget);
			if (fixedTokens + approximateResponseItemTokens(candidate) <= replayWindow) { low = budget; retained = candidate; }
			else high = budget - 1;
		}
	}
	return {
		details: {
			kind: NATIVE_COMPACTION_KIND,
			version: NATIVE_COMPACTION_VERSION,
			modelKey: modelKey(params.model),
			...(typeof params.compHash === "string" && params.compHash.trim() ? { compHash: params.compHash } : {}),
			replacementHistory: [...retained, structuredClone(remote.compactionItem)],
		},
		usage: remote.usage,
	};
}
