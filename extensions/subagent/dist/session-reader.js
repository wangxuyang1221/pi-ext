import { readFile } from "node:fs/promises";
import { decodeActivityCursor, encodeActivityCursor, } from "./cursor.js";
export async function readSessionView(options) {
    const { header, entries, warnings } = await readCompleteEntries(options.sessionFile);
    if (header.version !== 3) {
        throw new Error(`Unsupported Pi session version: ${String(header.version)}`);
    }
    if (header.id !== options.agentId) {
        throw new Error("Session header id does not match the requested agent");
    }
    const position = entries.length;
    const afterPosition = options.after
        ? decodeActivityCursor(options.after, {
            agentId: options.agentId,
            epoch: options.epoch,
            view: options.view,
        }).position
        : 0;
    if (afterPosition > position) {
        throw new Error("Activity cursor points beyond the current session");
    }
    const cursor = encodeActivityCursor({
        agentId: options.agentId,
        epoch: options.epoch,
        view: options.view,
        position,
    });
    const activeEntries = selectActiveBranch(entries, options.leafId);
    if (options.view === "recent_activity") {
        const activity = projectActivity(activeEntries, afterPosition);
        const assistantLimit = options.assistantLimit ?? 3;
        const toolLimit = options.toolLimit ?? 5;
        const assistantIds = new Set(activity
            .filter((item) => item.activity.kind === "assistant")
            .slice(-assistantLimit)
            .map((item) => item.activity.id));
        const toolIds = new Set(activity
            .filter((item) => item.activity.kind === "tool")
            .slice(-toolLimit)
            .map((item) => item.activity.id));
        const selected = activity
            .filter((item) => item.activity.kind === "assistant"
            ? assistantIds.has(item.activity.id)
            : toolIds.has(item.activity.id))
            .sort((left, right) => left.order - right.order)
            .map((item) => item.activity);
        return {
            view: "recent_activity",
            activity: selected,
            assistantCount: selected.filter((item) => item.kind === "assistant").length,
            toolCount: selected.filter((item) => item.kind === "tool").length,
            warnings,
            cursor,
            position,
        };
    }
    if (options.view === "turns") {
        const turns = projectTurns(activeEntries, afterPosition);
        const limit = options.limit ?? 20;
        return {
            view: "turns",
            turns: limit === 0 ? [] : turns.slice(-limit),
            warnings,
            cursor,
            position,
        };
    }
    const allEntries = entries.slice(afterPosition);
    const limit = options.limit ?? 50;
    return {
        view: "all_entries",
        entries: (limit === 0 ? [] : allEntries.slice(-limit)).map((entry) => entry.value),
        warnings,
        cursor,
        position,
    };
}
async function readCompleteEntries(sessionFile) {
    const content = await readFile(sessionFile, "utf8");
    const segments = content.split("\n");
    if (!content.endsWith("\n"))
        segments.pop();
    const lines = segments.filter((line) => line.trim().length > 0);
    if (lines.length === 0)
        throw new Error("Pi session has no complete header");
    const values = lines.map((line, index) => {
        try {
            const value = JSON.parse(line);
            if (!isRecord(value))
                throw new Error("entry is not an object");
            return value;
        }
        catch (error) {
            throw new Error(`Invalid Pi session JSONL at complete line ${index + 1}`, { cause: error });
        }
    });
    const header = values[0];
    if (header.type !== "session" || typeof header.id !== "string") {
        throw new Error("Invalid Pi session header");
    }
    const warnings = [];
    const entries = values.slice(1).map((value, index) => {
        if (!isKnownEntryType(value.type)) {
            warnings.push(`Unknown Pi session entry type: ${String(value.type)}`);
        }
        validateEntryBase(value, index + 1);
        return { value, position: index + 1 };
    });
    return { header, entries, warnings };
}
function selectActiveBranch(entries, leafId) {
    if (entries.length === 0)
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
function projectTurns(entries, afterPosition) {
    const starts = entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => {
        const message = entry.value.message;
        return entry.value.type === "message" && isRecord(message) && message.role === "user";
    });
    return starts.flatMap(({ entry, index }, turnIndex) => {
        const message = entry.value.message;
        if (!isRecord(message))
            throw new Error(`Invalid user message entry: ${String(entry.value.id)}`);
        const nextStart = starts[turnIndex + 1]?.index ?? entries.length;
        const turnEntries = entries.slice(index, nextStart);
        if (!turnEntries.some((candidate) => candidate.position > afterPosition))
            return [];
        return [{
                id: String(entry.value.id),
                user: {
                    id: String(entry.value.id),
                    timestamp: String(entry.value.timestamp),
                    text: extractUserText(message.content, String(entry.value.id)),
                },
                activity: projectActivity(turnEntries, afterPosition)
                    .sort((left, right) => left.order - right.order)
                    .map((item) => item.activity),
            }];
    });
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