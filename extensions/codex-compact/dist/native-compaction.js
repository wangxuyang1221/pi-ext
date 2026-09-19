import { createHash } from "node:crypto";
import { responseItemEstimationView } from "./response-item-estimation.js";
import { setTimeout as sleep } from "node:timers/promises";
import { audioTokenCount, contentTokens, imageBytes, inlineAudioPayload, inlineImagePayload, textTokens, truncateImageMessage, truncateText } from "./token-estimation.js";
import { convertToLlm, sessionEntryToContextMessages, } from "@earendil-works/pi-coding-agent";
import { calculateCost } from "@earendil-works/pi-ai";
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
export function isFailClosedCompactionError(message) {
    return FAIL_CLOSED_ERROR_PATTERN.test(message);
}
export function isContextWindowCompactionError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isFailClosedCompactionError(message) || USAGE_LIMIT_MESSAGE_PATTERN.test(message) || /invalid_prompt/i.test(message))
        return false;
    const code = compactionErrorCode(error);
    if (code !== undefined)
        return code === "context_length_exceeded" || code === "context_window_exceeded";
    if (compactionRetry(error) !== undefined)
        return false;
    return /(?:context_length_exceeded|context_window_exceeded)/i.test(message);
}
export function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isOpenAICodexModel(model) {
    if (!isJsonObject(model))
        return false;
    return model.provider === "openai-codex" && model.api === "openai-codex-responses";
}
export function modelKey(model) {
    return `${model.provider}:${model.api}:${model.id}`;
}
function isContentItem(value) {
    if (!isJsonObject(value) || typeof value.type !== "string")
        return false;
    switch (value.type) {
        case "input_text":
        case "output_text":
            return typeof value.text === "string";
        case "input_image":
            return typeof value.image_url === "string"
                && (value.detail === undefined || ["auto", "low", "high", "original"].includes(value.detail));
        case "input_audio":
            return typeof value.audio_url === "string";
        default:
            return false;
    }
}
function isAgentMessageContent(value) {
    if (!isJsonObject(value) || typeof value.type !== "string")
        return false;
    return value.type === "input_text"
        ? typeof value.text === "string"
        : value.type === "encrypted_content" && typeof value.encrypted_content === "string";
}
function isReasoningSummary(value) {
    return isJsonObject(value) && value.type === "summary_text" && typeof value.text === "string";
}
function isReasoningContent(value) {
    return isJsonObject(value)
        && (value.type === "reasoning_text" || value.type === "text")
        && typeof value.text === "string";
}
function isToolOutputContent(value) {
    if (!isJsonObject(value) || typeof value.type !== "string")
        return false;
    return value.type === "input_text"
        ? typeof value.text === "string"
        : value.type === "input_image"
            ? typeof value.image_url === "string"
                && (value.detail === undefined || ["auto", "low", "high", "original"].includes(value.detail))
            : value.type === "input_audio"
                ? typeof value.audio_url === "string"
                : value.type === "encrypted_content" && typeof value.encrypted_content === "string";
}
function isToolOutput(value) {
    return typeof value === "string" || (Array.isArray(value) && value.every(isToolOutputContent));
}
function isResponseItem(value) {
    if (!isJsonObject(value))
        return false;
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
export function parseNativeCompactionDetails(value) {
    if (!isJsonObject(value))
        return undefined;
    if (value.kind !== NATIVE_COMPACTION_KIND || value.version !== NATIVE_COMPACTION_VERSION)
        return undefined;
    if (typeof value.modelKey !== "string" || !Array.isArray(value.replacementHistory))
        return undefined;
    if (value.compHash !== undefined && typeof value.compHash !== "string")
        return undefined;
    const replacementHistory = value.replacementHistory.filter(isResponseItem);
    if (replacementHistory.length !== value.replacementHistory.length)
        return undefined;
    const preservedInput = Array.isArray(value.preservedInput) ? value.preservedInput.filter(isResponseItem) : undefined;
    if (value.preservedInput !== undefined) {
        if (!Array.isArray(value.preservedInput) || preservedInput === undefined || preservedInput.length !== value.preservedInput.length)
            return undefined;
    }
    if (value.strategy !== undefined && value.strategy !== "v2")
        return undefined;
    const compactionItems = replacementHistory.filter((item) => item.type === "compaction");
    if (compactionItems.length !== 1 ||
        typeof compactionItems[0]?.encrypted_content !== "string" ||
        replacementHistory.at(-1)?.type !== "compaction") {
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
export function parseNativeCompactionBypass(value) {
    if (!isJsonObject(value))
        return undefined;
    if (value.kind !== NATIVE_COMPACTION_BYPASS_KIND || value.version !== NATIVE_COMPACTION_BYPASS_VERSION)
        return undefined;
    if (typeof value.gateEntryId !== "string" || !value.gateEntryId || typeof value.targetModelKey !== "string" || !value.targetModelKey)
        return undefined;
    return {
        kind: NATIVE_COMPACTION_BYPASS_KIND,
        version: NATIVE_COMPACTION_BYPASS_VERSION,
        gateEntryId: value.gateEntryId,
        targetModelKey: value.targetModelKey,
    };
}
export function findNativeCheckpoint(branch, targetModelKey) {
    for (let index = branch.length - 1; index >= 0; index--) {
        const entry = branch[index];
        if (!entry)
            continue;
        if (entry.type === "custom" && entry.customType === NATIVE_COMPACTION_BYPASS_KIND) {
            const bypass = parseNativeCompactionBypass(entry.data);
            if (bypass && (targetModelKey === undefined || bypass.targetModelKey === targetModelKey)) {
                return { status: "bypassed", entryIndex: index, entryId: entry.id, bypass };
            }
            continue;
        }
        let rawDetails;
        if (entry.type === "compaction") {
            if (!isJsonObject(entry.details) || entry.details.kind !== NATIVE_COMPACTION_KIND) {
                return { status: "none" };
            }
            rawDetails = entry.details;
        }
        else if (entry.type === "custom" && entry.customType === NATIVE_COMPACTION_KIND) {
            rawDetails = entry.data;
        }
        else {
            continue;
        }
        if (isJsonObject(rawDetails) && rawDetails.strategy === "token-budget")
            return { status: "none" };
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
function assistantInputTokens(entry) {
    if (entry.type !== "message")
        return undefined;
    const message = entry.message;
    if (message.role !== "assistant"
        || message.provider !== "openai-codex"
        || message.api !== "openai-codex-responses"
        || message.stopReason === "error"
        || message.stopReason === "aborted")
        return undefined;
    const usage = isJsonObject(message.usage) ? message.usage : undefined;
    if (!usage || typeof usage.input !== "number" || !Number.isFinite(usage.input))
        return undefined;
    const cacheRead = typeof usage.cacheRead === "number" && Number.isFinite(usage.cacheRead) ? usage.cacheRead : 0;
    const cacheWrite = typeof usage.cacheWrite === "number" && Number.isFinite(usage.cacheWrite) ? usage.cacheWrite : 0;
    return Math.max(0, usage.input + cacheRead + cacheWrite);
}
/**
 * Finds the Codex body-after-prefix baseline for the active compaction window.
 * Server-observed assistant usage wins; a current native checkpoint provides the
 * estimate used before the first response in a new window.
 */
export function estimateCompactionWindowPrefillTokens(params) {
    const checkpoint = findNativeCheckpoint(params.branch, params.targetModelKey);
    const checkpointIndex = checkpoint.status === "valid" ? checkpoint.checkpoint.entryIndex : -1;
    const observed = params.branch.slice(checkpointIndex + 1).map(assistantInputTokens).find((value) => value !== undefined);
    if (observed !== undefined)
        return observed;
    if (checkpoint.status !== "valid")
        return undefined;
    return approximateResponseItemTokens(checkpoint.checkpoint.details.replacementHistory)
        + Math.max(0, Math.floor(params.stablePrefixTokens));
}
// Pi's extension loader does not expose Pi AI's internal Responses converter.
function shortHash(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
/** Matches Pi AI's deterministic shortHash for cross-provider Responses item IDs. */
function piShortHash(value) {
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
function normalizedItemId(value) {
    if (!value)
        return undefined;
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64).replace(/_+$/, "");
    return sanitized.startsWith("fc_") ? sanitized : `fc_${sanitized}`.slice(0, 64);
}
function textSignature(value) {
    if (typeof value !== "string" || !value)
        return {};
    try {
        const parsed = JSON.parse(value);
        return {
            id: typeof parsed.id === "string" ? parsed.id : undefined,
            phase: parsed.phase === "commentary" || parsed.phase === "final_answer" ? parsed.phase : undefined,
        };
    }
    catch {
        return { id: value };
    }
}
function contentToUserParts(content) {
    if (typeof content === "string")
        return content ? [{ type: "input_text", text: content }] : [];
    if (!Array.isArray(content))
        return [];
    const parts = [];
    for (const part of content) {
        if (!isJsonObject(part))
            continue;
        if (part.type === "text" && typeof part.text === "string") {
            parts.push({ type: "input_text", text: part.text });
        }
        else if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
            parts.push({ type: "input_image", detail: "auto", image_url: `data:${part.mimeType};base64,${part.data}` });
        }
    }
    return parts;
}
function toolResultOutput(message, model) {
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
        ...images.flatMap((part) => typeof part.data === "string" && typeof part.mimeType === "string"
            ? [{ type: "input_image", detail: "auto", image_url: `data:${part.mimeType};base64,${part.data}` }]
            : []),
    ];
}
function responseTool(tool, deferLoading, supportsStrictMode) {
    return {
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(supportsStrictMode ? { strict: null } : {}),
        ...(deferLoading ? { defer_loading: true } : {}),
    };
}
function messagesToResponseItems(model, messages, tools, loadedToolNames = new Set()) {
    const items = [];
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const compat = model.compat;
    const supportsAdditionalTools = compat?.supportsAdditionalTools === true;
    const supportsToolSearch = compat?.supportsToolSearch === true;
    const supportsStrictMode = compat?.supportsStrictMode !== false;
    const pendingToolCalls = new Map();
    const usedToolNames = new Set();
    for (const message of messages) {
        if (message.role !== "assistant" || !Array.isArray(message.content))
            continue;
        for (const block of message.content) {
            if (isJsonObject(block) && block.type === "toolCall" && typeof block.name === "string")
                usedToolNames.add(block.name);
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
    for (const message of messages) {
        const itemCountBefore = items.length;
        if (message.role === "user") {
            flushOrphanedToolCalls();
            const content = contentToUserParts(message.content);
            if (content.length === 0)
                continue;
            items.push({ role: "user", content });
        }
        else if (message.role === "assistant" && Array.isArray(message.content)) {
            flushOrphanedToolCalls();
            if (message.stopReason === "error" || message.stopReason === "aborted")
                continue;
            const sameModel = message.provider === model.provider
                && message.api === model.api
                && message.model === model.id;
            const sameProviderApi = message.provider === model.provider && message.api === model.api;
            let textIndex = 0;
            for (const block of message.content) {
                if (!isJsonObject(block))
                    continue;
                if (block.type === "thinking") {
                    if (!sameModel && block.redacted === true)
                        continue;
                    if (sameModel && typeof block.thinkingSignature === "string") {
                        try {
                            const reasoning = JSON.parse(block.thinkingSignature);
                            if (isJsonObject(reasoning) && reasoning.type === "reasoning")
                                items.push(structuredClone(reasoning));
                        }
                        catch { }
                    }
                    else if (!sameModel && typeof block.thinking === "string" && block.thinking.trim()) {
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
        }
        else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
            const [callId] = message.toolCallId.split("|");
            pendingToolCalls.delete(message.toolCallId);
            items.push({ type: "function_call_output", call_id: callId, output: toolResultOutput(message, model) });
            const addedTools = (supportsAdditionalTools || supportsToolSearch) && Array.isArray(message.addedToolNames)
                ? message.addedToolNames.flatMap((name) => {
                    if (typeof name !== "string" || usedToolNames.has(name) || loadedToolNames.has(name))
                        return [];
                    const tool = toolsByName.get(name);
                    if (!tool)
                        return [];
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
            }
            else if (addedTools.length > 0 && supportsToolSearch) {
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
        if (message.role === "assistant" && items.length === itemCountBefore)
            continue;
        messageIndex++;
    }
    flushOrphanedToolCalls();
    return items;
}
export function loadedToolNamesFromItems(items) {
    const loadedToolNames = new Set();
    for (const item of items) {
        if ((item.type !== "additional_tools" && item.type !== "tool_search_output") || !Array.isArray(item.tools))
            continue;
        for (const tool of item.tools) {
            if (isJsonObject(tool) && typeof tool.name === "string")
                loadedToolNames.add(tool.name);
        }
    }
    return loadedToolNames;
}
function entriesToResponseItems(model, entries, tools, includeCompactionSummary = false, loadedToolNames = new Set()) {
    const messages = entries
        .filter((entry) => includeCompactionSummary || entry.type !== "compaction")
        .flatMap((entry) => sessionEntryToContextMessages(entry));
    return messagesToResponseItems(model, convertToLlm(messages), tools, loadedToolNames);
}
export function fullInputForBranch(params) {
    return entriesToResponseItems(params.model, params.branch, params.tools);
}
export function piContextInputForBranch(params) {
    const checkpoint = findNativeCheckpoint(params.branch, modelKey(params.model));
    if (checkpoint.status === "invalid" || checkpoint.status === "bypassed")
        return fullInputForBranch(params);
    const remoteCheckpoint = checkpoint.status === "valid";
    const boundaryEnd = checkpoint.status === "valid" ? checkpoint.checkpoint.entryIndex : params.branch.length;
    let firstKeptEntryId;
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
    if (!firstKeptEntryId)
        return fullInputForBranch(params);
    const firstKeptIndex = params.branch.findIndex((candidate) => candidate.id === firstKeptEntryId);
    if (firstKeptIndex < 0)
        return fullInputForBranch(params);
    const contextEntries = remoteCheckpoint || compactionIndex < 0
        ? params.branch.slice(firstKeptIndex)
        : [
            params.branch[compactionIndex],
            ...params.branch.slice(firstKeptIndex, compactionIndex),
            ...params.branch.slice(compactionIndex + 1),
        ];
    return entriesToResponseItems(params.model, contextEntries, params.tools, !remoteCheckpoint);
}
export function effectiveInputForBranch(params) {
    let branch = params.branch;
    if (params.excludeLastAssistantError) {
        const lastAssistantIndex = branch.findLastIndex((entry) => entry.type === "message" && entry.message.role === "assistant");
        if (lastAssistantIndex >= 0) {
            branch = branch.filter((_entry, index) => index !== lastAssistantIndex);
        }
    }
    const checkpoint = findNativeCheckpoint(branch, modelKey(params.model));
    if (checkpoint.status === "valid") {
        if (!params.allowCheckpointModelMismatch
            && checkpoint.checkpoint.details.modelKey !== modelKey(params.model)) {
            throw new Error("The latest Codex compaction checkpoint requires model-transition compaction first.");
        }
        const prefix = [
            ...checkpoint.checkpoint.details.replacementHistory.map((item) => structuredClone(item)),
            ...(checkpoint.checkpoint.details.preservedInput ?? []).map((item) => structuredClone(item)),
        ];
        return [
            ...prefix,
            ...entriesToResponseItems(params.model, branch.slice(checkpoint.checkpoint.entryIndex + 1), params.tools, false, loadedToolNamesFromItems(prefix)),
        ];
    }
    return piContextInputForBranch({ branch, model: params.model, tools: params.tools });
}
export function approximateTokenCount(value) {
    const encoded = JSON.stringify(value);
    return Math.ceil(Buffer.byteLength(encoded ?? "", "utf8") / 4);
}
function imagePartCount(value) {
    if (Array.isArray(value))
        return value.reduce((total, part) => total + imagePartCount(part), 0);
    if (!isJsonObject(value))
        return 0;
    if (value.type === "input_image" || value.type === "image_url")
        return 1;
    return Object.values(value).reduce((total, part) => total + imagePartCount(part), 0);
}
const I64_MAX = (1n << 63n) - 1n;
const I64_MIN = -(1n << 63n);
const saturatingI64 = (value) => value > I64_MAX ? I64_MAX : value < I64_MIN ? I64_MIN : value;
const tokensFromBytes = (bytes) => bytes <= 0n ? 0n : (bytes + 3n) / 4n;
function approximateTokensInteger(input) {
    const item = responseItemEstimationView(input);
    if ((item.type === "reasoning" || item.type === "compaction" || item.type === "context_compaction")
        && typeof item.encrypted_content === "string") {
        return tokensFromBytes(BigInt(Buffer.byteLength(item.encrypted_content)) * 3n / 4n - 650n);
    }
    let bytes = BigInt(Buffer.byteLength(JSON.stringify(item), "utf8"));
    let imagePayload = 0n, imageReplacement = 0n;
    let audioPayload = 0n, audioReplacement = 0n;
    let encryptedPayload = 0n, encryptedReplacement = 0n;
    const content = Array.isArray(item.content) ? item.content : Array.isArray(item.output) ? item.output : [];
    const hasMedia = item.type === "message" || item.type === undefined || item.type === "function_call_output" || item.type === "custom_tool_call_output";
    for (const part of content) {
        if (!isJsonObject(part))
            continue;
        if (hasMedia && (part.type === "input_image" || part.type === "image_url") && typeof part.image_url === "string") {
            const inline = inlineImagePayload(part.image_url);
            if (inline) {
                imagePayload = saturatingI64(imagePayload + BigInt(Buffer.byteLength(inline.payload)));
                imageReplacement = saturatingI64(imageReplacement + BigInt(imageBytes(part)));
            }
        }
        if (hasMedia && part.type === "input_audio" && typeof part.audio_url === "string") {
            const inline = inlineAudioPayload(part.audio_url);
            if (inline) {
                audioPayload = saturatingI64(audioPayload + BigInt(Buffer.byteLength(inline.payload)));
                audioReplacement = saturatingI64(audioReplacement + saturatingI64(audioTokenCount(part.audio_url) * 4n));
            }
        }
        if ((item.type === "function_call_output" || item.type === "agent_message") && typeof part.encrypted_content === "string") {
            const length = BigInt(Buffer.byteLength(part.encrypted_content));
            encryptedPayload = saturatingI64(encryptedPayload + length);
            encryptedReplacement = saturatingI64(encryptedReplacement + (length * 9n + 15n) / 16n);
        }
    }
    // Preserve upstream's grouped adjustment order: saturation is not associative.
    bytes = saturatingI64(saturatingI64(bytes - imagePayload) + imageReplacement);
    bytes = saturatingI64(saturatingI64(bytes - audioPayload) + audioReplacement);
    bytes = saturatingI64(saturatingI64(bytes - encryptedPayload) + encryptedReplacement);
    return tokensFromBytes(bytes);
}
function approximateTokens(input) {
    return Number(approximateTokensInteger(input));
}
export function approximateResponseItemTokens(items) {
    return Number(items.reduce((total, item) => saturatingI64(total + approximateTokensInteger(item)), 0n));
}
export function approximateCompactionRequestTokens(params) {
    return approximateResponseItemTokens(params.input) + approximateTokenCount({
        instructions: params.instructions,
        tools: params.tools,
        input: [{ type: "compaction_trigger" }],
    });
}
const CONTEXT_WINDOW_TRUNCATED_OUTPUT = "Output exceeded the available model context and was truncated";
function truncateFunctionOutput(item) {
    if (item.type !== "function_call_output"
        && item.type !== "custom_tool_call_output"
        && item.type !== "tool_search_output")
        return undefined;
    const copy = structuredClone(item);
    if (item.type === "tool_search_output")
        copy.tools = [];
    else
        copy.output = CONTEXT_WINDOW_TRUNCATED_OUTPUT;
    return copy;
}
/** Codex rewrites the newest truncatable tool output before an oversized request. */
export function trimFunctionCallHistoryToFitContextWindow(items, maxTokens, reservedTokens = 0) {
    const result = items.map((item) => structuredClone(item));
    const inputBudget = Math.max(0, maxTokens - reservedTokens);
    let excess = approximateResponseItemTokens(result) - inputBudget;
    if (excess <= 0)
        return result;
    for (const group of retainedMessageGroups(result).reverse()) {
        if (excess <= 0)
            break;
        const rewritten = truncateFunctionOutput(group.source);
        if (!rewritten)
            break;
        const current = approximateTokens(group.source);
        result[group.sourceIndex] = rewritten;
        excess -= current - approximateTokens(rewritten);
    }
    return result;
}
function truncateMessage(item, maxTokens) {
    if ((item.type !== "message" && item.type !== undefined) || maxTokens <= 0)
        return undefined;
    const copy = structuredClone(item);
    let remaining = maxTokens;
    if (typeof copy.content === "string") {
        copy.content = truncateText(copy.content, remaining);
        return copy.content ? copy : undefined;
    }
    if (!Array.isArray(copy.content))
        return copy;
    const truncatedContent = copy.content.flatMap((part) => {
        if (!isJsonObject(part) || typeof part.text !== "string")
            return [part];
        if (remaining <= 0)
            return [];
        const cost = textTokens(part.text);
        const text = cost <= remaining ? part.text : truncateText(part.text, remaining);
        remaining = Math.max(0, remaining - cost);
        return text ? [{ ...part, text }] : [];
    });
    copy.content = truncatedContent;
    return truncatedContent.length > 0 ? copy : undefined;
}
const CONTEXTUAL_USER_WRAPPERS = [
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
function isContextualUserText(value) {
    const text = value.trimStart();
    const lower = text.toLowerCase();
    if (lower.startsWith("# agents.md instructions"))
        return lower.trimEnd().endsWith("</instructions>");
    if (lower.startsWith("<codex_internal_context")) {
        return /^<codex_internal_context source="[a-z][a-z0-9_]*">[\s\S]*<\/codex_internal_context>\s*$/.test(text);
    }
    if (lower.startsWith("<goal_context>"))
        return lower.trimEnd().endsWith("</goal_context>");
    if (lower.startsWith("<skill>"))
        return lower.trimEnd().endsWith("</skill>");
    if (lower.startsWith("<recommended_plugins>"))
        return lower.trimEnd().endsWith("</recommended_plugins>");
    if (lower.startsWith("<external_") && lower.includes(">")) {
        const opening = lower.match(/^<(external_[a-z0-9_-]+)>/);
        return opening !== null && lower.trimEnd().endsWith(`</${opening[1]}>`);
    }
    if (lower.startsWith("warning: the maximum number of unified exec processes you can keep open is"))
        return true;
    if (lower.startsWith("warning: your account was flagged for potentially high-risk cyber activity"))
        return true;
    if (lower.startsWith("warning: apply_patch was requested via ")) {
        return lower.trimEnd().endsWith("use the apply_patch tool instead of exec_command.");
    }
    return CONTEXTUAL_USER_WRAPPERS.some(([open, close]) => lower.startsWith(open) && lower.trimEnd().endsWith(close));
}
function isHookPromptText(value) {
    return /^<hook_prompt\b[^>]*hook_run_id=(?:"[^"]+"|'[^']+')\s*>[\s\S]*<\/hook_prompt>\s*$/i.test(value.trim());
}
function isRetainedUserMessage(item) {
    if (typeof item.content === "string")
        return !isContextualUserText(item.content);
    if (!Array.isArray(item.content))
        return true;
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
        if (isContextualUserText(part.text))
            continue;
        onlyContextOrHook = false;
    }
    return hookPrompt ? onlyContextOrHook : !item.content.some((part) => isJsonObject(part) && typeof part.text === "string" && isContextualUserText(part.text));
}
function isFinalAnswerAgentMessage(item) {
    if (item.type !== "agent_message" || !Array.isArray(item.content))
        return false;
    const first = item.content[0];
    return isJsonObject(first)
        && first.type === "input_text"
        && typeof first.text === "string"
        && first.text.startsWith("Message Type: FINAL_ANSWER\n");
}
function isDescendantProgressAgentMessage(item) {
    if (item.type !== "agent_message" || !Array.isArray(item.content))
        return false;
    if (typeof item.author !== "string" || typeof item.recipient !== "string")
        return false;
    const first = item.content[0];
    return item.author.startsWith(`${item.recipient}/`)
        && isJsonObject(first)
        && first.type === "input_text"
        && typeof first.text === "string"
        && first.text.startsWith("Message Type: MESSAGE\n");
}
function retainedMessageTokens(item) {
    if (typeof item.content === "string")
        return Math.max(1, textTokens(item.content));
    if (!Array.isArray(item.content))
        return 1;
    return Math.max(1, item.content.reduce((total, part) => total + (isJsonObject(part) ? contentTokens(part) : 0), 0));
}
function retainedItemTokens(item) {
    return item.type === "agent_message" ? approximateTokens(item) : retainedMessageTokens(item);
}
const IMAGE_RESIZE_NOTICE_START = "<image_resize_notice>";
const IMAGE_RESIZE_NOTICE_END = "</image_resize_notice>";
function isImageResizeNotice(item) {
    if (item.type !== "message" || item.role !== "developer" || !Array.isArray(item.content) || item.content.length !== 1)
        return false;
    const part = item.content[0];
    if (!isJsonObject(part) || part.type !== "input_text" || typeof part.text !== "string")
        return false;
    const text = part.text.trim().toLowerCase();
    return text.startsWith(IMAGE_RESIZE_NOTICE_START)
        && text.endsWith(IMAGE_RESIZE_NOTICE_END);
}
function retainedMessageGroups(items) {
    const groups = [];
    for (let index = 0; index < items.length; index++) {
        const source = items[index];
        const notice = items[index + 1];
        if (notice && isImageResizeNotice(notice)) {
            groups.push({ source, sourceIndex: index, notice });
            index++;
        }
        else {
            groups.push({ source, sourceIndex: index });
        }
    }
    return groups;
}
function retainedByCodex(item) {
    if (item.type === "agent_message") {
        return !isDescendantProgressAgentMessage(item)
            && !isFinalAnswerAgentMessage(item)
            && approximateTokens(item) <= MAX_RETAINED_AGENT_MESSAGE_TOKENS;
    }
    if (item.type !== "message" && item.type !== undefined)
        return false;
    return item.role === "user" && isRetainedUserMessage(item);
}
/** Mirrors current Codex V2's retained message whitelist and 64k newest-first budget. */
export function retainRecentMessages(items, maxTokens = RETAINED_MESSAGE_TOKEN_BUDGET) {
    let remaining = maxTokens;
    const retained = [];
    for (const group of retainedMessageGroups(items).reverse()) {
        if (remaining <= 0 || !retainedByCodex(group.source))
            continue;
        const noticeTokens = group.notice ? retainedMessageTokens(group.notice) : 0;
        const sourceTokens = retainedItemTokens(group.source);
        const tokens = sourceTokens + noticeTokens;
        if (tokens <= remaining) {
            if (group.notice)
                retained.push(structuredClone(group.notice));
            retained.push(structuredClone(group.source));
            remaining -= tokens;
            continue;
        }
        const hasImages = imagePartCount(group.source) > 0;
        if (remaining <= noticeTokens) {
            if (hasImages)
                remaining = 0;
            continue;
        }
        const sourceBudget = remaining - noticeTokens;
        if (hasImages)
            remaining = 0;
        const truncated = (group.source.type === "message" || group.source.type === undefined)
            ? hasImages ? truncateImageMessage(group.source, sourceBudget) : truncateMessage(group.source, sourceBudget)
            : undefined;
        if (truncated) {
            if (group.notice)
                retained.push(structuredClone(group.notice));
            retained.push(truncated);
            remaining = 0;
        }
    }
    return retained.reverse();
}
export function buildReplacementHistory(preCompactionInput, compactionItem) {
    if (compactionItem.type !== "compaction" || typeof compactionItem.encrypted_content !== "string") {
        throw new Error("OpenAI Codex did not return a valid compaction item.");
    }
    return [...retainRecentMessages(preCompactionInput), structuredClone(compactionItem)];
}
export function buildToolPayload(allTools, activeToolNames, supportsStrictMode = true, excludedToolNames) {
    const active = new Set(activeToolNames);
    const tools = allTools.filter((tool) => active.has(tool.name) && !excludedToolNames?.has(tool.name));
    return tools.length > 0 ? tools.map((tool) => responseTool(tool, false, supportsStrictMode)) : undefined;
}
export function buildCompactionRequestBody(params) {
    const base = params.basePayload ? structuredClone(params.basePayload) : {};
    const previousText = isJsonObject(base.text) && typeof base.text.verbosity === "string"
        ? { verbosity: base.text.verbosity }
        : { verbosity: "low" };
    const instructions = typeof base.instructions === "string" ? base.instructions : params.instructions;
    const requestTools = Array.isArray(base.tools) ? base.tools : params.tools;
    const body = {
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
    if (requestTools)
        body.tools = requestTools;
    if (isJsonObject(base.reasoning))
        body.reasoning = structuredClone(base.reasoning);
    if (typeof base.service_tier === "string")
        body.service_tier = base.service_tier;
    return body;
}
function extractCodexAccountId(token) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3)
            throw new Error("Invalid token");
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        const auth = payload["https://api.openai.com/auth"];
        if (!isJsonObject(auth) || typeof auth.chatgpt_account_id !== "string")
            throw new Error("Missing account ID");
        return auth.chatgpt_account_id;
    }
    catch {
        throw new Error("Failed to extract the ChatGPT account ID from the OpenAI Codex token.");
    }
}
export function mergeFeatureHeader(existing) {
    const features = (existing ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    return [...new Set([...features, REMOTE_COMPACTION_FEATURE])].join(",");
}
export function buildCodexHeaders(params) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(params.headers ?? {})) {
        if (value === null)
            headers.delete(name);
        else
            headers.set(name, value);
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
    if (params.turnState)
        headers.set("x-codex-turn-state", params.turnState);
    const features = mergeFeatureHeader(headers.get("x-codex-beta-features"));
    if (features)
        headers.set("x-codex-beta-features", features);
    else
        headers.delete("x-codex-beta-features");
    return headers;
}
function parseRetryDelay(response) {
    const retryAfterMilliseconds = response.headers.get("retry-after-ms");
    if (retryAfterMilliseconds !== null) {
        const milliseconds = Number(retryAfterMilliseconds);
        if (Number.isFinite(milliseconds) && milliseconds >= 0)
            return milliseconds;
    }
    const retryAfter = response.headers.get("retry-after");
    if (!retryAfter)
        return undefined;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
        return seconds * 1000;
    const date = Date.parse(retryAfter);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
function isRetryableStatus(status) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
}
function canFallbackForStatus(status, body) {
    if (![400, 403, 404, 408, 409, 429].includes(status) && status < 500)
        return false;
    if (status === 403 && !/(?:model|invalid request|not found|overloaded)/i.test(body))
        return false;
    if (status === 404 && !/(?:model|invalid request|overloaded)/i.test(body))
        return false;
    return !isFailClosedCompactionError(body);
}
export function markFallbackEligibility(error, eligible) {
    Object.defineProperty(error, "retryWithCurrentModel", { value: eligible, enumerable: false, configurable: true });
    return error;
}
function compactionRetry(error) {
    if (typeof error !== "object" || error === null || !("compactionRetry" in error))
        return undefined;
    const value = error.compactionRetry;
    return value === "none" || value === "automatic" || value === "explicit" ? value : undefined;
}
function compactionErrorCode(error) {
    if (typeof error !== "object" || error === null || !("compactionCode" in error))
        return undefined;
    const value = error.compactionCode;
    return typeof value === "string" ? value : undefined;
}
function markCompactionRetry(error, retry) {
    Object.defineProperty(error, "compactionRetry", { value: retry, enumerable: false, configurable: true });
    return error;
}
function markCompactionCode(error, code) {
    if (code)
        Object.defineProperty(error, "compactionCode", { value: code, enumerable: false, configurable: true });
    return error;
}
function shouldRetryCompaction(error) {
    const retry = compactionRetry(error);
    return retry === "automatic" || retry === "explicit";
}
function normalizedErrorCode(code) {
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
export function compactionFailureClassification(error) {
    const code = compactionErrorCode(error);
    if (code) {
        const normalized = normalizedErrorCode(code);
        if (CANONICAL_COMPACTION_ERROR_CODES.has(normalized))
            return normalized;
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = /\((\d{3})\):/.exec(message)?.[1];
    if (status)
        return `http_${status}`;
    if (/(?:auth|api[_ -]?key|token|credential)/i.test(message))
        return "authentication";
    if (/(?:policy|forbidden|permission|quota|usage[_ -]?limit|billing|out[_ -]?of[_ -]?budget|insufficient[_ -]?funds)/i.test(message))
        return "policy_or_quota";
    if (/(?:timeout|timed out)/i.test(message))
        return "timeout";
    if (/(?:network|websocket|connection|fetch)/i.test(message))
        return "network";
    if (/(?:context_length_exceeded|context_window_exceeded)/i.test(message))
        return "context_window_exceeded";
    return "compaction_failed";
}
function retryDelayFromMessage(message) {
    const match = /try again in\s+([\d.]+)\s*(ms|milliseconds?|s|seconds?)/i.exec(message);
    if (!match)
        return undefined;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0)
        return undefined;
    return /^(?:ms|milliseconds?)$/i.test(match[2]) ? value : value * 1000;
}
function withRetryDelay(error, message) {
    const delayMs = retryDelayFromMessage(message);
    if (delayMs !== undefined)
        Object.defineProperty(error, "retryAfterMs", { value: delayMs, enumerable: false, configurable: true });
    return error;
}
function isKnownCompactionErrorCode(code) {
    return !code
        || NON_RETRYABLE_FALLBACK_ERROR_CODES.has(code)
        || RETRYABLE_COMPACTION_ERROR_CODES.has(code);
}
function classifySseCompactionError(code, message) {
    const detail = code
        ? `OpenAI Codex compaction failed (${code}): ${message}`
        : message || "OpenAI Codex compaction failed.";
    const normalizedCode = normalizedErrorCode(code);
    const machineDetails = `${normalizedCode} ${message}`;
    const usageLimitMessage = USAGE_LIMIT_MESSAGE_PATTERN.test(machineDetails);
    const tag = (error) => markCompactionCode(error, normalizedCode);
    if (normalizedCode !== "content_filter" && isFailClosedCompactionError(machineDetails)) {
        return tag(markFallbackEligibility(markCompactionRetry(new Error(detail), "none"), false));
    }
    if (!usageLimitMessage && SSE_MODEL_FALLBACK_ERROR_CODES.has(normalizedCode) && !RETRYABLE_COMPACTION_ERROR_CODES.has(normalizedCode)) {
        return tag(markFallbackEligibility(markCompactionRetry(withRetryDelay(new Error(detail), message), "none"), true));
    }
    if (!normalizedCode || !isKnownCompactionErrorCode(normalizedCode)) {
        return tag(markFallbackEligibility(markCompactionRetry(withRetryDelay(new Error(detail), message), "explicit"), false));
    }
    if (RETRYABLE_COMPACTION_ERROR_CODES.has(normalizedCode)
        || RETRYABLE_COMPACTION_ERROR_PATTERN.test(machineDetails)) {
        return tag(markFallbackEligibility(markCompactionRetry(withRetryDelay(new Error(detail), message), "explicit"), !usageLimitMessage && SSE_MODEL_FALLBACK_ERROR_CODES.has(normalizedCode)));
    }
    return tag(markFallbackEligibility(markCompactionRetry(withRetryDelay(new Error(detail), message), "none"), false));
}
function errorCodeFromResponseBody(body) {
    try {
        const parsed = JSON.parse(body);
        const error = isJsonObject(parsed) && isJsonObject(parsed.error) ? parsed.error : parsed;
        if (!isJsonObject(error))
            return "";
        const code = typeof error.code === "string" ? error.code : error.type;
        return typeof code === "string" ? code : "";
    }
    catch {
        return "";
    }
}
function classifyHttpCompactionError(status, body, prefix) {
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
    const error = markCompactionRetry(new Error(`${prefix} (${status}): ${body || "HTTP error"}`), retryable ? "explicit" : "none");
    return { error: markFallbackEligibility(markCompactionCode(error, code), fallback), retryable };
}
function abortError(signal) {
    return signal.reason instanceof Error ? signal.reason : new Error("Compaction aborted");
}
async function delay(ms, signal) {
    if (signal?.aborted)
        throw abortError(signal);
    if (ms <= 0)
        return;
    try {
        await sleep(ms, undefined, signal ? { signal } : undefined);
    }
    catch (error) {
        if (signal?.aborted)
            throw abortError(signal);
        throw error;
    }
}
async function withCompactionTimeout(operation, timeoutMs, message, onTimeout) {
    let timer;
    const timeoutError = markFallbackEligibility(markCompactionRetry(new Error(message), "explicit"), false);
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(timeoutError);
            onTimeout?.(timeoutError);
        }, timeoutMs);
    });
    try {
        return await Promise.race([operation(), timeout]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
async function parseSseResponse(response, signal, idleTimeoutMs = V2_COMPACTION_IDLE_TIMEOUT_MS) {
    if (!response.body) {
        throw markFallbackEligibility(markCompactionRetry(new Error("OpenAI Codex returned an empty compaction stream."), "explicit"), false);
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
    let usage;
    let serviceTier;
    const compactionItems = [];
    const onAbort = () => {
        void reader.cancel().catch(() => { });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const processBlock = (block) => {
        const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
            .trim();
        if (!data || data === "[DONE]")
            return;
        let event;
        try {
            event = JSON.parse(data);
        }
        catch {
            throw markFallbackEligibility(markCompactionRetry(new Error("OpenAI Codex returned malformed compaction SSE data."), "none"), false);
        }
        if (!isJsonObject(event)) {
            throw markFallbackEligibility(markCompactionRetry(new Error("OpenAI Codex returned a non-object compaction SSE data frame."), "none"), false);
        }
        if (event.type === "response.output_item.done") {
            if (!isResponseItem(event.item)) {
                throw markFallbackEligibility(markCompactionRetry(new Error("OpenAI Codex returned a malformed response.output_item.done item."), "none"), false);
            }
            if (event.item.type === "compaction")
                compactionItems.push(event.item);
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
                throw markFallbackEligibility(markCompactionRetry(new Error("OpenAI Codex compaction failed."), "none"), false);
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
            const explicitRetry = normalizedReason === "content_filter" || (!isFailClosedCompactionError(`${reason} ${message}`)
                && !/invalid[_ -]?(?:prompt|request)|malformed|protocol/i.test(`${reason} ${message}`));
            const retry = normalizedReason === "context_length_exceeded" || normalizedReason === "context_window_exceeded"
                ? "automatic"
                : explicitRetry ? "explicit" : "automatic";
            const error = markCompactionCode(markCompactionRetry(withRetryDelay(new Error(message), message), retry), normalizedReason);
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
                throw markFallbackEligibility(markCompactionRetry(new Error("OpenAI Codex returned a malformed response.completed response."), "none"), false);
            }
            completed = true;
            usage = response.usage;
            if (typeof response.service_tier === "string")
                serviceTier = response.service_tier;
        }
    };
    try {
        while (!completed) {
            const { done, value } = await withCompactionTimeout(() => reader.read(), idleTimeoutMs, "OpenAI Codex compaction stream idle timeout.");
            buffer += decoder.decode(value, { stream: !done });
            buffer = buffer.replace(/\r\n/g, "\n");
            let boundary = buffer.indexOf("\n\n");
            while (!completed && boundary >= 0) {
                processBlock(buffer.slice(0, boundary));
                buffer = buffer.slice(boundary + 2);
                boundary = buffer.indexOf("\n\n");
            }
            if (done)
                break;
        }
        if (!completed && buffer.trim())
            processBlock(buffer);
    }
    finally {
        signal?.removeEventListener("abort", onAbort);
        try {
            await reader.cancel();
        }
        catch { }
        try {
            reader.releaseLock();
        }
        catch { }
    }
    if (!completed) {
        throw markFallbackEligibility(markCompactionRetry(new Error("OpenAI Codex compaction stream closed before response.completed."), "explicit"), false);
    }
    if (compactionItems.length !== 1) {
        throw markCompactionRetry(new Error(`OpenAI Codex returned ${compactionItems.length} compaction items; expected exactly one.`), "none");
    }
    const item = compactionItems[0];
    if (typeof item.encrypted_content !== "string") {
        throw markCompactionRetry(new Error("OpenAI Codex returned a compaction item without encrypted_content."), "none");
    }
    return { item, usage, serviceTier };
}
function serviceTierMultiplier(model, requestTier, responseTier) {
    const tier = responseTier === "default" ? requestTier : responseTier ?? requestTier;
    if (tier === "flex")
        return 0.5;
    if (tier === "priority")
        return model.id === "gpt-5.5" ? 2.5 : 2;
    return 1;
}
function usageFromResponse(model, value, requestTier, responseTier) {
    if (!isJsonObject(value))
        return undefined;
    const inputTokens = typeof value.input_tokens === "number" ? value.input_tokens : 0;
    const outputTokens = typeof value.output_tokens === "number" ? value.output_tokens : 0;
    const details = isJsonObject(value.input_tokens_details) ? value.input_tokens_details : undefined;
    const cacheRead = typeof details?.cached_tokens === "number" ? details.cached_tokens : 0;
    const cacheWrite = typeof details?.cache_write_tokens === "number" ? details.cache_write_tokens : 0;
    const usage = {
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
export async function callRemoteCompaction(params) {
    const fetchImpl = params.fetchImpl ?? fetch;
    let lastError;
    let turnStateCaptured = params.headers.has("x-codex-turn-state");
    for (let attempt = 0; attempt <= MAX_REMOTE_RETRIES; attempt++) {
        const attemptController = new AbortController();
        const relayAbort = () => attemptController.abort(params.signal?.reason);
        if (params.signal?.aborted)
            attemptController.abort(params.signal.reason);
        else
            params.signal?.addEventListener("abort", relayAbort, { once: true });
        try {
            try {
                const response = await withCompactionTimeout(() => fetchImpl(params.url, {
                    method: "POST",
                    headers: params.headers,
                    body: JSON.stringify(params.body),
                    signal: attemptController.signal,
                }), V2_COMPACTION_IDLE_TIMEOUT_MS, "OpenAI Codex compaction request timed out.", (error) => attemptController.abort(error));
                const responseTurnState = response.headers.get("x-codex-turn-state");
                if (responseTurnState && !turnStateCaptured) {
                    params.headers.set("x-codex-turn-state", responseTurnState);
                    params.onTurnState?.(responseTurnState);
                    turnStateCaptured = true;
                }
                if (!response.ok) {
                    const body = await response.text().catch(() => "");
                    const classified = classifyHttpCompactionError(response.status, body || response.statusText, "OpenAI Codex compaction failed");
                    if (!classified.retryable || attempt === MAX_REMOTE_RETRIES)
                        throw classified.error;
                    lastError = classified.error;
                    await delay(parseRetryDelay(response) ?? 1000 * 2 ** attempt, params.signal);
                    continue;
                }
                const parsed = await parseSseResponse(response, params.signal, V2_COMPACTION_IDLE_TIMEOUT_MS);
                return {
                    compactionItem: parsed.item,
                    usage: usageFromResponse(params.model, parsed.usage, typeof params.body.service_tier === "string" ? params.body.service_tier : undefined, parsed.serviceTier),
                };
            }
            finally {
                params.signal?.removeEventListener("abort", relayAbort);
                attemptController.abort();
            }
        }
        catch (error) {
            const classified = error instanceof Error ? error : new Error(String(error));
            if (params.signal?.aborted) {
                throw markFallbackEligibility(markCompactionRetry(classified, "none"), false);
            }
            if (compactionRetry(classified) === undefined)
                markCompactionRetry(classified, "explicit");
            if (!shouldRetryCompaction(classified))
                throw classified;
            lastError = classified;
            if (attempt === MAX_REMOTE_RETRIES)
                throw classified;
            const retryAfterMs = isJsonObject(classified) && typeof classified.retryAfterMs === "number" ? classified.retryAfterMs : undefined;
            await delay(retryAfterMs ?? 1000 * 2 ** attempt, params.signal);
        }
    }
    throw lastError instanceof Error ? lastError : new Error("OpenAI Codex compaction failed");
}
export function stripInputFromPayload(payload) {
    const shape = structuredClone(payload);
    delete shape.input;
    delete shape.messages;
    delete shape.previous_response_id;
    return shape;
}
//# sourceMappingURL=native-compaction.js.map