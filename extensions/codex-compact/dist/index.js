import { isDeepStrictEqual } from "node:util";
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { accountingFingerprint, WindowUsageAccounting } from "./usage-accounting.js";
import { shouldAutoCompact } from "./scheduler.js";
import { createCompactionWidget } from "./presentation.js";
import { autoCompactTokenLimit, effectiveContextWindow, loadConfig } from "./config.js";
import { createNativeCheckpoint } from "./remote-compaction.js";
import { createSessionCoordinator } from "./session-coordinator.js";
import { estimateCompactionWindowPrefillTokens, FAILED_REQUEST_KIND, findNativeCheckpoint, isJsonObject, isOpenAICodexModel, mergeFeatureHeader, approximateResponseItemTokens, compactionFailureClassification, approximateTokenCount, buildToolPayload, stripInputFromPayload, NATIVE_COMPACTION_BYPASS_KIND, NATIVE_COMPACTION_KIND, modelKey, parseNativeCompactionDetails, } from "./native-compaction.js";
const LOCAL_MARKER = "Codex encrypted compaction item.";
const VERIFIED_COMPACTION_NOTICE = "Codex compaction applied";
const LOCAL_COMPACTION_NOTICE = "Pi local compaction used";
const UNVERIFIED_COMPACTION_NOTICE = "Codex compaction not confirmed";
const AUTHENTICATION_FAILURE_CODE_PATTERN = /^(?:authentication|authentication_error|auth_error|authorization_error|credential_error|invalid_api_key|invalid_credential|invalid_token|expired_token|token_expired|unauthorized|forbidden|permission_denied|access_denied)$/;
const POLICY_OR_QUOTA_FAILURE_CODE_PATTERN = /^(?:policy_or_quota|policy_violation|insufficient_quota|quota_exceeded|usage_limit_(?:reached|exceeded)|usage_not_included|billing_(?:error|issue|required)|insufficient_funds|out_of_budget)$/;
function failureNextStep(code) {
    if (code === "authentication" || AUTHENTICATION_FAILURE_CODE_PATTERN.test(code)) {
        return "check Codex authentication and retry manually";
    }
    if (code === "policy_or_quota" || POLICY_OR_QUOTA_FAILURE_CODE_PATTERN.test(code)) {
        return "check Codex plan, permissions, quota, and billing before retrying manually";
    }
    if (code === "context_window_exceeded" || code === "context_length_exceeded")
        return "shorten the request or start a new session";
    if (code === "network" || code === "timeout")
        return "check the connection and retry manually";
    return "retry manually or start a new session";
}
function remoteCompactionReasonLabel(reason) {
    if (reason === "model-transition")
        return "model transition";
    if (reason === "context-recovery")
        return "context recovery";
    return reason;
}
function safely(operation) {
    try {
        operation();
    }
    catch { }
}
const COMPACTION_WIDGET_OPTIONS = { placement: "aboveEditor" };
function reportCompactionFailure(ctx, model, error, phase, outcome) {
    const code = compactionFailureClassification(error);
    const modelId = typeof model?.id === "string" && /^[a-zA-Z0-9_.:-]{1,64}$/.test(model.id) ? model.id : "unknown";
    const next = outcome === "compaction_skipped"
        ? "request continues without compaction"
        : failureNextStep(code);
    // Preserve the legacy diagnostic field without implying a removed recovery attempt.
    const recoveryAttempted = false;
    const notice = `OpenAI Codex failure: phase=${phase}; code=${code}; model=${modelId}; recoveryAttempted=${recoveryAttempted}; outcome=${outcome}; next=${next}.`;
    if (ctx.hasUI)
        safely(() => ctx.ui.notify(notice, outcome === "compaction_skipped" ? "warning" : "error"));
    else
        safely(() => console.error(notice));
    return code;
}
export default function codexCompactionExtension(pi) {
    const basePayloadBySession = new Map();
    const usageBySession = new Map();
    const requestFingerprint = (ctx) => {
        const checkpoint = findNativeCheckpoint(ctx.sessionManager.getBranch(), ctx.model && modelKey(ctx.model));
        return accountingFingerprint({
            model: ctx.model && modelKey(ctx.model),
            checkpoint: checkpoint.status === "valid" ? checkpoint.checkpoint.entryId : checkpoint.status,
            system: ctx.getSystemPrompt(),
            tools: pi.getAllTools(),
            activeTools: pi.getActiveTools(),
            payload: basePayloadBySession.get(ctx.sessionManager.getSessionId()),
        });
    };
    const baseSystemPromptBySession = new Map();
    const turnStateBySession = new Map();
    const remoteCompactionPresentationBySession = new Map();
    const activePiCompactionSessions = new Set();
    const activePiCompactionControllerBySession = new Map();
    const pendingPiCompactionBySession = new Map();
    let lifecycleGeneration = 0;
    const deferredPiCompactionNotices = new Map();
    const clearDeferredPiCompactionNotices = (sessionId) => {
        for (const [timer, noticeSessionId] of deferredPiCompactionNotices) {
            if (sessionId !== undefined && noticeSessionId !== sessionId)
                continue;
            clearTimeout(timer);
            deferredPiCompactionNotices.delete(timer);
        }
    };
    const schedulePostCompactionNotice = (ctx, message, type) => {
        if (!ctx.hasUI)
            return;
        const sessionId = ctx.sessionManager.getSessionId();
        const generation = lifecycleGeneration;
        let timer;
        // Pi rebuilds the interactive transcript after session_compact handlers finish.
        // Defer one macrotask so chatContainer.clear() does not discard this notice.
        timer = setTimeout(() => {
            if (timer)
                deferredPiCompactionNotices.delete(timer);
            if (generation !== lifecycleGeneration)
                return;
            let activeSessionId;
            try {
                activeSessionId = ctx.sessionManager.getSessionId();
            }
            catch {
                return;
            }
            if (activeSessionId !== sessionId)
                return;
            safely(() => ctx.ui.notify(message, type));
        }, 0);
        deferredPiCompactionNotices.set(timer, sessionId);
    };
    const rememberTurnState = (sessionId, state) => {
        if (!turnStateBySession.has(sessionId))
            turnStateBySession.set(sessionId, state);
    };
    const clearRemoteCompactionPresentation = (sessionId, expected) => {
        const presentation = remoteCompactionPresentationBySession.get(sessionId);
        if (!presentation || (expected && presentation !== expected))
            return;
        remoteCompactionPresentationBySession.delete(sessionId);
        if (presentation.ctx.hasUI) {
            safely(() => presentation.ctx.ui.setWidget("codex-compact", undefined, COMPACTION_WIDGET_OPTIONS));
        }
    };
    const presentRemoteCompaction = async (ctx, reason, operation, completed = () => true) => {
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
        }
        finally {
            if (presentation)
                clearRemoteCompactionPresentation(sessionId, presentation);
        }
    };
    const createCheckpoint = (params) => {
        const lifecycleGenerationAtStart = lifecycleGeneration;
        const sessionId = params.ctx.sessionManager.getSessionId();
        let basePayload = params.basePayload ?? basePayloadBySession.get(sessionId);
        if (!params.basePayload && basePayload && baseSystemPromptBySession.get(sessionId) !== params.ctx.getSystemPrompt()) {
            // Cached request transformations remain valid only while their source prompt is unchanged.
            basePayload = { ...basePayload, instructions: params.ctx.getSystemPrompt() };
        }
        return createNativeCheckpoint({
            ...params,
            basePayload,
            turnState: turnStateBySession.get(sessionId),
            onTurnState: (state) => {
                if (lifecycleGeneration === lifecycleGenerationAtStart)
                    rememberTurnState(sessionId, state);
            },
            allTools: pi.getAllTools(),
            activeToolNames: pi.getActiveTools(),
        });
    };
    const coordinator = createSessionCoordinator({
        getBranch: (ctx) => ctx.sessionManager.getBranch(),
        getAllTools: () => pi.getAllTools(),
        createCheckpoint,
        appendCheckpoint: (details) => pi.appendEntry(NATIVE_COMPACTION_KIND, details),
        appendCheckpointBypass: (bypass) => pi.appendEntry(NATIVE_COMPACTION_BYPASS_KIND, bypass),
        appendFailedRequest: (details) => pi.appendEntry(FAILED_REQUEST_KIND, details),
        onAutomaticCompactionFailure: (failureCtx, error) => {
            reportCompactionFailure(failureCtx, failureCtx.model, error, "before_provider_request", "compaction_skipped");
        },
        shouldAutoCompact: ({ ctx, model, input, reason }) => {
            const config = loadConfig(ctx.cwd, ctx.isProjectTrusted());
            // Fall back locally unless a successful observed request covers this exact history.
            const supportsStrictMode = model.compat?.supportsStrictMode !== false;
            const observedPayload = basePayloadBySession.get(ctx.sessionManager.getSessionId());
            const estimatedStablePrefixTokens = approximateTokenCount(observedPayload ? {
                instructions: observedPayload.instructions,
                tools: observedPayload.tools,
            } : {
                instructions: ctx.getSystemPrompt(),
                tools: buildToolPayload(pi.getAllTools(), pi.getActiveTools(), supportsStrictMode),
            });
            const branch = ctx.sessionManager.getBranch();
            const lastAssistant = branch.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
            const accounted = usageBySession.get(ctx.sessionManager.getSessionId())?.estimate(requestFingerprint(ctx), input, lastAssistant?.type === "message" ? lastAssistant.message : undefined, approximateResponseItemTokens);
            const activeContextTokens = accounted ?? approximateResponseItemTokens(input) + estimatedStablePrefixTokens;
            const prefillTokens = config.autoCompactScope === "bodyAfterPrefix"
                ? estimateCompactionWindowPrefillTokens({
                    branch: ctx.sessionManager.getBranch(),
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
    const abortPiCompaction = (sessionId) => {
        activePiCompactionControllerBySession.get(sessionId)?.abort();
        activePiCompactionControllerBySession.delete(sessionId);
    };
    const clearTransient = () => {
        lifecycleGeneration++;
        clearDeferredPiCompactionNotices();
        for (const controller of activePiCompactionControllerBySession.values())
            controller.abort();
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
    const clearTurnState = (_event, ctx) => {
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
        usageBySession.delete(sessionId);
        return coordinator.selectModel(event, ctx);
    });
    pi.on("context", (event, ctx) => {
        const branch = ctx.sessionManager.getBranch();
        const model = ctx.model;
        const codexModel = isOpenAICodexModel(model);
        const checkpoint = findNativeCheckpoint(branch, codexModel ? modelKey(model) : undefined);
        if (!codexModel) {
            if (checkpoint.status === "none")
                return undefined;
            return {
                messages: branch.flatMap((entry) => entry.type === "compaction" ? [] : sessionEntryToContextMessages(entry)),
            };
        }
        if (checkpoint.status === "invalid" || checkpoint.status === "bypassed") {
            return {
                messages: branch.flatMap((entry) => entry.type === "compaction" ? [] : sessionEntryToContextMessages(entry)),
            };
        }
        if (checkpoint.status !== "valid")
            return undefined;
        return {
            messages: event.messages.filter((message) => message.role !== "compactionSummary"),
        };
    });
    pi.on("before_provider_headers", (event, ctx) => {
        if (!isOpenAICodexModel(ctx.model))
            return;
        const existingFeatureHeader = Object.entries(event.headers)
            .find(([name]) => name.toLowerCase() === "x-codex-beta-features");
        event.headers[existingFeatureHeader?.[0] ?? "x-codex-beta-features"] = mergeFeatureHeader(existingFeatureHeader?.[1]);
        const turnState = turnStateBySession.get(ctx.sessionManager.getSessionId());
        if (turnState)
            event.headers["x-codex-turn-state"] = turnState;
    });
    pi.on("after_provider_response", (event, ctx) => {
        if (!isOpenAICodexModel(ctx.model))
            return;
        const turnState = Object.entries(event.headers).find(([name]) => name.toLowerCase() === "x-codex-turn-state")?.[1];
        if (turnState)
            rememberTurnState(ctx.sessionManager.getSessionId(), turnState);
    });
    pi.on("message_end", (event, ctx) => {
        if (!isOpenAICodexModel(ctx.model))
            return;
        usageBySession.get(ctx.sessionManager.getSessionId())?.observeResponse(event.message);
    });
    pi.on("before_provider_request", async (event, ctx) => {
        const model = ctx.model;
        if (!isOpenAICodexModel(model) || !isJsonObject(event.payload))
            return undefined;
        delete event.payload.prompt_cache_retention;
        const sessionId = ctx.sessionManager.getSessionId();
        const requestInput = Array.isArray(event.payload.input) ? event.payload.input : undefined;
        const basePayload = stripInputFromPayload(event.payload);
        basePayloadBySession.set(sessionId, basePayload);
        baseSystemPromptBySession.set(sessionId, ctx.getSystemPrompt());
        const lifecycleGenerationAtStart = lifecycleGeneration;
        const requestSignal = ctx.signal;
        try {
            const input = await coordinator.prepareRequest(model, ctx, requestInput, basePayload);
            if (lifecycleGeneration !== lifecycleGenerationAtStart || requestSignal?.aborted)
                return undefined;
            const payload = input ? { ...stripInputFromPayload(event.payload), input } : event.payload;
            const accounting = usageBySession.get(sessionId) ?? new WindowUsageAccounting();
            usageBySession.set(sessionId, accounting);
            accounting.observeRequest(requestFingerprint(ctx), Array.isArray(payload.input) ? payload.input : []);
            return payload;
        }
        catch (error) {
            if (lifecycleGeneration !== lifecycleGenerationAtStart || requestSignal?.aborted)
                return undefined;
            const code = compactionFailureClassification(error);
            try {
                ctx.abort();
            }
            catch { }
            reportCompactionFailure(ctx, model, error, "before_provider_request", "request_aborted");
            try {
                coordinator.recordFailedRequest(ctx, requestInput, {
                    phase: "before_provider_request",
                    code,
                    recoveryAttempted: false,
                });
            }
            catch { }
            // The abort signal stops Pi's provider call. A synthetic `input: null`
            // would create a second protocol error.
            return undefined;
        }
    });
    pi.on("session_before_compact", async (event, ctx) => {
        const model = ctx.model;
        if (!model || !isOpenAICodexModel(model))
            return undefined;
        try {
            const sessionId = ctx.sessionManager.getSessionId();
            if (activePiCompactionSessions.has(sessionId)
                || pendingPiCompactionBySession.has(sessionId))
                return { cancel: true };
            activePiCompactionSessions.add(sessionId);
            const lifecycleController = new AbortController();
            const operationSignal = AbortSignal.any([event.signal, lifecycleController.signal]);
            activePiCompactionControllerBySession.set(sessionId, lifecycleController);
            try {
                const lifecycleGenerationAtStart = lifecycleGeneration;
                const baselineCompactionIds = new Set(ctx.sessionManager.getEntries()
                    .filter((entry) => entry.type === "compaction")
                    .map((entry) => entry.id));
                const excludeLastAssistantError = event.reason === "overflow" && event.willRetry;
                let native;
                let input;
                try {
                    input = await coordinator.prepareCompaction(model, ctx, excludeLastAssistantError, operationSignal);
                    if (lifecycleGeneration !== lifecycleGenerationAtStart)
                        return { cancel: true };
                    native = await createCheckpoint({ ctx, model, input, signal: operationSignal });
                }
                catch (error) {
                    if (lifecycleGeneration !== lifecycleGenerationAtStart || operationSignal.aborted)
                        return { cancel: true };
                    reportCompactionFailure(ctx, model, error, "session_before_compact", "compaction_cancelled");
                    return { cancel: true };
                }
                if (lifecycleGeneration !== lifecycleGenerationAtStart || operationSignal.aborted) {
                    return { cancel: true };
                }
                const requestUser = input.findLast((item) => item.role === "user");
                const knownUsers = [
                    ...native.details.replacementHistory,
                    ...(native.details.preservedInput ?? []),
                ];
                const details = requestUser && !knownUsers.some((item) => item.role === "user" && JSON.stringify(item.content) === JSON.stringify(requestUser.content))
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
            }
            finally {
                if (activePiCompactionControllerBySession.get(sessionId) === lifecycleController) {
                    activePiCompactionControllerBySession.delete(sessionId);
                    if (!pendingPiCompactionBySession.has(sessionId))
                        activePiCompactionSessions.delete(sessionId);
                }
            }
        }
        catch (error) {
            safely(() => {
                const sessionId = ctx.sessionManager.getSessionId();
                activePiCompactionSessions.delete(sessionId);
                pendingPiCompactionBySession.delete(sessionId);
            });
            if (!event.signal.aborted) {
                reportCompactionFailure(ctx, model, error, "session_before_compact", "compaction_cancelled");
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
        if (!attempt)
            return;
        activePiCompactionSessions.delete(sessionId);
        pendingPiCompactionBySession.delete(sessionId);
        try {
            const committedEntry = ctx.sessionManager.getEntries().findLast((entry) => entry.type === "compaction" && !attempt.baselineCompactionIds.has(entry.id));
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
            if (!ctx.hasUI)
                return;
            if (verified) {
                schedulePostCompactionNotice(ctx, VERIFIED_COMPACTION_NOTICE, "info");
                return;
            }
            if (committedEntry?.type === "compaction"
                && !event.fromExtension
                && committedEntry.fromHook !== true) {
                schedulePostCompactionNotice(ctx, LOCAL_COMPACTION_NOTICE, "warning");
                return;
            }
            schedulePostCompactionNotice(ctx, UNVERIFIED_COMPACTION_NOTICE, "warning");
        }
        catch {
            schedulePostCompactionNotice(ctx, UNVERIFIED_COMPACTION_NOTICE, "warning");
        }
    });
}
//# sourceMappingURL=index.js.map