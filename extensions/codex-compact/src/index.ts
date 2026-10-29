import { isDeepStrictEqual } from "node:util";
import { type ExtensionAPI, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { projectBranchMessages } from "./session-projection.js";
import { accountingFingerprint, WindowUsageAccounting } from "./usage-accounting.js";
import { shouldAutoCompact } from "./scheduler.js";
import { createCompactionWidget, type CompactionWidgetFactory } from "./presentation.js";
import { autoCompactTokenLimit, DEFAULT_METADATA_CLIENT_VERSION, effectiveContextWindow, loadConfig } from "./config.js";
import { type CompactionHashSnapshot } from "./capabilities.js";
import { createModelMetadataStore } from "./model-metadata.js";
import { registerMetadataCommand } from "./metadata-command.js";
import { createNativeCheckpoint, type NativeCheckpointRequest } from "./remote-compaction.js";
import { createSessionCoordinator, type RemoteCompactionReason } from "./session-coordinator.js";
import {
	HistoryPrefixMismatchError,
	appendPreservedInput,
	type CompactionInputPlan,
	estimateCompactionWindowPrefillTokens,
	FAILED_REQUEST_KIND,
	findNativeCheckpoint,
	isJsonObject,
	isOpenAICodexModel,
	mergeFeatureHeader,
	approximateResponseItemTokens,
	compactionFailureClassification,
	approximateTokenCount,
	buildToolPayload,
	stripInputFromPayload,
	NATIVE_COMPACTION_BYPASS_KIND,
	NATIVE_COMPACTION_KIND,
	modelKey,
	parseNativeCompactionDetails,
	type JsonObject,
	type NativeCompactionDetails,
	type ResponseItem,
} from "./native-compaction.js";

const LOCAL_MARKER = "Codex encrypted compaction item.";
const VERIFIED_COMPACTION_NOTICE = "Codex compaction applied";
const LOCAL_COMPACTION_NOTICE = "Pi local compaction used";
const UNVERIFIED_COMPACTION_NOTICE = "Codex compaction not confirmed";
const AUTHENTICATION_FAILURE_CODE_PATTERN = /^(?:authentication|authentication_error|auth_error|authorization_error|credential_error|invalid_api_key|invalid_credential|invalid_token|expired_token|token_expired|unauthorized|forbidden|permission_denied|access_denied)$/;
const POLICY_OR_QUOTA_FAILURE_CODE_PATTERN = /^(?:policy_or_quota|policy_violation|insufficient_quota|quota_exceeded|usage_limit_(?:reached|exceeded)|usage_not_included|billing_(?:error|issue|required)|insufficient_funds|out_of_budget)$/;

type FailurePhase = "before_provider_request" | "session_before_compact";
type FailureOutcome = "request_aborted" | "compaction_cancelled" | "compaction_skipped";
type CompactionNoticeContext = {
	hasUI: boolean;
	ui: {
		notify(message: string, type?: "info" | "warning" | "error"): void;
		setWidget(
			key: string,
			content: CompactionWidgetFactory | undefined,
			options?: { placement?: "aboveEditor" | "belowEditor" },
		): void;
	};
	sessionManager: { getSessionId(): string };
};
type RemoteCompactionPresentation = {
	ctx: CompactionNoticeContext;
};

function failureNextStep(code: string): string {
	if (code === "preserved_input_source_unproven") return "the pending input cannot be preserved safely; the existing checkpoint was kept; review the pending input before retrying manually";
	if (code === "authentication" || AUTHENTICATION_FAILURE_CODE_PATTERN.test(code)) {
		return "check Codex authentication and retry manually";
	}
	if (code === "policy_or_quota" || POLICY_OR_QUOTA_FAILURE_CODE_PATTERN.test(code)) {
		return "check Codex plan, permissions, quota, and billing before retrying manually";
	}
	if (code === "context_window_exceeded" || code === "context_length_exceeded") return "shorten the request or start a new session";
	if (code === "network" || code === "timeout") return "check the connection and retry manually";
	return "retry manually or start a new session";
}

function remoteCompactionReasonLabel(reason: RemoteCompactionReason): string {
	if (reason === "model-transition") return "model transition";
	if (reason === "context-recovery") return "context recovery";
	return reason;
}

function safely(operation: () => void): void {
	try {
		operation();
	} catch {}
}

const COMPACTION_WIDGET_OPTIONS = { placement: "aboveEditor" } as const;

function reportCompactionFailure(
	ctx: CompactionNoticeContext,
	model: { id?: unknown } | undefined,
	error: unknown,
	phase: FailurePhase,
	outcome: FailureOutcome,
): string {
	const code = compactionFailureClassification(error);
	const modelId = typeof model?.id === "string" && /^[a-zA-Z0-9_.:-]{1,64}$/.test(model.id) ? model.id : "unknown";
	const next = outcome === "compaction_skipped"
		? "request continues without compaction"
		: failureNextStep(code);
	// Preserve the legacy diagnostic field without implying a removed recovery attempt.
	const recoveryAttempted = false;
	const notice = `OpenAI Codex failure: phase=${phase}; code=${code}; model=${modelId}; recoveryAttempted=${recoveryAttempted}; outcome=${outcome}; next=${next}.`;
	if (ctx.hasUI) safely(() => ctx.ui.notify(notice, outcome === "compaction_skipped" ? "warning" : "error"));
	else safely(() => console.error(notice));
	return code;
}

export default function codexCompactionExtension(pi: ExtensionAPI): void {
	registerMetadataCommand(pi);
	const metadataStore = createModelMetadataStore();
	const resolveCompactionHashes = (ctx: ExtensionContext, model: NonNullable<ExtensionContext["model"]>, signal?: AbortSignal) => {
		const config = loadConfig(ctx.cwd ?? "", ctx.isProjectTrusted?.() ?? false);
		return metadataStore.resolve({ ctx, model, clientVersion: config.metadataClientVersion ?? DEFAULT_METADATA_CLIENT_VERSION, signal });
	};
	const basePayloadBySession = new Map<string, JsonObject>();
	const usageBySession = new Map<string, WindowUsageAccounting>();
	const requestFingerprint = (ctx: ExtensionContext): string => {
		const checkpoint = findNativeCheckpoint(ctx.sessionManager.getBranch() as SessionEntry[], ctx.model && modelKey(ctx.model));
		return accountingFingerprint({
			model: ctx.model && modelKey(ctx.model),
			checkpoint: checkpoint.status === "valid" ? checkpoint.checkpoint.entryId : checkpoint.status,
			system: ctx.getSystemPrompt(),
			tools: pi.getAllTools(),
			activeTools: pi.getActiveTools(),
			payload: basePayloadBySession.get(ctx.sessionManager.getSessionId()),
		});
	};
	const baseSystemPromptBySession = new Map<string, string>();
	const turnStateBySession = new Map<string, { value?: string }>();
	const currentTurnState = (sessionId: string) => {
		let turn = turnStateBySession.get(sessionId);
		if (!turn) {
			turn = {};
			turnStateBySession.set(sessionId, turn);
		}
		return turn;
	};
	const remoteCompactionPresentationBySession = new Map<string, RemoteCompactionPresentation>();
	const activePiCompactionSessions = new Set<string>();
	const activePiCompactionControllerBySession = new Map<string, AbortController>();
	const pendingPiCompactionBySession = new Map<string, {
		baselineCompactionIds: Set<string>;
		expectedDetails: NativeCompactionDetails;
		firstKeptEntryId: string;
		modelKey: string;
		reason: "manual" | "threshold" | "overflow";
		summary: string;
		tokensBefore: number;
		willRetry: boolean;
	}>();
	const preparingRequests = new Set<{
		sessionId: string;
		ctx: ExtensionContext;
		requestSignal: AbortSignal | undefined;
		controller: AbortController;
	}>();
	const cancelPreparingRequests = (sessionId?: string): void => {
		for (const request of preparingRequests) {
			if (sessionId !== undefined && request.sessionId !== sessionId) continue;
			request.controller.abort();
			// Context getters are live. Never abort a newer run through a stale context.
			safely(() => {
				if (!request.requestSignal?.aborted && request.ctx.signal === request.requestSignal) request.ctx.abort();
			});
			preparingRequests.delete(request);
		}
	};
	let lifecycleGeneration = 0;
	const deferredPiCompactionNotices = new Map<ReturnType<typeof setTimeout>, string>();
	const clearDeferredPiCompactionNotices = (sessionId?: string): void => {
		for (const [timer, noticeSessionId] of deferredPiCompactionNotices) {
			if (sessionId !== undefined && noticeSessionId !== sessionId) continue;
			clearTimeout(timer);
			deferredPiCompactionNotices.delete(timer);
		}
	};
	const schedulePostCompactionNotice = (
		ctx: CompactionNoticeContext,
		message: string,
		type: "info" | "warning" | "error",
	): void => {
		if (!ctx.hasUI) return;
		const sessionId = ctx.sessionManager.getSessionId();
		const generation = lifecycleGeneration;
		let timer: ReturnType<typeof setTimeout> | undefined;
		// Pi rebuilds the interactive transcript after session_compact handlers finish.
		// Defer one macrotask so chatContainer.clear() does not discard this notice.
		timer = setTimeout(() => {
			if (timer) deferredPiCompactionNotices.delete(timer);
			if (generation !== lifecycleGeneration) return;
			let activeSessionId: string;
			try {
				activeSessionId = ctx.sessionManager.getSessionId();
			} catch {
				return;
			}
			if (activeSessionId !== sessionId) return;
			safely(() => ctx.ui.notify(message, type));
		}, 0);
		deferredPiCompactionNotices.set(timer, sessionId);
	};
	const rememberTurnState = (sessionId: string, state: string): void => {
		const turn = currentTurnState(sessionId);
		turn.value ??= state;
	};
	const clearRemoteCompactionPresentation = (
		sessionId: string,
		expected?: RemoteCompactionPresentation,
	): void => {
		const presentation = remoteCompactionPresentationBySession.get(sessionId);
		if (!presentation || (expected && presentation !== expected)) return;
		remoteCompactionPresentationBySession.delete(sessionId);
		if (presentation.ctx.hasUI) {
			safely(() => presentation.ctx.ui.setWidget("codex-compact", undefined, COMPACTION_WIDGET_OPTIONS));
		}
	};
	const presentRemoteCompaction = async <T>(
		ctx: CompactionNoticeContext,
		reason: RemoteCompactionReason,
		operation: () => Promise<T>,
		completed: (result: T) => boolean = () => true,
	): Promise<T> => {
		const sessionId = ctx.sessionManager.getSessionId();
		clearRemoteCompactionPresentation(sessionId);
		const presentation = ctx.hasUI ? { ctx } : undefined;
		if (presentation) {
			remoteCompactionPresentationBySession.set(sessionId, presentation);
			safely(() => ctx.ui.setWidget("codex-compact", createCompactionWidget(), COMPACTION_WIDGET_OPTIONS));
		}
		const label = remoteCompactionReasonLabel(reason);
		try {
			const result = await operation();
			if (presentation && remoteCompactionPresentationBySession.get(sessionId) === presentation && completed(result)) {
				safely(() => ctx.ui.notify(`Codex context compacted (${label}).`, "info"));
			}
			return result;
		} finally {
			if (presentation) clearRemoteCompactionPresentation(sessionId, presentation);
		}
	};
	const createCheckpoint = (params: Pick<NativeCheckpointRequest, "ctx" | "model" | "input" | "basePayload" | "signal" | "protectedInput" | "replayContextWindow" | "projectReplay"> & { compactionHashes: CompactionHashSnapshot }) => {
		const lifecycleGenerationAtStart = lifecycleGeneration;
		const sessionId = params.ctx.sessionManager.getSessionId();
		let basePayload = params.basePayload ?? basePayloadBySession.get(sessionId);
		if (!params.basePayload && basePayload && baseSystemPromptBySession.get(sessionId) !== params.ctx.getSystemPrompt()) {
			// Cached request transformations remain valid only while their source prompt is unchanged.
			basePayload = { ...basePayload, instructions: params.ctx.getSystemPrompt() };
		}
		const turn = currentTurnState(sessionId);
		return createNativeCheckpoint({
			...params,
			compHash: params.compactionHashes.hashFor(params.model),
			basePayload,
			turnState: turn.value,
			onTurnState: (state) => {
				if (lifecycleGeneration === lifecycleGenerationAtStart && !params.signal?.aborted && turnStateBySession.get(sessionId) === turn) {
					rememberTurnState(sessionId, state);
				}
			},
			allTools: pi.getAllTools(),
			activeToolNames: pi.getActiveTools(),
		});
	};

	const coordinator = createSessionCoordinator({
		resolveCompactionHashes,
		getBranch: (ctx) => ctx.sessionManager.getBranch() as SessionEntry[],
		getAllTools: () => pi.getAllTools(),
		createCheckpoint,
		appendCheckpoint: (details) => pi.appendEntry(NATIVE_COMPACTION_KIND, details),
		appendCheckpointBypass: (bypass) => pi.appendEntry(NATIVE_COMPACTION_BYPASS_KIND, bypass),
		appendFailedRequest: (details) => pi.appendEntry(FAILED_REQUEST_KIND, details),
		onAutomaticCompactionFailure: (failureCtx, error) => {
			reportCompactionFailure(
				failureCtx as unknown as CompactionNoticeContext,
				failureCtx.model,
				error,
				"before_provider_request",
				"compaction_skipped",
			);
		},
		shouldAutoCompact: ({ ctx, model, input, reason }) => {
			const config = loadConfig(ctx.cwd, ctx.isProjectTrusted());
			// Fall back locally unless a successful observed request covers this exact history.
			const supportsStrictMode = (model.compat as { supportsStrictMode?: boolean } | undefined)?.supportsStrictMode !== false;
			const observedPayload = basePayloadBySession.get(ctx.sessionManager.getSessionId());
			const estimatedStablePrefixTokens = approximateTokenCount(observedPayload ? {
				instructions: observedPayload.instructions,
				tools: observedPayload.tools,
			} : {
				instructions: ctx.getSystemPrompt(),
				tools: buildToolPayload(pi.getAllTools(), pi.getActiveTools(), supportsStrictMode),
			});
			const branch = ctx.sessionManager.getBranch() as SessionEntry[];
			const lastAssistant = branch.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
			const accounted = usageBySession.get(ctx.sessionManager.getSessionId())?.estimate(
				requestFingerprint(ctx), input,
				lastAssistant?.type === "message" ? lastAssistant.message : undefined,
				approximateResponseItemTokens,
			);
			const activeContextTokens = accounted ?? approximateResponseItemTokens(input) + estimatedStablePrefixTokens;
			const prefillTokens = config.autoCompactScope === "bodyAfterPrefix"
				? estimateCompactionWindowPrefillTokens({
						branch: ctx.sessionManager.getBranch() as SessionEntry[],
						stablePrefixTokens: estimatedStablePrefixTokens,
						targetModelKey: modelKey(model),
					})
				: undefined;
			const limit = autoCompactTokenLimit(config, model.contextWindow);
			return shouldAutoCompact({
				status: {
					activeContextTokens,
					contextWindow: effectiveContextWindow(config, model.contextWindow),
					...(prefillTokens !== undefined ? { prefillTokens } : {}),
				},
				limit,
				scope: config.autoCompactScope,
				reason,
			});
		},
		runCompaction: (ctx, reason, operation) => presentRemoteCompaction(ctx, reason, operation),
	});

	const abortPiCompaction = (sessionId: string): void => {
		activePiCompactionControllerBySession.get(sessionId)?.abort();
		activePiCompactionControllerBySession.delete(sessionId);
	};
	const clearTransient = () => {
		lifecycleGeneration++;
		metadataStore.clear();
		cancelPreparingRequests();
		clearDeferredPiCompactionNotices();
		for (const controller of activePiCompactionControllerBySession.values()) controller.abort();
		activePiCompactionControllerBySession.clear();
		coordinator.clear();
		for (const sessionId of [...remoteCompactionPresentationBySession.keys()]) {
			clearRemoteCompactionPresentation(sessionId);
		}
		activePiCompactionSessions.clear();
		pendingPiCompactionBySession.clear();
		basePayloadBySession.clear();
		usageBySession.clear();
		baseSystemPromptBySession.clear();
		turnStateBySession.clear();
	};
	pi.on("session_start", clearTransient);
	pi.on("session_shutdown", clearTransient);
	pi.on("session_tree", clearTransient);
	// A queued input is not a delivered user message. Retries emit no user message;
	// steering/follow-ups do, even when they remain in the same low-level agent run.
	pi.on("message_start", (event, ctx) => {
		if (event.message.role === "user") turnStateBySession.delete(ctx.sessionManager.getSessionId());
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.isIdle?.() !== false) turnStateBySession.delete(ctx.sessionManager.getSessionId());
	});
	pi.on("model_select", (event, ctx) => {
		lifecycleGeneration++;
		metadataStore.cancelPending();
		const sessionId = ctx.sessionManager.getSessionId();
		cancelPreparingRequests(sessionId);
		clearDeferredPiCompactionNotices(sessionId);
		abortPiCompaction(sessionId);
		clearRemoteCompactionPresentation(sessionId);
		activePiCompactionSessions.delete(sessionId);
		pendingPiCompactionBySession.delete(sessionId);
		usageBySession.delete(sessionId);
		return coordinator.selectModel(event, ctx);
	});

	// `context` collapses system deltas when a handler removes the Pi summary.
	// Own the full transcript so provider replay and branch-prefix validation agree.
	pi.on("context_with_system", (event, ctx) => {
		const branch = ctx.sessionManager.getBranch() as SessionEntry[];
		const model = ctx.model;
		const codexModel = isOpenAICodexModel(model);
		const checkpoint = findNativeCheckpoint(branch, codexModel ? modelKey(model) : undefined);
		const replayFullHistory = () => {
			const messages = projectBranchMessages(branch).flat();
			const head = event.messages[0];
			// Legacy branches can start with a user before their first system delta.
			// Keep Pi's existing baseline rather than dropping its prompt/tool declarations.
			return { messages: head?.role === "system" && messages[0]?.role !== "system" ? [head, ...messages] : messages };
		};
		if (!codexModel) {
			if (checkpoint.status === "none") return undefined;
			return replayFullHistory();
		}
		if (checkpoint.status === "invalid" || checkpoint.status === "bypassed") {
			return replayFullHistory();
		}
		if (checkpoint.status !== "valid") return undefined;
		return {
			messages: event.messages.filter((message) => message.role !== "compactionSummary"),
		};
	});

	pi.on("before_provider_headers", (event, ctx) => {
		if (!isOpenAICodexModel(ctx.model)) return;
		const existingFeatureHeader = Object.entries(event.headers)
			.find(([name]) => name.toLowerCase() === "x-codex-beta-features");
		event.headers[existingFeatureHeader?.[0] ?? "x-codex-beta-features"] = mergeFeatureHeader(existingFeatureHeader?.[1]);
		const turnState = turnStateBySession.get(ctx.sessionManager.getSessionId())?.value;
		if (turnState) event.headers["x-codex-turn-state"] = turnState;
	});

	pi.on("after_provider_response", (event, ctx) => {
		if (!isOpenAICodexModel(ctx.model) || !ctx.signal || ctx.signal.aborted) return;
		const turnState = Object.entries(event.headers).find(([name]) => name.toLowerCase() === "x-codex-turn-state")?.[1];
		if (turnState) rememberTurnState(ctx.sessionManager.getSessionId(), turnState);
	});

	pi.on("message_end", (event, ctx) => {
		if (!isOpenAICodexModel(ctx.model)) return;
		usageBySession.get(ctx.sessionManager.getSessionId())?.observeResponse(event.message);
	});

	pi.on("before_provider_request", async (event, ctx) => {
		const model = ctx.model;
		if (!isOpenAICodexModel(model) || !isJsonObject(event.payload)) return undefined;
		delete event.payload.prompt_cache_retention;
		const sessionId = ctx.sessionManager.getSessionId();
		const requestInput = Array.isArray(event.payload.input) ? event.payload.input : undefined;
		const basePayload = stripInputFromPayload(event.payload);
		basePayloadBySession.set(sessionId, basePayload);
		baseSystemPromptBySession.set(sessionId, ctx.getSystemPrompt());
		const lifecycleGenerationAtStart = lifecycleGeneration;
		const requestSignal = ctx.signal;
		const controller = new AbortController();
		const request = { sessionId, ctx, requestSignal, controller };
		preparingRequests.add(request);
		// Freeze this operation's signal while retaining live session/model getters.
		const operationContext: ExtensionContext = Object.create(ctx);
		Object.defineProperty(operationContext, "signal", {
			value: requestSignal ? AbortSignal.any([requestSignal, controller.signal]) : controller.signal,
		});
		try {
			const input = await coordinator.prepareRequest(model, operationContext, requestInput, basePayload);
			if (lifecycleGeneration !== lifecycleGenerationAtStart || requestSignal?.aborted) return undefined;
			const payload = input ? { ...stripInputFromPayload(event.payload), input } : event.payload;
			const accounting = usageBySession.get(sessionId) ?? new WindowUsageAccounting();
			usageBySession.set(sessionId, accounting);
			accounting.observeRequest(requestFingerprint(ctx), Array.isArray(payload.input) ? payload.input : []);
			return payload;
		} catch (error) {
			if (lifecycleGeneration !== lifecycleGenerationAtStart || requestSignal?.aborted) return undefined;
			const code = compactionFailureClassification(error);
			try {
				ctx.abort();
			} catch {}
			reportCompactionFailure(
				ctx,
				model,
				error,
				"before_provider_request",
				"request_aborted",
			);
			try {
				coordinator.recordFailedRequest(ctx, requestInput, {
					phase: "before_provider_request",
					code,
					recoveryAttempted: false,
					...(error instanceof HistoryPrefixMismatchError ? { errorType: error.name as "HistoryPrefixMismatchError", mismatchIndex: error.mismatchIndex } : {}),
				});
			} catch {}
			// The abort signal stops Pi's provider call. A synthetic `input: null`
			// would create a second protocol error.
			return undefined;
		} finally {
			preparingRequests.delete(request);
		}
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const model = ctx.model;
		if (!model || !isOpenAICodexModel(model)) return undefined;
		try {
			const sessionId = ctx.sessionManager.getSessionId();
			if (
				activePiCompactionSessions.has(sessionId)
				|| pendingPiCompactionBySession.has(sessionId)
			) return { cancel: true };
			activePiCompactionSessions.add(sessionId);
			const lifecycleController = new AbortController();
			const operationSignal = AbortSignal.any([event.signal, lifecycleController.signal]);
			activePiCompactionControllerBySession.set(sessionId, lifecycleController);
			try {
				const lifecycleGenerationAtStart = lifecycleGeneration;
				const baselineCompactionIds = new Set(
					(ctx.sessionManager.getEntries() as SessionEntry[])
						.filter((entry) => entry.type === "compaction")
						.map((entry) => entry.id),
				);
				const excludeLastAssistantError = event.reason === "overflow" && event.willRetry;
				let native: Awaited<ReturnType<typeof createNativeCheckpoint>>;
				let input: ResponseItem[];
				let plan: CompactionInputPlan;
				try {
					plan = await coordinator.prepareCompactionPlan(
						model,
						ctx,
						excludeLastAssistantError,
						operationSignal,
						basePayloadBySession.get(sessionId),
					);
					input = plan.input;
					if (lifecycleGeneration !== lifecycleGenerationAtStart) return { cancel: true };
					const compactionHashes = await resolveCompactionHashes(ctx, model, operationSignal);
					if (lifecycleGeneration !== lifecycleGenerationAtStart || operationSignal.aborted) return { cancel: true };
					plan.assertCurrent?.();
					native = await createCheckpoint({ ctx, model, input, protectedInput: plan.preservedInput, projectReplay: plan.projectReplay, basePayload: plan.basePayload, signal: operationSignal, compactionHashes });
					plan.assertCurrent?.();
				} catch (error) {
					if (lifecycleGeneration !== lifecycleGenerationAtStart || operationSignal.aborted) return { cancel: true };
					reportCompactionFailure(ctx, model, error, "session_before_compact", "compaction_cancelled");
					return { cancel: true };
				}
				if (lifecycleGeneration !== lifecycleGenerationAtStart || operationSignal.aborted) {
					return { cancel: true };
				}
				const details = appendPreservedInput(native.details, plan.preservedInput, plan.preservedInputSources);
				pendingPiCompactionBySession.set(sessionId, {
					baselineCompactionIds,
					expectedDetails: structuredClone(details),
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					modelKey: modelKey(model),
					reason: event.reason,
					summary: LOCAL_MARKER,
					tokensBefore: event.preparation.tokensBefore,
					willRetry: event.willRetry,
				});

				return {
					compaction: {
						summary: LOCAL_MARKER,
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
						usage: native.usage,
						details,
					},
				};
			} finally {
				if (activePiCompactionControllerBySession.get(sessionId) === lifecycleController) {
					activePiCompactionControllerBySession.delete(sessionId);
					if (!pendingPiCompactionBySession.has(sessionId)) activePiCompactionSessions.delete(sessionId);
				}
			}
		} catch (error) {
			safely(() => {
				const sessionId = ctx.sessionManager.getSessionId();
				activePiCompactionSessions.delete(sessionId);
				pendingPiCompactionBySession.delete(sessionId);
			});
			if (!event.signal.aborted) {
				reportCompactionFailure(
					ctx,
					model,
					error,
					"session_before_compact",
					"compaction_cancelled",
				);
			}
			return { cancel: true };
		}
	});

	pi.on("session_compact_failed", (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		clearDeferredPiCompactionNotices(sessionId);
		abortPiCompaction(sessionId);
		activePiCompactionSessions.delete(sessionId);
		pendingPiCompactionBySession.delete(sessionId);
	});

	pi.on("session_compact", (event, ctx) => {
		usageBySession.delete(ctx.sessionManager.getSessionId());
		const sessionId = ctx.sessionManager.getSessionId();
		const attempt = pendingPiCompactionBySession.get(sessionId);
		if (!attempt) return;
		activePiCompactionSessions.delete(sessionId);
		pendingPiCompactionBySession.delete(sessionId);
		try {
			const committedEntry = (ctx.sessionManager.getEntries() as SessionEntry[]).findLast((entry) =>
				entry.type === "compaction" && !attempt.baselineCompactionIds.has(entry.id)
			);
			const details = committedEntry?.type === "compaction"
				? parseNativeCompactionDetails(committedEntry.details)
				: undefined;
			const verified = committedEntry?.type === "compaction"
				&& event.reason === attempt.reason
				&& event.willRetry === attempt.willRetry
				&& committedEntry.summary === attempt.summary
				&& committedEntry.firstKeptEntryId === attempt.firstKeptEntryId
				&& committedEntry.tokensBefore === attempt.tokensBefore
				&& (event.fromExtension || committedEntry.fromHook === true)
				&& details?.modelKey === attempt.modelKey
				&& isDeepStrictEqual(details, attempt.expectedDetails);
			if (!ctx.hasUI) return;
			if (verified) {
				schedulePostCompactionNotice(ctx, VERIFIED_COMPACTION_NOTICE, "info");
				return;
			}
			if (
				committedEntry?.type === "compaction"
				&& !event.fromExtension
				&& committedEntry.fromHook !== true
			) {
				schedulePostCompactionNotice(ctx, LOCAL_COMPACTION_NOTICE, "warning");
				return;
			}
			schedulePostCompactionNotice(ctx, UNVERIFIED_COMPACTION_NOTICE, "warning");
		} catch {
			schedulePostCompactionNotice(ctx, UNVERIFIED_COMPACTION_NOTICE, "warning");
		}
	});

}
