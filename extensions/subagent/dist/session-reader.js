import { createReadStream } from "node:fs";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { currentOperation } from "./operation.js";
import { CursorError, decodeTurnsPageCursor, encodeTurnsPageCursor, decodeActivityCursor, decodeDetailCursor, encodeActivityCursor, encodeDetailCursor, } from "./cursor.js";
const ASSISTANT_TEXT_MAX_BYTES = 64 * 1024;
const DETAIL_PAGE_MAX_BYTES = 16 * 1024;
const ERROR_PREVIEW_MAX_BYTES = 512;
const RECENT_ACTIVITY_MAX_BYTES = 72 * 1024;
const SUMMARY_WARNING_LIMIT = 20;
const SUMMARY_WARNING_MAX_BYTES = 512;
/** Confirms native user persistence without applying presentation limits or pagination. */
export async function hasPersistedPrompt(options) {
    const { header, entries } = await readSessionSnapshot(options.sessionFile);
    if (header.version !== 3)
        throw new Error(`Unsupported Pi session version: ${String(header.version)}`);
    if (header.id !== options.agentId)
        throw new Error("Session header id does not match the requested agent");
    const after = decodeActivityCursor(options.after, { ...options, view: "turns" }).position;
    return selectActiveBranch(entries).some((entry) => {
        const message = entry.value.message;
        return entry.position > after && entry.value.type === "message" && isRecord(message)
            && message.role === "user" && extractUserText(message.content, String(entry.value.id)).startsWith(options.marker);
    });
}
export async function readSessionView(options) {
    const signal = options.signal ?? currentOperation()?.signal;
    signal?.throwIfAborted();
    const { header, entries, warnings } = options.snapshot ?? await readSessionSnapshot(options.sessionFile, signal);
    signal?.throwIfAborted();
    if (header.version !== 3) {
        throw new Error(`Unsupported Pi session version: ${String(header.version)}`);
    }
    if (header.id !== options.agentId) {
        throw new Error("Session header id does not match the requested agent");
    }
    let activeEntries = selectActiveBranch(entries, options.leafId);
    if (options.leafPosition !== undefined && entries.length > options.leafPosition) {
        const latestBranch = selectActiveBranch(entries);
        if (options.leafId === null || latestBranch.some((entry) => entry.value.id === options.leafId)) {
            activeEntries = latestBranch;
        }
    }
    const page = options.view === "turns" && options.pageCursor
        ? decodeTurnsPageCursor(options.pageCursor, options)
        : undefined;
    if (page) {
        if (page.position > entries.length || !activeEntries.some((entry) => entry.value.id === page.leafId)) {
            throw new CursorError("cursor_mismatch", "Cursor does not match the requested agent and view");
        }
        activeEntries = selectActiveBranch(entries.filter((entry) => entry.position <= page.position), page.leafId);
    }
    if (options.view === "activity_detail") {
        if (!options.activityId || !options.section) {
            throw new Error("Activity detail requires activityId and section");
        }
        return readActivityDetail({
            entries: activeEntries,
            agentId: options.agentId,
            epoch: options.epoch,
            activityId: options.activityId,
            section: options.section,
            detailCursor: options.detailCursor,
        });
    }
    const afterPosition = page?.afterPosition ?? (options.after
        ? decodeActivityCursor(options.after, {
            agentId: options.agentId,
            epoch: options.epoch,
            view: options.view,
        }).position
        : 0);
    if (afterPosition > entries.length) {
        throw new Error("Activity cursor points beyond the current session");
    }
    const position = Math.max(afterPosition, activeEntries.at(-1)?.position ?? 0);
    const cursor = encodeActivityCursor({
        agentId: options.agentId,
        epoch: options.epoch,
        view: options.view,
        position,
    });
    if (options.view === "recent_activity") {
        const activity = projectActivity(activeEntries, afterPosition);
        const assistantLimit = options.assistantLimit ?? 1;
        const toolLimit = options.toolLimit ?? 1;
        const maximumBytes = Math.min(RECENT_ACTIVITY_MAX_BYTES, Math.max(0, options.maximumBytes ?? RECENT_ACTIVITY_MAX_BYTES));
        const assistants = activity.filter((item) => (item.activity.kind === "assistant" && isVisibleAssistant(item.activity)));
        const tools = activity.filter((item) => item.activity.kind === "tool");
        const assistantCandidates = takeLast(assistants, assistantLimit);
        const toolCandidates = takeLast(tools, toolLimit);
        const priority = [
            ...assistantCandidates.slice(-1),
            ...toolCandidates.slice(-1),
            ...toolCandidates.slice(0, -1).reverse(),
            ...assistantCandidates.slice(0, -1).reverse(),
        ];
        const selected = [];
        for (const candidate of priority) {
            const trialItems = [...selected, candidate].sort((left, right) => left.order - right.order);
            const trial = finalizeRecentActivityResult({
                activity: trialItems.flatMap((item) => {
                    const summary = summarizeActivity(item.activity);
                    return summary ? [summary] : [];
                }),
                totalAssistant: assistants.length,
                totalTools: tools.length,
                warnings,
                cursor,
                position,
                maximumBytes,
            });
            if (trial.returnedBytes <= maximumBytes)
                selected.push(candidate);
        }
        return finalizeRecentActivityResult({
            activity: selected
                .sort((left, right) => left.order - right.order)
                .flatMap((item) => {
                const summary = summarizeActivity(item.activity);
                return summary ? [summary] : [];
            }),
            totalAssistant: assistants.length,
            totalTools: tools.length,
            warnings,
            cursor,
            position,
            maximumBytes,
        });
    }
    if (options.view === "turns") {
        return readTurnsPage(activeEntries, afterPosition, options, page, warnings, cursor, position);
    }
    throw new Error(`Unsupported session view: ${String(options.view)}`);
}
function readActivityDetail(options) {
    const activity = projectActivity(options.entries, 0)
        .find((item) => item.activity.id === options.activityId)
        ?.activity;
    const user = options.section === "user_text"
        ? options.entries.find((entry) => entry.value.id === options.activityId)?.value.message
        : undefined;
    if (!activity && !(isRecord(user) && user.role === "user")) {
        throw new Error(`Activity not found: ${options.activityId}`);
    }
    let detail;
    if (options.section === "user_text" && isRecord(user) && user.role === "user") {
        detail = extractUserText(user.content, options.activityId);
    }
    else if (options.section === "assistant_text" || options.section === "assistant_error") {
        if (activity?.kind !== "assistant") {
            throw new Error("assistant_text is only available for assistant activity");
        }
        detail = options.section === "assistant_error" ? activity.errorMessage ?? "" : activity.text;
    }
    else {
        if (activity?.kind !== "tool") {
            throw new Error(`${options.section} is only available for tool activity`);
        }
        if (options.section === "tool_arguments") {
            detail = JSON.stringify(activity.arguments);
        }
        else {
            if (!activity.complete || activity.result === undefined) {
                throw new Error("tool_result is not available for pending tool activity");
            }
            detail = activity.result;
        }
    }
    const start = options.detailCursor
        ? decodeDetailCursor(options.detailCursor, {
            agentId: options.agentId,
            epoch: options.epoch,
            activityId: options.activityId,
            section: options.section,
        }).bytePosition
        : 0;
    const bytes = Buffer.from(detail, "utf8");
    if (start > bytes.length)
        throw new Error("Detail cursor points beyond the activity detail");
    if (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
        throw new Error("Detail cursor points inside a UTF-8 sequence");
    }
    let end = Math.min(start + DETAIL_PAGE_MAX_BYTES, bytes.length);
    if (end < bytes.length) {
        while (end > start && (bytes[end] & 0xc0) === 0x80)
            end -= 1;
    }
    const content = bytes.subarray(start, end).toString("utf8");
    const hasMore = end < bytes.length;
    return {
        view: "activity_detail",
        activityId: options.activityId,
        section: options.section,
        content,
        originalBytes: bytes.length,
        returnedBytes: end - start,
        truncated: start > 0 || hasMore,
        hasMore,
        ...(hasMore
            ? {
                nextDetailCursor: encodeDetailCursor({
                    agentId: options.agentId,
                    epoch: options.epoch,
                    activityId: options.activityId,
                    section: options.section,
                    bytePosition: end,
                }),
            }
            : {}),
    };
}
export async function readSessionSnapshot(sessionFile, signal = currentOperation()?.signal) {
    signal?.throwIfAborted();
    const stream = createReadStream(sessionFile, { encoding: "utf8", highWaterMark: 64 * 1024, signal });
    let pending = "";
    let header;
    let lineNumber = 0;
    const entries = [], warnings = [];
    try {
        for await (const chunk of stream) {
            signal?.throwIfAborted();
            pending += chunk;
            let newline;
            while ((newline = pending.indexOf("\n")) >= 0) {
                const line = pending.slice(0, newline);
                pending = pending.slice(newline + 1);
                if (!line.trim())
                    continue;
                lineNumber++;
                let value;
                try {
                    const parsed = JSON.parse(line);
                    if (!isRecord(parsed))
                        throw new Error("entry is not an object");
                    value = parsed;
                }
                catch (error) {
                    throw new Error(`Invalid Pi session JSONL at complete line ${lineNumber}`, { cause: error });
                }
                if (!header) {
                    if (value.type !== "session" || typeof value.id !== "string")
                        throw new Error("Invalid Pi session header");
                    header = value;
                }
                else {
                    if (!isKnownEntryType(value.type))
                        warnings.push(`Unknown Pi session entry type: ${String(value.type)}`);
                    validateEntryBase(value, entries.length + 1);
                    entries.push({ value, position: entries.length + 1 });
                }
                if (lineNumber % 64 === 0) {
                    await yieldToLoop(undefined, { signal });
                    signal?.throwIfAborted();
                }
            }
        }
        if (!header)
            throw new Error("Pi session has no complete header");
        return { header, entries, warnings };
    }
    finally {
        stream.destroy();
    }
}
function selectActiveBranch(entries, leafId) {
    if (entries.length === 0 || leafId === null)
        return [];
    const byId = new Map(entries.map((entry) => [String(entry.value.id), entry]));
    const selectedLeafId = leafId ?? String(entries.at(-1)?.value.id);
    const branch = [];
    const visited = new Set();
    let currentId = selectedLeafId;
    while (currentId !== null) {
        if (visited.has(currentId))
            throw new Error("Invalid Pi session tree: parent cycle detected");
        visited.add(currentId);
        const entry = byId.get(currentId);
        if (!entry)
            throw new Error(`Invalid Pi session tree: entry not found: ${currentId}`);
        branch.push(entry);
        const parentId = entry.value.parentId;
        currentId = typeof parentId === "string" ? parentId : null;
    }
    return branch.reverse();
}
function readTurnsPage(entries, afterPosition, options, page, warnings, cursor, position) {
    const starts = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => (entry.value.type === "message" && isRecord(entry.value.message) && entry.value.message.role === "user"));
    const ranges = starts.map((start, index) => ({ ...start, end: starts[index + 1]?.index ?? entries.length }))
        .filter((range) => entries[range.end - 1].position > afterPosition);
    const limit = page?.limit ?? options.limit ?? 20;
    const selected = limit <= 0 ? [] : ranges.slice(-limit);
    const turns = [];
    if (page && (page.turnIndex >= selected.length || page.position !== position)) {
        throw new CursorError("invalid_cursor", "Invalid activity cursor");
    }
    const boundedWarnings = warnings.slice(0, SUMMARY_WARNING_LIMIT)
        .map((warning) => truncateUtf8(warning, SUMMARY_WARNING_MAX_BYTES).text);
    while (Buffer.byteLength(JSON.stringify(boundedWarnings)) > 8 * 1024)
        boundedWarnings.pop();
    if (boundedWarnings.length < warnings.length) {
        boundedWarnings.push(`${warnings.length - boundedWarnings.length} additional warnings omitted`);
    }
    const finish = (turnIndex, activityIndex) => {
        const hasMore = turnIndex < selected.length;
        const result = {
            view: "turns", turns, warnings: boundedWarnings, cursor, position,
            omittedTurns: ranges.length - selected.length, hasMore,
            ...(hasMore ? { nextPageCursor: encodeTurnsPageCursor({
                    agentId: options.agentId, epoch: options.epoch, position, afterPosition, limit,
                    leafId: String(entries.at(-1).value.id), turnIndex, activityIndex,
                }) } : {}),
        };
        let returnedBytes = 0;
        while (true) {
            const value = { ...result, returnedBytes };
            const bytes = Buffer.byteLength(JSON.stringify(value));
            if (bytes === returnedBytes)
                return value;
            returnedBytes = bytes;
        }
    };
    for (let turnIndex = page?.turnIndex ?? 0; turnIndex < selected.length; turnIndex++) {
        const range = selected[turnIndex];
        const message = range.entry.value.message;
        const id = String(range.entry.value.id);
        const activity = projectActivity(entries.slice(range.index, range.end), afterPosition)
            .sort((left, right) => left.order - right.order)
            .filter((item) => item.activity.kind === "tool" || isVisibleAssistant(item.activity));
        const start = turnIndex === page?.turnIndex ? page.activityIndex : 0;
        if (start >= Math.max(1, activity.length)) {
            throw new CursorError("invalid_cursor", "Invalid activity cursor");
        }
        const userText = truncateUtf8(extractUserText(message.content, id), 4 * 1024);
        const turn = {
            id, user: { id, timestamp: String(range.entry.value.timestamp), text: userText.text,
                ...(userText.truncated ? { truncated: true, detailRef: { activityId: id, sections: ["user_text"] } } : {}),
            },
            activity: [], ...(start > 0 ? { continued: true } : {}),
        };
        turns.push(turn);
        for (let index = start; index < Math.max(1, activity.length); index++) {
            const item = activity[index]?.activity;
            if (item)
                turn.activity.push(summarizeActivity(item));
            const nextTurn = index + 1 >= activity.length ? turnIndex + 1 : turnIndex;
            const nextIndex = nextTurn === turnIndex ? index + 1 : 0;
            let result = finish(nextTurn, nextIndex);
            if (result.returnedBytes > RECENT_ACTIVITY_MAX_BYTES) {
                if (item)
                    turn.activity.pop();
                if (turn.activity.length === 0)
                    turns.pop();
                if (turns.length > 0)
                    return finish(turnIndex, index);
                turns.push(turn);
                // A single escaped assistant can exceed the whole page budget.
                let textBytes = ASSISTANT_TEXT_MAX_BYTES;
                if (item) {
                    do {
                        textBytes = Math.floor(textBytes / 2);
                        turn.activity = [summarizeActivity(item, textBytes)];
                        result = finish(nextTurn, nextIndex);
                    } while (result.returnedBytes > RECENT_ACTIVITY_MAX_BYTES && textBytes > 256);
                }
                if (result.returnedBytes > RECENT_ACTIVITY_MAX_BYTES) {
                    throw new Error(`Invalid Pi session entry at position ${range.entry.position}`);
                }
            }
        }
    }
    return finish(selected.length, 0);
}
function projectActivity(entries, afterPosition) {
    const toolCalls = new Map();
    const toolResults = new Map();
    const assistants = [];
    for (const entry of entries) {
        if (entry.value.type !== "message")
            continue;
        const message = entry.value.message;
        if (!isRecord(message) || typeof message.role !== "string") {
            throw new Error(`Invalid core message entry: ${String(entry.value.id)}`);
        }
        if (message.role === "assistant") {
            if (!Array.isArray(message.content) || typeof message.stopReason !== "string") {
                throw new Error(`Invalid assistant message entry: ${String(entry.value.id)}`);
            }
            const textParts = [];
            message.content.forEach((part, blockIndex) => {
                if (!isRecord(part) || typeof part.type !== "string") {
                    throw new Error(`Invalid assistant content block: ${String(entry.value.id)}`);
                }
                if (part.type === "text") {
                    if (typeof part.text !== "string") {
                        throw new Error(`Invalid assistant text block: ${String(entry.value.id)}`);
                    }
                    textParts.push(part.text);
                }
                else if (part.type === "toolCall") {
                    if (typeof part.id !== "string"
                        || typeof part.name !== "string"
                        || !isRecord(part.arguments)) {
                        throw new Error(`Invalid assistant tool call: ${String(entry.value.id)}`);
                    }
                    toolCalls.set(part.id, {
                        id: part.id,
                        name: part.name,
                        arguments: part.arguments,
                        timestamp: String(entry.value.timestamp),
                        order: entry.position * 1_000 + blockIndex + 1,
                        position: entry.position,
                    });
                }
            });
            if (entry.position > afterPosition) {
                assistants.push({
                    activity: {
                        kind: "assistant",
                        id: String(entry.value.id),
                        timestamp: String(entry.value.timestamp),
                        text: textParts.join("\n"),
                        stopReason: message.stopReason,
                        ...(typeof message.errorMessage === "string" ? { errorMessage: message.errorMessage } : {}),
                    },
                    order: entry.position * 1_000,
                    activityPosition: entry.position,
                });
            }
        }
        else if (message.role === "toolResult") {
            if (typeof message.toolCallId !== "string"
                || typeof message.toolName !== "string"
                || !Array.isArray(message.content)
                || typeof message.isError !== "boolean") {
                throw new Error(`Invalid tool result message entry: ${String(entry.value.id)}`);
            }
            toolResults.set(message.toolCallId, {
                text: extractTextContent(message.content),
                isError: message.isError,
                position: entry.position,
            });
        }
    }
    const tools = [];
    for (const call of toolCalls.values()) {
        const result = toolResults.get(call.id);
        const activityPosition = result ? Math.max(call.position, result.position) : call.position;
        if (activityPosition <= afterPosition)
            continue;
        tools.push({
            activity: {
                kind: "tool",
                id: call.id,
                timestamp: call.timestamp,
                toolName: call.name,
                arguments: call.arguments,
                ...(result ? { result: result.text, isError: result.isError } : {}),
                complete: result !== undefined,
            },
            order: call.order,
            activityPosition,
        });
    }
    return [...assistants, ...tools];
}
function takeLast(items, limit) {
    return limit <= 0 ? [] : items.slice(-limit);
}
function finalizeRecentActivityResult(options) {
    const maximumWarnings = Math.min(options.warnings.length, SUMMARY_WARNING_LIMIT);
    for (let count = maximumWarnings; count >= 0; count -= 1) {
        const warnings = options.warnings
            .slice(0, count)
            .map((warning) => truncateUtf8(warning, SUMMARY_WARNING_MAX_BYTES).text);
        const omittedWarnings = options.warnings.length - count;
        if (omittedWarnings > 0) {
            warnings.push(`${omittedWarnings} additional warnings omitted`);
        }
        const result = buildRecentActivityResult(options, warnings);
        if (result.returnedBytes <= options.maximumBytes)
            return result;
    }
    return buildRecentActivityResult(options, []);
}
function buildRecentActivityResult(options, warnings) {
    const assistantCount = options.activity.filter((item) => item.kind === "assistant").length;
    const toolCount = options.activity.filter((item) => item.kind === "tool").length;
    let returnedBytes = 0;
    let result;
    do {
        result = {
            view: "recent_activity",
            activity: options.activity,
            assistantCount,
            toolCount,
            omittedAssistant: options.totalAssistant - assistantCount,
            omittedTools: options.totalTools - toolCount,
            hasMore: assistantCount < options.totalAssistant || toolCount < options.totalTools,
            returnedBytes,
            warnings,
            cursor: options.cursor,
            position: options.position,
        };
        const serializedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
        if (serializedBytes === returnedBytes)
            return result;
        returnedBytes = serializedBytes;
    } while (true);
}
function isVisibleAssistant(activity) {
    return activity.text.trim().length > 0
        || activity.stopReason === "error"
        || activity.stopReason === "aborted"
        || Boolean(activity.errorMessage);
}
function summarizeActivity(activity, maximumTextBytes = ASSISTANT_TEXT_MAX_BYTES) {
    if (activity.kind === "assistant") {
        if (!isVisibleAssistant(activity))
            return undefined;
        const failed = activity.stopReason === "error" || activity.stopReason === "aborted" || Boolean(activity.errorMessage);
        const text = truncateUtf8(activity.text, failed ? Math.min(maximumTextBytes, 4 * 1024) : maximumTextBytes);
        const error = activity.errorMessage === undefined ? undefined : truncateUtf8(activity.errorMessage, ERROR_PREVIEW_MAX_BYTES);
        const truncated = text.truncated || error?.truncated === true;
        return {
            kind: "assistant",
            id: activity.id,
            timestamp: activity.timestamp,
            text: text.text,
            stopReason: activity.stopReason,
            ...(error === undefined ? {} : { errorMessage: error.text }),
            truncated,
            ...(truncated
                ? {
                    detailRef: {
                        activityId: activity.id,
                        sections: [
                            ...(text.truncated ? ["assistant_text"] : []),
                            ...(error?.truncated ? ["assistant_error"] : []),
                        ],
                    },
                }
                : {}),
        };
    }
    return {
        kind: "tool",
        id: activity.id,
        timestamp: activity.timestamp,
        toolName: activity.toolName,
        outcome: activity.complete
            ? activity.isError ? "failed" : "succeeded"
            : "pending",
        detailRef: {
            activityId: activity.id,
            sections: [
                "tool_arguments",
                ...(activity.complete ? ["tool_result"] : []),
            ],
        },
        ...(activity.complete && activity.isError && activity.result
            ? { errorPreview: truncateUtf8(activity.result, ERROR_PREVIEW_MAX_BYTES).text }
            : {}),
    };
}
function truncateUtf8(value, maximumBytes) {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length <= maximumBytes)
        return { text: value, truncated: false };
    const suffix = "…";
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    let end = Math.max(0, maximumBytes - suffixBytes);
    while (end > 0 && (bytes[end] & 0xc0) === 0x80)
        end -= 1;
    return {
        text: `${bytes.subarray(0, end).toString("utf8")}${suffix}`,
        truncated: true,
    };
}
function extractUserText(content, entryId) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        throw new Error(`Invalid user message entry: ${entryId}`);
    return content
        .filter((part) => isRecord(part) && part.type === "text")
        .map((part) => {
        if (typeof part.text !== "string")
            throw new Error(`Invalid user text block: ${entryId}`);
        return part.text;
    })
        .join("\n");
}
function extractTextContent(content) {
    return content
        .filter((part) => isRecord(part) && part.type === "text")
        .map((part) => {
        if (typeof part.text !== "string")
            throw new Error("Invalid tool result text block");
        return part.text;
    })
        .join("\n");
}
function validateEntryBase(value, position) {
    if (typeof value.id !== "string"
        || !(typeof value.parentId === "string" || value.parentId === null)
        || typeof value.timestamp !== "string") {
        throw new Error(`Invalid Pi session entry at position ${position}`);
    }
}
function isKnownEntryType(value) {
    return value === "message"
        || value === "thinking_level_change"
        || value === "model_change"
        || value === "compaction"
        || value === "branch_summary"
        || value === "custom"
        || value === "custom_message"
        || value === "label"
        || value === "session_info";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=session-reader.js.map