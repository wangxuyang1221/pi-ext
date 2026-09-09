export function encodeTurnsPageCursor(value) {
    return encodeCursor({ kind: "turns_page", version: 1, ...value });
}
export function decodeTurnsPageCursor(cursor, expected) {
    const value = decodeCursor(cursor);
    if (value.kind !== "turns_page" || value.version !== 1
        || typeof value.agentId !== "string" || typeof value.epoch !== "string"
        || typeof value.leafId !== "string"
        || ![value.position, value.afterPosition, value.limit, value.turnIndex, value.activityIndex]
            .every((item) => Number.isSafeInteger(item) && item >= 0)) {
        throw new CursorError("invalid_cursor", "Invalid activity cursor");
    }
    if (value.epoch !== expected.epoch) {
        throw new CursorError("epoch_mismatch", "Cursor epoch does not match the managed subagent");
    }
    if (value.agentId !== expected.agentId) {
        throw new CursorError("cursor_mismatch", "Cursor does not match the requested agent and view");
    }
    return value;
}
const CURSOR_PREFIX = "sa1.";
export function encodeActivityCursor(value) {
    return encodeCursor({ kind: "activity", version: 1, ...value });
}
export function decodeActivityCursor(cursor, expected) {
    const value = decodeCursor(cursor);
    if (value.kind !== "activity"
        || value.version !== 1
        || typeof value.agentId !== "string"
        || typeof value.epoch !== "string"
        || !isActivityView(value.view)
        || !Number.isSafeInteger(value.position)
        || value.position < 0) {
        throw new CursorError("invalid_cursor", "Invalid activity cursor");
    }
    const decoded = value;
    if (decoded.epoch !== expected.epoch) {
        throw new CursorError("epoch_mismatch", "Cursor epoch does not match the managed subagent");
    }
    if (decoded.agentId !== expected.agentId || decoded.view !== expected.view) {
        throw new CursorError("cursor_mismatch", "Cursor does not match the requested agent and view");
    }
    return decoded;
}
export function encodeDetailCursor(value) {
    return encodeCursor({ kind: "detail", version: 1, ...value });
}
export function decodeDetailCursor(cursor, expected) {
    const value = decodeCursor(cursor);
    if (value.kind !== "detail"
        || value.version !== 1
        || typeof value.agentId !== "string"
        || typeof value.epoch !== "string"
        || typeof value.activityId !== "string"
        || !isActivityDetailSection(value.section)
        || !Number.isSafeInteger(value.bytePosition)
        || value.bytePosition < 0) {
        throw new CursorError("invalid_cursor", "Invalid detail cursor");
    }
    const decoded = value;
    if (decoded.epoch !== expected.epoch) {
        throw new CursorError("epoch_mismatch", "Cursor epoch does not match the managed subagent");
    }
    if (decoded.agentId !== expected.agentId
        || decoded.activityId !== expected.activityId
        || decoded.section !== expected.section) {
        throw new CursorError("cursor_mismatch", "Cursor does not match the requested activity detail");
    }
    return decoded;
}
export function encodeSettledCursor(value) {
    return encodeCursor({ kind: "settled", version: 1, ...value });
}
export function decodeSettledCursor(cursor, expected) {
    const value = decodeCursor(cursor);
    if (value.kind !== "settled"
        || value.version !== 1
        || typeof value.agentId !== "string"
        || typeof value.epoch !== "string"
        || !Number.isSafeInteger(value.generation)
        || value.generation < 0
        || !(value.deliveryId === undefined || (typeof value.deliveryId === "string" && /^[a-f0-9]{12}$/u.test(value.deliveryId)))) {
        throw new CursorError("invalid_cursor", "Invalid settled cursor");
    }
    const decoded = value;
    if (decoded.epoch !== expected.epoch) {
        throw new CursorError("epoch_mismatch", "Cursor epoch does not match the managed subagent");
    }
    if (decoded.agentId !== expected.agentId) {
        throw new CursorError("cursor_mismatch", "Cursor does not match the requested agent");
    }
    return decoded;
}
export class CursorError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "CursorError";
        this.code = code;
    }
}
function encodeCursor(value) {
    return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}
function decodeCursor(cursor) {
    if (!cursor.startsWith(CURSOR_PREFIX)) {
        throw new CursorError("invalid_cursor", "Invalid cursor prefix");
    }
    try {
        const value = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
        if (!isRecord(value))
            throw new Error("Cursor payload is not an object");
        return value;
    }
    catch (error) {
        if (error instanceof CursorError)
            throw error;
        throw new CursorError("invalid_cursor", "Invalid cursor payload");
    }
}
function isActivityView(value) {
    return value === "recent_activity" || value === "turns";
}
function isActivityDetailSection(value) {
    return value === "assistant_text" || value === "assistant_error" || value === "user_text" || value === "tool_arguments" || value === "tool_result";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=cursor.js.map