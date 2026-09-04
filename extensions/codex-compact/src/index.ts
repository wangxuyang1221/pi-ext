import { isDeepStrictEqual } from "node:util";
import { sessionEntryToContextMessages, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { shouldAutoCompact } from "./scheduler.js";
import { createCompactionWidget, type CompactionWidgetFactory } from "./presentation.js";
import { autoCompactTokenLimit, loadConfig } from "./config.js";
import { createNativeCheckpoint, type NativeCheckpointRequest } from "./remote-compaction.js";
import { createSessionCoordinator, type RemoteCompactionReason } from "./session-coordinator.js";
import {
	estimateCompactionWindowPrefillTokens,
	FAILED_REQUEST_KIND,
	findNativeCheckpoint,
	fullInputForBranch,
	isJsonObject,
	isOpenAICodexModel,
	mergeFeatureHeader,
	approximateResponseItemTokens,
	isContextWindowCompactionError,
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

function failureNextStep(code: string, recoveryAttempted: boolean): string {
	if (code === "authentication" || AUTHENTICATION_FAILURE_CODE_PATTERN.test(code)) {
		return "check Codex authentication and retry manually";
	}
	if (code === "policy_or_quota" || POLICY_OR_QUOTA_FAILURE_CODE_PATTERN.test(code)) {
		return "check Codex plan, permissions, quota, and billing before retrying manually";
	}
	if (code === "context_window_exceeded" || recoveryAttempted) return "shorten the request or start a new session";
	if (code === "network" || code === "timeout") return "check the connection and retry manually";
	return "retry manually or start a new session";
}

function remoteCompactionReasonLabel(reason: RemoteCompactionReason): string {
	if (reason === "model-transition") return "model transition";
	if (reason === "context-overflow-recovery") return "context overflow recovery";
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
	recoveryAttempted: boolean,
	outcome: FailureOutcome,
): string {
	const code = compactionFailureClassification(error);
	const modelId = typeof model?.id === "string" && /^[a-zA-Z0-9_.:-]{1,64}$/.test(model.id) ? model.id : "unknown";
	const next = outcome === "compaction_skipped"
		? "request continues without compaction"
		: failureNextStep(code, recoveryAttempted);
	const notice = `OpenAI Codex failure: phase=${phase}; code=${code}; model=${modelId}; recoveryAttempted=${recoveryAttempted}; outcome=${outcome}; next=${next}.`;
	if (ctx.hasUI) safely(() => ctx.ui.notify(notice, outcome === "compaction_skipped" ? "warning" : "error"));
	else safely(() => console.error(notice));
	return code;
}

export default function codexCompactionExtension(pi: ExtensionAPI): void {
	const basePayloadBySession = new Map<string, JsonObject>();
	const turnStateBySession = new Map<string, string>();
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
		if (!turnStateBySession.has(sessionId)) turnStateBySession.set(sessionId, state);
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
		const existingPresentation = remoteCompactionPresentationBySession.get(sessionId);
		const resumesOverflowRecovery = reason === "context-overflow-recovery"
			&& existingPresentation !== undefined;
		let presentation = resumesOverflowRecovery ? existingPresentation : undefined;
		if (!resumesOverflowRecovery) {
			clearRemoteCompactionPresentation(sessionId);
			if (ctx.hasUI) {
				presentation = { ctx };
				remoteCompactionPresentationBySession.set(sessionId, presentation);
				safely(() => ctx.ui.setWidget("codex-compact", createCompactionWidget(), COMPACTION_WIDGET_OPTIONS));
			}
		}
		const label = remoteCompactionReasonLabel(reason);
		let retainForOverflowRecovery = false;
		try {
			const result = await operation();
			if (ctx.hasUI && completed(result)) safely(() => ctx.ui.notify(`Codex context compacted (${label}).`, "info"));
			return result;
		} catch (error) {
			retainForOverflowRecovery = !resumesOverflowRecovery && isContextWindowCompactionError(error);
			throw error;
		} finally {
			if (!retainForOverflowRecovery && presentation) {
				clearRemoteCompactionPresentation(sessionId, presentation);
			}
		}
	};
	const createCheckpoint = (params: Pick<NativeCheckpointRequest, "ctx" | "model" | "input" | "basePayload" | "signal">) => {
		const lifecycleGenerationAtStart = lifecycleGeneration;
		const sessionId = params.ctx.sessionManager.getSessionId();
		return createNativeCheckpoint({
			...params,
			basePayload: params.basePayload ?? basePayloadBySession.get(sessionId),
			turnState: turnStateBySession.get(sessionId),
			onTurnState: (state) => {
				if (lifecycleGeneration === lifecycleGenerationAtStart) rememberTurnState(sessionId, state);
			},
			allTools: pi.getAllTools(),
			activeToolNames: pi.getActiveTools(),
		});
	};

	const coordinator = createSessionCoordinator({
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
				false,
				"compaction_skipped",
			);
		},
		shouldAutoCompact: ({ ctx, model, input, reason }) => {
			const config = loadConfig(ctx.cwd, ctx.isProjectTrusted());
			// Pi exposes assistant usage but not Codex's window counters; estimate the stable prefix.
			const supportsStrictMode = (model.compat as { supportsStrictMode?: boolean } | undefined)?.supportsStrictMode !== false;
			const estimatedStablePrefixTokens = approximateTokenCount({
				instructions: ctx.getSystemPrompt(),
				tools: buildToolPayload(pi.getAllTools(), pi.getActiveTools(), supportsStrictMode),
			});
			const activeContextTokens = approximateResponseItemTokens(input) + estimatedStablePrefixTokens;
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
					contextWindow: model.contextWindow,
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
		turnStateBySession.clear();
	};
	pi.on("session_start", clearTransient);
	pi.on("session_shutdown", clearTransient);
	pi.on("session_tree", clearTransient);
	const clearTurnState = (_event: unknown, ctx: { sessionManager: { getSessionId(): string } }) => {
		turnStateBySession.delete(ctx.sessionManager.getSessionId());
	};
	pi.on("turn_start", clearTurnState);
	pi.on("turn_end", clearTurnState);
	pi.on("model_select", (event, ctx) => {
		lifecycleGeneration++;
		const sessionId = ctx.sessionManager.getSessionId();
		clearDeferredPiCompactionNotices(sessionId);
		abortPiCompaction(sessionId);
		clearRemoteCompactionPresentation(sessionId);
		activePiCompactionSessions.delete(sessionId);
		pendingPiCompactionBySession.delete(sessionId);
		return coordinator.selectModel(event, ctx);
	});

	pi.on("context", (event, ctx) => {
		const branch = ctx.sessionManager.getBranch() as SessionEntry[];
		const model = ctx.model;
		const codexModel = isOpenAICodexModel(model);
		const checkpoint = findNativeCheckpoint(branch, codexModel ? modelKey(model) : undefined);
		if (!codexModel) {
			if (checkpoint.status === "none") return undefined;
			return {
				messages: branch.flatMap((entry) => entry.type === "compaction" ? [] : sessionEntryToContextMessages(entry)),
			};
		}
		if (checkpoint.status === "invalid" || checkpoint.status === "bypassed") {
			return {
				messages: branch.flatMap((entry) => entry.type === "compaction" ? [] : sessionEntryToContextMessages(entry)),
			};
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
		const turnState = turnStateBySession.get(ctx.sessionManager.getSessionId());
		if (turnState) event.headers["x-codex-turn-state"] = turnState;
	});

	pi.on("after_provider_response", (event, ctx) => {
		if (!isOpenAICodexModel(ctx.model)) return;
		const turnState = Object.entries(event.headers).find(([name]) => name.toLowerCase() === "x-codex-turn-state")?.[1];
		if (turnState) rememberTurnState(ctx.sessionManager.getSessionId(), turnState);
	});

	pi.on("before_provider_request", async (event, ctx) => {
		const model = ctx.model;
		if (!isOpenAICodexModel(model) || !isJsonObject(event.payload)) return undefined;
		delete event.payload.prompt_cache_retention;
		const sessionId = ctx.sessionManager.getSessionId();
		const requestInput = Array.isArray(event.payload.input) ? event.payload.input : undefined;
		const basePayload = stripInputFromPayload(event.payload);
		basePayloadBySession.set(sessionId, basePayload);
		let recovery: "context-overflow" | undefined;
		for (;;) {
			try {
				const input = await coordinator.prepareRequest(
					model,
					ctx,
					requestInput,
					basePayload,
					false,
					recovery,
				);
				if (!input) return event.payload;
				const payload = stripInputFromPayload(event.payload);
				payload.input = input;
				return payload;
			} catch (error) {
				if (ctx.signal?.aborted) {
					clearRemoteCompactionPresentation(sessionId);
					return undefined;
				}
				if (recovery === undefined && isContextWindowCompactionError(error)) {
					recovery = "context-overflow";
					continue;
				}
				const recoveryAttempted = recovery !== undefined;
				const code = compactionFailureClassification(error);
				clearRemoteCompactionPresentation(sessionId);
				try {
					ctx.abort();
				} catch {}
				reportCompactionFailure(
					ctx,
					model,
					error,
					"before_provider_request",
					recoveryAttempted,
					"request_aborted",
				);
				try {
					coordinator.recordFailedRequest(ctx, requestInput, {
						phase: "before_provider_request",
						code,
						recoveryAttempted,
					});
				} catch {}
				// The abort signal stops Pi's provider call. A synthetic `input: null`
				// would create a second protocol error.
				return undefined;
			}
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
				const branch = event.branchEntries as SessionEntry[];
				const requestInput = fullInputForBranch({
					branch,
					model,
					tools: pi.getAllTools(),
				});
				const excludeLastAssistantError = event.reason === "overflow" && event.willRetry;
				let recovery: "context-overflow" | undefined;
				let native: Awaited<ReturnType<typeof createNativeCheckpoint>> | undefined;
				let input: ResponseItem[] | undefined;
				for (;;) {
					try {
						const resumesPreparedInput = recovery === "context-overflow" && input !== undefined;
						input = await coordinator.prepareCompaction(
							model,
							ctx,
							resumesPreparedInput ? input : requestInput,
							resumesPreparedInput ? false : excludeLastAssistantError,
							operationSignal,
							recovery,
							basePayloadBySession.get(sessionId),
						);
						if (lifecycleGeneration !== lifecycleGenerationAtStart) return { cancel: true };
						native = await createCheckpoint({
							ctx,
							model,
							input,
							signal: operationSignal,
						});
						if (lifecycleGeneration !== lifecycleGenerationAtStart) return { cancel: true };
						break;
					} catch (error) {
						if (lifecycleGeneration !== lifecycleGenerationAtStart || operationSignal.aborted) return { cancel: true };
						if (recovery === undefined && isContextWindowCompactionError(error)) {
							recovery = "context-overflow";
							continue;
						}
						reportCompactionFailure(
							ctx,
							model,
							error,
							"session_before_compact",
							recovery !== undefined,
							"compaction_cancelled",
						);
						return { cancel: true };
					}
				}
				if (lifecycleGeneration !== lifecycleGenerationAtStart || operationSignal.aborted || !native || !input) {
					return { cancel: true };
				}
				const requestUser = input.findLast((item) => item.role === "user");
				const knownUsers = [
					...native.details.replacementHistory,
					...(native.details.preservedInput ?? []),
				];
				const details = requestUser && !knownUsers.some((item) =>
					item.role === "user" && JSON.stringify(item.content) === JSON.stringify(requestUser.content)
				)
					? { ...native.details, preservedInput: [...(native.details.preservedInput ?? []), structuredClone(requestUser)] }
					: native.details;
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
				}
				if (!pendingPiCompactionBySession.has(sessionId)) activePiCompactionSessions.delete(sessionId);
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
					false,
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
