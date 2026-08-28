import { isDeepStrictEqual } from "node:util";
import { compactionHash } from "./capabilities.js";
import { FAILED_REQUEST_KIND, NATIVE_COMPACTION_BYPASS_KIND, NATIVE_COMPACTION_BYPASS_VERSION, effectiveInputForBranch, findNativeCheckpoint, fullInputForBranch, isContextWindowCompactionError, isFailClosedCompactionError, piContextInputForBranch, isOpenAICodexModel, isJsonObject, modelKey, markContextOverflowRecovery, approximateCompactionRequestTokens, latestRemoteCompactionSuffix, } from "./native-compaction.js";
function isModelDownshift(previousModel, currentModel) {
    return modelKey(previousModel) !== modelKey(currentModel)
        && typeof previousModel.contextWindow === "number"
        && typeof currentModel.contextWindow === "number"
        && previousModel.contextWindow > currentModel.contextWindow;
}
function hashesDiffer(previousHash, currentHash) {
    return previousHash !== undefined && currentHash !== undefined && previousHash !== currentHash;
}
function needsTransitionCompaction(previousModel, currentModel) {
    return hashesDiffer(compactionHash(previousModel), compactionHash(currentModel));
}
function shouldRetryWithCurrentModel(error) {
    if (typeof error === "object" && error !== null && "retryWithCurrentModel" in error) {
        return error.retryWithCurrentModel === true;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (isFailClosedCompactionError(message) || /(?:auth|account|invalid compaction)/i.test(message))
        return false;
    return /(?:\b(?:400|403|408|409|429|5\d\d)\b|invalid request|unexpected status|context window|context_length_exceeded|invalid_prompt|usage limit|server overloaded|internal server|retry limit)/i.test(message);
}
function contextOverflowRecoveryError(model) {
    return markContextOverflowRecovery(new Error(`OpenAI Codex context overflow recovery could not keep a complete history turn within this model's ${model.contextWindow} token context window. Shorten the current request or start a new session.`));
}
function compactionRequestReservedTokens(ctx, basePayload, tools) {
    return approximateCompactionRequestTokens({
        input: [],
        instructions: typeof basePayload?.instructions === "string" ? basePayload.instructions : ctx.getSystemPrompt(),
        tools: Array.isArray(basePayload?.tools) ? basePayload.tools : tools,
    });
}
function fitsContextWindow(ctx, model, input, basePayload, tools) {
    return approximateCompactionRequestTokens({
        input,
        instructions: typeof basePayload?.instructions === "string" ? basePayload.instructions : ctx.getSystemPrompt(),
        tools: Array.isArray(basePayload?.tools) ? basePayload.tools : tools,
    }) <= model.contextWindow;
}
function conversationLeafId(branch) {
    return branch.findLast((entry) => entry.type !== "custom")?.id;
}
function isRealUserEntry(entry) {
    return entry.type === "message" && entry.message.role === "user";
}
function isSuccessfulAssistantEntry(entry) {
    return entry.type === "message"
        && entry.message.role === "assistant"
        && entry.message.stopReason !== "error"
        && entry.message.stopReason !== "aborted";
}
function activeFailedRequests(branch) {
    let lastSuccessfulAssistantIndex = -1;
    for (let index = 0; index < branch.length; index++) {
        if (isSuccessfulAssistantEntry(branch[index]))
            lastSuccessfulAssistantIndex = index;
    }
    const byEntryId = new Map();
    for (let index = lastSuccessfulAssistantIndex + 1; index < branch.length; index++) {
        const entry = branch[index];
        if (entry?.type !== "custom" || entry.customType !== FAILED_REQUEST_KIND || !isJsonObject(entry.data))
            continue;
        const data = entry.data;
        if (data.kind !== FAILED_REQUEST_KIND || typeof data.entryId !== "string")
            continue;
        let referencedUser;
        const referencedIndex = branch.findIndex((candidate) => candidate.id === data.entryId);
        if (referencedIndex >= 0) {
            const referencedEntry = branch[referencedIndex];
            if (!referencedEntry || !isRealUserEntry(referencedEntry) || referencedIndex <= lastSuccessfulAssistantIndex || referencedIndex >= index)
                continue;
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
function branchWithoutFailedRequests(branch, failed) {
    const failedUserIds = new Set(failed.filter((request) => request.hasBranchUser).map((request) => request.entryId));
    return failedUserIds.size === 0 ? branch : branch.filter((entry) => !failedUserIds.has(entry.id));
}
function sameFailedRequestContent(left, right) {
    return isDeepStrictEqual(left, right) || textContent(left) === textContent(right);
}
function requestInputWithoutFailedRequests(requestInput, failed) {
    if (!requestInput || failed.length === 0)
        return requestInput;
    const lastUserIndex = requestInput.findLastIndex((item) => item.role === "user");
    if (lastUserIndex < 0)
        return requestInput;
    const latest = failed.at(-1);
    const latestIsReusedEntry = latest !== undefined
        && !latest.hasNewerUser
        && latest.content !== undefined
        && sameFailedRequestContent(requestInput[lastUserIndex]?.content, latest.content);
    const stale = failed.filter((request) => request !== latest || !latestIsReusedEntry).reverse();
    const matchedIndices = new Set();
    for (const request of stale) {
        if (request.content === undefined)
            continue;
        const failedIndex = requestInput.findLastIndex((item, index) => index < lastUserIndex
            && !matchedIndices.has(index)
            && item.role === "user"
            && sameFailedRequestContent(item.content, request.content));
        if (failedIndex >= 0)
            matchedIndices.add(failedIndex);
    }
    return matchedIndices.size === 0
        ? requestInput
        : requestInput.filter((_item, index) => !matchedIndices.has(index));
}
function hasBranchTailAfterCheckpoint(branch, targetModelKey) {
    const checkpoint = findNativeCheckpoint(branch, targetModelKey);
    return checkpoint.status !== "valid"
        || branch.slice(checkpoint.checkpoint.entryIndex + 1).some(isContextEntry);
}
function textContent(value) {
    if (typeof value === "string")
        return value;
    if (Array.isArray(value))
        return value.map(textContent).join("");
    if (!isJsonObject(value))
        return "";
    if (value.type === "image") {
        return `[image:${typeof value.mimeType === "string" ? value.mimeType : ""}:${typeof value.data === "string" ? value.data : ""}]`;
    }
    if (value.type === "input_image" || value.type === "image_url") {
        const url = typeof value.image_url === "string" ? value.image_url : "";
        const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
        return match ? `[image:${match[1]}:${match[2]}]` : `[image-url:${url}]`;
    }
    if (typeof value.text === "string")
        return value.text;
    return Object.values(value).map(textContent).join("");
}
function messageContent(entry) {
    return entry.message.content;
}
function isContextEntry(entry) {
    return entry.type === "message" || entry.type === "custom_message";
}
function branchBeforeCurrentUser(branch, requestInput) {
    const requestUser = requestInput?.findLast((item) => item.role === "user");
    const branchUserCount = branch.filter((entry) => (entry.type === "message" && entry.message.role === "user") || entry.type === "custom_message").length;
    const requestUserCount = requestInput?.filter((item) => item.role === "user").length ?? 0;
    if (requestUserCount > branchUserCount)
        return branch;
    const currentUserIndex = branch.findLastIndex((entry) => entry.type === "message" && entry.message.role === "user");
    const currentUser = currentUserIndex >= 0 ? branch[currentUserIndex] : undefined;
    if (!requestUser || !currentUser || currentUser.type !== "message")
        return branch;
    if (branch.slice(currentUserIndex + 1).some(isContextEntry))
        return branch;
    return textContent(messageContent(currentUser)) === textContent(requestUser.content)
        ? branch.filter((_entry, index) => index !== currentUserIndex)
        : branch;
}
function checkpointPreservedCurrentUser(branch, requestInput, targetModelKey) {
    const checkpoint = findNativeCheckpoint(branch, targetModelKey);
    if (checkpoint.status !== "valid" || branch.slice(checkpoint.checkpoint.entryIndex + 1).some(isContextEntry))
        return undefined;
    const checkpointUsers = [
        ...checkpoint.checkpoint.details.replacementHistory,
        ...(checkpoint.checkpoint.details.preservedInput ?? []),
    ].filter((item) => item.role === "user");
    const requestUserCount = requestInput?.filter((item) => item.role === "user").length ?? 0;
    if (requestUserCount > checkpointUsers.length)
        return undefined;
    const requestUser = requestInput?.findLast((item) => item.role === "user");
    const checkpointUser = checkpointUsers.findLast((item) => item.role === "user");
    return requestUser && checkpointUser && isDeepStrictEqual(checkpointUser.content, requestUser.content) ? checkpointUser : undefined;
}
function preserveCurrentUser(details, branch, requestInput, alreadyPreserved = false) {
    const requestUser = requestInput?.findLast((item) => item.role === "user");
    const currentUser = branch.findLast((entry) => entry.type === "message" && entry.message.role === "user");
    if (!requestUser || !currentUser || currentUser.type !== "message")
        return details;
    if (alreadyPreserved && details.replacementHistory.some((item) => item.role === "user" && isDeepStrictEqual(item.content, requestUser.content)))
        return details;
    const compactedBranch = branchBeforeCurrentUser(branch, requestInput);
    if (compactedBranch.length < branch.length)
        return appendPreservedInput(details, [requestUser]);
    if (details.replacementHistory.some((item) => item.role === "user" && isDeepStrictEqual(item.content, requestUser.content)))
        return details;
    return textContent(messageContent(currentUser)) === textContent(requestUser.content)
        ? appendPreservedInput(details, [requestUser])
        : details;
}
function rebindCheckpoint(details, modelKeyValue, compHash) {
    const { compHash: _previousHash, ...withoutHash } = details;
    return {
        ...withoutHash,
        modelKey: modelKeyValue,
        ...(compHash ? { compHash } : {}),
    };
}
function withoutLastUser(items) {
    const lastUserIndex = items.findLastIndex((item) => item.role === "user");
    return lastUserIndex < 0 ? items : items.filter((_item, index) => index !== lastUserIndex);
}
function preserveRequestUser(details, requestInput) {
    const requestUser = requestInput.findLast((item) => item.role === "user");
    return requestUser ? appendPreservedInput(details, [requestUser]) : details;
}
function appendPreservedInput(details, input) {
    return {
        ...details,
        preservedInput: [...(details.preservedInput ?? []), ...input.map((item) => structuredClone(item))],
    };
}
function ensureNotAborted(signal) {
    if (!signal?.aborted)
        return;
    throw signal.reason instanceof Error ? signal.reason : new Error("Compaction aborted.");
}
function sameUserOccurrence(left, right) {
    const leftId = typeof left.id === "string" ? left.id : undefined;
    const rightId = typeof right.id === "string" ? right.id : undefined;
    if (leftId !== undefined || rightId !== undefined)
        return leftId !== undefined && leftId === rightId;
    return isDeepStrictEqual(left.content, right.content);
}
function requestTail(requestInput, prefixes, systemPromptInput) {
    if (!requestInput)
        return [];
    const candidates = prefixes.flatMap((value) => systemPromptInput.length > 0 ? [value, [...systemPromptInput, ...value]] : [value]);
    for (const prefix of candidates) {
        if (requestInput.length < prefix.length)
            continue;
        if (prefix.every((item, index) => isDeepStrictEqual(item, requestInput[index]))) {
            return requestInput.slice(prefix.length);
        }
    }
    throw new Error("The Codex request changed before model-transition compaction completed.");
}
function resolveModel(ctx, key) {
    const parts = key.split(":");
    if (parts.length < 3)
        return undefined;
    const model = ctx.modelRegistry.find(parts[0], parts.slice(2).join(":"));
    return model && modelKey(model) === key ? model : undefined;
}
function pendingTransitionFromBranch(branch, currentModel, ctx) {
    const selectedIndex = branch.findLastIndex((entry) => entry.type === "model_change" && entry.provider === currentModel.provider && entry.modelId === currentModel.id);
    const historyEnd = selectedIndex >= 0 ? selectedIndex : branch.length;
    if (selectedIndex >= 0 && branch.slice(selectedIndex + 1).some((entry) => entry.type === "message" && entry.message.role === "assistant"))
        return undefined;
    const previousAssistant = branch.slice(0, historyEnd).findLast((entry) => {
        if (entry.type !== "message")
            return false;
        const message = entry.message;
        return message.role === "assistant"
            && typeof message.provider === "string"
            && typeof message.api === "string"
            && typeof message.model === "string";
    });
    if (!previousAssistant || previousAssistant.type !== "message")
        return undefined;
    const previousMessage = previousAssistant.message;
    const previousModel = resolveModel(ctx, modelKey({
        provider: previousMessage.provider,
        api: previousMessage.api,
        id: previousMessage.model,
    }));
    if (!previousModel || !isOpenAICodexModel(previousModel))
        return undefined;
    const hashTransition = needsTransitionCompaction(previousModel, currentModel);
    if (!hashTransition && !isModelDownshift(previousModel, currentModel))
        return undefined;
    return {
        previousModel,
        targetModelKey: modelKey(currentModel),
        reason: hashTransition ? "hash" : "downshift",
    };
}
export function createSessionCoordinator(deps) {
    const rawGetBranch = deps.getBranch;
    deps = {
        ...deps,
        getBranch: (ctx) => {
            const branch = rawGetBranch(ctx);
            return branchWithoutFailedRequests(branch, activeFailedRequests(branch));
        }
    };
    const runRemoteCompaction = (ctx, reason, operation) => deps.runCompaction?.(ctx, reason, operation) ?? operation();
    const pendingBySession = new Map();
    const transitionBySession = new Map();
    const automaticCompactionBySession = new Map();
    let generation = 0;
    const clear = () => {
        generation++;
        pendingBySession.clear();
        transitionBySession.clear();
        automaticCompactionBySession.clear();
    };
    const recordFailedRequest = (ctx, requestInput, diagnostics) => {
        const requestUser = requestInput?.findLast((item) => item.role === "user");
        if (!requestUser)
            return;
        const latestModelVisible = rawGetBranch(ctx).findLast((entry) => entry.type === "message" || entry.type === "custom_message");
        if (!latestModelVisible || !isRealUserEntry(latestModelVisible))
            return;
        if (!sameFailedRequestContent(messageContent(latestModelVisible), requestUser.content))
            return;
        deps.appendFailedRequest?.({
            kind: FAILED_REQUEST_KIND,
            entryId: latestModelVisible.id,
            ...(diagnostics ? { diagnostics: structuredClone(diagnostics) } : {}),
        });
    };
    const bypassFailedGate = (ctx, model, gateEntryId, startGeneration, leafId) => {
        if (ctx.signal?.aborted || generation !== startGeneration || conversationLeafId(deps.getBranch(ctx)) !== leafId)
            return;
        pendingBySession.delete(ctx.sessionManager.getSessionId());
        if (!gateEntryId)
            return;
        try {
            deps.appendCheckpointBypass({
                kind: NATIVE_COMPACTION_BYPASS_KIND,
                version: NATIVE_COMPACTION_BYPASS_VERSION,
                gateEntryId,
                targetModelKey: modelKey(model),
            });
        }
        catch { }
    };
    const runTransition = async (sessionId, ctx, previousModel, targetModelKey, currentModel, basePayload, startGeneration, requestInput, excludeLastAssistantError = false, signal) => {
        const operationSignal = signal ?? ctx.signal;
        for (let attempt = 0; attempt < 3; attempt++) {
            const branch = deps.getBranch(ctx);
            const leafId = conversationLeafId(branch);
            const compactionBranch = branchBeforeCurrentUser(branch, requestInput);
            const input = effectiveInputForBranch({
                branch: compactionBranch,
                model: previousModel,
                tools: deps.getAllTools(),
                allowCheckpointModelMismatch: true,
                excludeLastAssistantError,
            });
            let native;
            try {
                native = await deps.createCheckpoint({
                    ctx,
                    model: previousModel,
                    input,
                    basePayload,
                    signal: operationSignal,
                });
            }
            catch (firstError) {
                if ((modelKey(currentModel) === modelKey(previousModel) && compactionHash(currentModel) === compactionHash(previousModel))
                    || !shouldRetryWithCurrentModel(firstError))
                    throw firstError;
                try {
                    native = await deps.createCheckpoint({
                        ctx,
                        model: currentModel,
                        input: effectiveInputForBranch({
                            branch: compactionBranch,
                            model: currentModel,
                            tools: deps.getAllTools(),
                            allowCheckpointModelMismatch: true,
                            excludeLastAssistantError,
                        }),
                        basePayload,
                        signal: operationSignal,
                    });
                }
                catch (fallbackError) {
                    throw fallbackError;
                }
            }
            ensureNotAborted(operationSignal);
            if (generation !== startGeneration || conversationLeafId(deps.getBranch(ctx)) !== leafId)
                continue;
            deps.appendCheckpoint(rebindCheckpoint(preserveCurrentUser(native.details, branch, requestInput), targetModelKey, compactionHash(currentModel)));
            pendingBySession.delete(sessionId);
            return;
        }
        throw new Error("The session changed while Codex model-transition compaction was running.");
    };
    const recoverRequestAfterContextOverflow = async (model, ctx, requestInput, basePayload, signal) => {
        if (!requestInput)
            throw contextOverflowRecoveryError(model);
        return runRemoteCompaction(ctx, "context-overflow-recovery", async () => {
            const sessionId = ctx.sessionManager.getSessionId();
            const branch = deps.getBranch(ctx);
            const checkpoint = findNativeCheckpoint(branch, modelKey(model));
            const pending = pendingBySession.get(sessionId);
            const checkpointModel = checkpoint.status === "valid"
                ? resolveModel(ctx, checkpoint.checkpoint.details.modelKey)
                : undefined;
            const compactionModel = pending?.previousModel
                ?? (checkpointModel && isOpenAICodexModel(checkpointModel) ? checkpointModel : model);
            const lastUserIndex = requestInput.findLastIndex((item) => item.role === "user");
            const historyInput = lastUserIndex >= 0 ? requestInput.slice(0, lastUserIndex) : requestInput;
            const reservedTokens = compactionRequestReservedTokens(ctx, basePayload, deps.getAllTools());
            const input = latestRemoteCompactionSuffix(historyInput, compactionModel.contextWindow, reservedTokens);
            if (input.length === 0)
                throw contextOverflowRecoveryError(compactionModel);
            const leafId = conversationLeafId(branch);
            const startGeneration = generation;
            const native = await deps.createCheckpoint({ ctx, model: compactionModel, input, basePayload, signal: signal ?? ctx.signal });
            ensureNotAborted(signal ?? ctx.signal);
            if (generation !== startGeneration || conversationLeafId(deps.getBranch(ctx)) !== leafId) {
                throw new Error("The session changed while Codex context overflow recovery was running.");
            }
            const preservedInput = lastUserIndex >= 0 ? requestInput.slice(lastUserIndex) : [];
            const details = rebindCheckpoint(appendPreservedInput(native.details, preservedInput), modelKey(model), compactionHash(model));
            deps.appendCheckpoint(details);
            pendingBySession.delete(ctx.sessionManager.getSessionId());
            return [
                ...details.replacementHistory,
                ...(details.preservedInput ?? []),
            ];
        });
    };
    const recoverCurrentModel = async (model, ctx, basePayload, requestInput, excludeLastAssistantError = false, signal) => {
        if (!isOpenAICodexModel(model))
            return;
        const operationSignal = signal ?? ctx.signal;
        const sessionId = ctx.sessionManager.getSessionId();
        const checkpoint = findNativeCheckpoint(deps.getBranch(ctx), modelKey(model));
        if (checkpoint.status !== "valid")
            return;
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
        if (!hashTransition && !downshift)
            return;
        if (!hashTransition) {
            const input = effectiveInputForBranch({
                branch: branchBeforeCurrentUser(deps.getBranch(ctx), requestInput),
                model,
                tools: deps.getAllTools(),
                allowCheckpointModelMismatch: true,
                excludeLastAssistantError,
            });
            if (deps.shouldAutoCompact?.({ ctx, model, input, reason: "downshift" }) !== true)
                return;
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
            const native = await deps.createCheckpoint({
                ctx,
                model,
                input: effectiveInputForBranch({
                    branch: branchBeforeCurrentUser(branch, requestInput),
                    model,
                    tools: deps.getAllTools(),
                    allowCheckpointModelMismatch: true,
                    excludeLastAssistantError,
                }),
                basePayload,
                signal: operationSignal,
            });
            ensureNotAborted(operationSignal);
            if (generation !== startGeneration || conversationLeafId(deps.getBranch(ctx)) !== leafId) {
                throw new Error("The session changed while Codex model-transition compaction was running.");
            }
            deps.appendCheckpoint(rebindCheckpoint(preserveCurrentUser(native.details, branch, requestInput), modelKey(model), currentHash));
        });
        transitionBySession.set(sessionId, transition);
        try {
            await transition;
        }
        catch (transitionError) {
            if (!isContextWindowCompactionError(transitionError)) {
                bypassFailedGate(ctx, model, checkpoint.checkpoint.entryId, startGeneration, gateLeafId);
            }
            throw transitionError;
        }
        finally {
            if (transitionBySession.get(sessionId) === transition)
                transitionBySession.delete(sessionId);
        }
    };
    const selectModel = async (event, ctx) => {
        const sessionId = ctx.sessionManager.getSessionId();
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
        if (pending
            && modelKey(event.model) === modelKey(pending.previousModel)
            && compactionHash(event.model) === compactionHash(pending.previousModel)) {
            pendingBySession.delete(sessionId);
            return;
        }
        pendingBySession.set(sessionId, {
            previousModel: pending?.previousModel ?? previousModel,
            targetModelKey: modelKey(event.model),
            reason: hashTransition ? "hash" : "downshift",
        });
    };
    const prepareRequest = async (model, ctx, requestInput, basePayload, skipAutomaticCompaction = false, recovery) => {
        const sessionId = ctx.sessionManager.getSessionId();
        const originalRequestInput = requestInput;
        requestInput = requestInputWithoutFailedRequests(requestInput, activeFailedRequests(rawGetBranch(ctx)));
        const requestInputWasSanitized = requestInput !== originalRequestInput;
        if (recovery === "context-overflow") {
            return recoverRequestAfterContextOverflow(model, ctx, requestInput, basePayload, ctx.signal);
        }
        let transitionCompactionCompleted = false;
        const activeTransition = transitionBySession.get(sessionId);
        if (activeTransition) {
            await activeTransition;
            return prepareRequest(model, ctx, requestInput, basePayload, false);
        }
        const branchBefore = deps.getBranch(ctx);
        let pending = pendingBySession.get(sessionId);
        const checkpoint = findNativeCheckpoint(branchBefore, modelKey(model));
        if (!pending && checkpoint.status === "none") {
            const recoveredTransition = pendingTransitionFromBranch(branchBefore, model, ctx);
            pending = recoveredTransition;
            if (pending)
                pendingBySession.set(sessionId, pending);
        }
        if (pending
            && checkpoint.status === "valid"
            && checkpoint.checkpoint.details.modelKey === modelKey(model)) {
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
        const tools = deps.getAllTools();
        const historyBranch = branchBeforeCurrentUser(branchBefore, requestInput);
        const historyInput = effectiveInputForBranch({
            branch: historyBranch,
            model: historyModel,
            tools,
            allowCheckpointModelMismatch: true,
        });
        const rawHistoryInput = fullInputForBranch({ branch: historyBranch, model: historyModel, tools });
        const piContextInput = piContextInputForBranch({ branch: historyBranch, model: historyModel, tools });
        const currentHistoryInput = effectiveInputForBranch({
            branch: historyBranch,
            model,
            tools,
            allowCheckpointModelMismatch: true,
        });
        const currentRawHistoryInput = fullInputForBranch({ branch: historyBranch, model, tools });
        const currentPiContextInput = piContextInputForBranch({ branch: historyBranch, model, tools });
        const systemPrompt = ctx.getSystemPrompt();
        const supportsDeveloperRole = model.compat?.supportsDeveloperRole;
        const systemPromptInput = systemPrompt
            ? [{
                    role: model.reasoning && supportsDeveloperRole !== false ? "developer" : "system",
                    content: systemPrompt,
                }]
            : [];
        let tail;
        try {
            tail = requestTail(requestInput, [historyInput, piContextInput, rawHistoryInput, currentHistoryInput, currentPiContextInput, currentRawHistoryInput], systemPromptInput);
        }
        catch (error) {
            if (checkpoint.status === "bypassed") {
                if (!requestInput
                    || requestInput.some((item) => item.type === "compaction" || item.type === "context_compaction")
                    || !fitsContextWindow(ctx, model, requestInput, basePayload, tools)) {
                    throw new Error("The raw request cannot be replayed within this model's context window after the Codex checkpoint was bypassed.");
                }
                return requestInput;
            }
            if (!pending && checkpoint.status !== "valid")
                return requestInputWasSanitized ? requestInput : undefined;
            const gateEntryId = checkpoint.status === "valid" ? checkpoint.checkpoint.entryId : conversationLeafId(branchBefore);
            const gateGeneration = generation;
            const gateLeafId = conversationLeafId(branchBefore);
            try {
                return await runRemoteCompaction(ctx, "context-recovery", async () => {
                    const compactionInput = withoutLastUser(requestInput);
                    const createCheckpointFor = (selectedModel) => deps.createCheckpoint({
                        ctx,
                        model: selectedModel,
                        input: compactionInput,
                        basePayload,
                        signal: ctx.signal,
                    });
                    let native;
                    try {
                        native = await createCheckpointFor(historyModel);
                    }
                    catch (firstError) {
                        if ((modelKey(model) === modelKey(historyModel) && compactionHash(model) === compactionHash(historyModel))
                            || !shouldRetryWithCurrentModel(firstError))
                            throw firstError;
                        try {
                            native = await createCheckpointFor(model);
                        }
                        catch (fallbackError) {
                            throw fallbackError;
                        }
                    }
                    ensureNotAborted(ctx.signal);
                    const details = rebindCheckpoint(preserveRequestUser(native.details, requestInput), modelKey(model), compactionHash(model));
                    deps.appendCheckpoint(details);
                    pendingBySession.delete(sessionId);
                    return [...details.replacementHistory, ...(details.preservedInput ?? [])];
                });
            }
            catch (recoveryError) {
                if (!isContextWindowCompactionError(recoveryError)) {
                    bypassFailedGate(ctx, model, gateEntryId, gateGeneration, gateLeafId);
                }
                throw recoveryError;
            }
        }
        const activeAutomaticCompaction = automaticCompactionBySession.get(sessionId);
        if (activeAutomaticCompaction) {
            await activeAutomaticCompaction;
            return prepareRequest(model, ctx, requestInput, basePayload, true);
        }
        if (pending && pending.targetModelKey === modelKey(model)) {
            const shouldRun = pending.reason === "hash"
                || deps.shouldAutoCompact?.({ ctx, model, input: currentHistoryInput, reason: pending.reason }) === true;
            if (!shouldRun) {
                pendingBySession.delete(sessionId);
            }
            else {
                const startGeneration = generation;
                const gateEntryId = checkpoint.status === "valid" ? checkpoint.checkpoint.entryId : conversationLeafId(branchBefore);
                const gateLeafId = conversationLeafId(branchBefore);
                const transition = runRemoteCompaction(ctx, "model-transition", () => runTransition(sessionId, ctx, pending.previousModel, pending.targetModelKey, model, basePayload, startGeneration, requestInput));
                transitionBySession.set(sessionId, transition);
                try {
                    await transition;
                    transitionCompactionCompleted = true;
                }
                catch (transitionError) {
                    if (!isContextWindowCompactionError(transitionError)) {
                        bypassFailedGate(ctx, model, gateEntryId, startGeneration, gateLeafId);
                    }
                    throw transitionError;
                }
                finally {
                    if (transitionBySession.get(sessionId) === transition)
                        transitionBySession.delete(sessionId);
                }
                skipAutomaticCompaction = false;
            }
        }
        await recoverCurrentModel(model, ctx, basePayload, requestInput);
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
                return prepareRequest(model, ctx, requestInput, basePayload, false);
            }
            const activeAutomaticCompaction = automaticCompactionBySession.get(sessionId);
            if (activeAutomaticCompaction) {
                await activeAutomaticCompaction;
            }
            else if (!skipAutomaticCompaction) {
                const compactionBranch = branchBeforeCurrentUser(branch, requestInput);
                const currentHistory = effectiveInputForBranch({
                    branch: compactionBranch,
                    model,
                    tools: deps.getAllTools(),
                    allowCheckpointModelMismatch: true,
                });
                if ((transitionCompactionCompleted || hasBranchTailAfterCheckpoint(compactionBranch, modelKey(model)))
                    && deps.shouldAutoCompact?.({ ctx, model, input: currentHistory })) {
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
                        ensureNotAborted(ctx.signal);
                        if (generation !== startGeneration || conversationLeafId(deps.getBranch(ctx)) !== leafId) {
                            throw new Error("The session changed while Codex automatic compaction was running.");
                        }
                        deps.appendCheckpoint(preserveCurrentUser(native.details, branch, requestInput, checkpointPreservedCurrentUser(branch, requestInput, modelKey(model)) !== undefined));
                    });
                    automaticCompactionBySession.set(sessionId, automaticCompaction);
                    try {
                        await automaticCompaction;
                    }
                    catch (automaticError) {
                        const unchangedInput = [...currentHistory, ...tail];
                        if (ctx.signal?.aborted
                            || isContextWindowCompactionError(automaticError)
                            || !fitsContextWindow(ctx, model, unchangedInput, basePayload, tools))
                            throw automaticError;
                        try {
                            deps.onAutomaticCompactionFailure?.(ctx, automaticError);
                        }
                        catch { }
                    }
                    finally {
                        if (automaticCompactionBySession.get(sessionId) === automaticCompaction)
                            automaticCompactionBySession.delete(sessionId);
                    }
                }
            }
            branch = deps.getBranch(ctx);
        }
        const currentCheckpoint = findNativeCheckpoint(branch, modelKey(model));
        if (currentCheckpoint.status === "bypassed") {
            const rawReplay = [
                ...effectiveInputForBranch({
                    branch: branchBeforeCurrentUser(branch, requestInput),
                    model,
                    tools,
                    allowCheckpointModelMismatch: true,
                }),
                ...tail,
            ];
            if (!fitsContextWindow(ctx, model, rawReplay, basePayload, tools)) {
                throw new Error("The complete branch cannot be replayed within this model's context window after the Codex checkpoint was bypassed.");
            }
            return rawReplay;
        }
        if (currentCheckpoint.status !== "valid")
            return requestInputWasSanitized ? requestInput : undefined;
        const preservedUser = checkpointPreservedCurrentUser(branch, requestInput, modelKey(model));
        if (preservedUser) {
            const preservedUserIndex = tail.findLastIndex((item) => item.role === "user" && sameUserOccurrence(item, preservedUser));
            if (preservedUserIndex >= 0)
                tail = tail.filter((_item, index) => index !== preservedUserIndex);
        }
        return [
            ...effectiveInputForBranch({
                branch: branchBeforeCurrentUser(branch, requestInput),
                model,
                tools: deps.getAllTools(),
                allowCheckpointModelMismatch: true,
            }),
            ...tail,
        ];
    };
    const prepareCompaction = async (model, ctx, requestInput, excludeLastAssistantError = false, signal, recovery, basePayload) => {
        if (!isOpenAICodexModel(model))
            return [];
        requestInput = requestInputWithoutFailedRequests(requestInput, activeFailedRequests(rawGetBranch(ctx)));
        const operationSignal = signal ?? ctx.signal;
        const sessionId = ctx.sessionManager.getSessionId();
        const activeTransition = transitionBySession.get(sessionId);
        if (activeTransition)
            await activeTransition;
        ensureNotAborted(operationSignal);
        if (recovery === "context-overflow") {
            if (!requestInput)
                throw contextOverflowRecoveryError(model);
            let recoveryInput = requestInput;
            if (excludeLastAssistantError) {
                const lastAssistantIndex = recoveryInput.findLastIndex((item) => item.role === "assistant");
                if (lastAssistantIndex >= 0)
                    recoveryInput = recoveryInput.filter((_item, index) => index !== lastAssistantIndex);
            }
            const reservedTokens = compactionRequestReservedTokens(ctx, basePayload, deps.getAllTools());
            const input = latestRemoteCompactionSuffix(recoveryInput, model.contextWindow, reservedTokens);
            if (input.length === 0)
                throw contextOverflowRecoveryError(model);
            return input;
        }
        const currentBranch = deps.getBranch(ctx);
        return effectiveInputForBranch({
            branch: currentBranch,
            model,
            tools: deps.getAllTools(),
            allowCheckpointModelMismatch: true,
            excludeLastAssistantError,
        });
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
//# sourceMappingURL=session-coordinator.js.map