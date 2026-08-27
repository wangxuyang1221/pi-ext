export type ActivityView = "recent_activity" | "turns" | "all_entries";

export interface ActivityCursor {
  kind: "activity";
  version: 1;
  agentId: string;
  epoch: string;
  view: ActivityView;
  position: number;
}

export interface ActivityCursorBinding {
  agentId: string;
  epoch: string;
  view: ActivityView;
}

export interface SettledCursor {
  kind: "settled";
  version: 1;
  agentId: string;
  epoch: string;
  generation: number;
}

export interface SettledCursorBinding {
  agentId: string;
  epoch: string;
}

const CURSOR_PREFIX = "sa1.";

export function encodeActivityCursor(
  value: Omit<ActivityCursor, "kind" | "version">,
): string {
  return encodeCursor({ kind: "activity", version: 1, ...value });
}

export function decodeActivityCursor(
  cursor: string,
  expected: ActivityCursorBinding,
): ActivityCursor {
  const value = decodeCursor(cursor);
  if (
    value.kind !== "activity"
    || value.version !== 1
    || typeof value.agentId !== "string"
    || typeof value.epoch !== "string"
    || !isActivityView(value.view)
    || !Number.isSafeInteger(value.position)
    || (value.position as number) < 0
  ) {
    throw new CursorError("invalid_cursor", "Invalid activity cursor");
  }

  const decoded = value as unknown as ActivityCursor;
  if (decoded.epoch !== expected.epoch) {
    throw new CursorError("epoch_mismatch", "Cursor epoch does not match the managed subagent");
  }
  if (decoded.agentId !== expected.agentId || decoded.view !== expected.view) {
    throw new CursorError("cursor_mismatch", "Cursor does not match the requested agent and view");
  }
  return decoded;
}

export function encodeSettledCursor(
  value: Omit<SettledCursor, "kind" | "version">,
): string {
  return encodeCursor({ kind: "settled", version: 1, ...value });
}

export function decodeSettledCursor(
  cursor: string,
  expected: SettledCursorBinding,
): SettledCursor {
  const value = decodeCursor(cursor);
  if (
    value.kind !== "settled"
    || value.version !== 1
    || typeof value.agentId !== "string"
    || typeof value.epoch !== "string"
    || !Number.isSafeInteger(value.generation)
    || (value.generation as number) < 0
  ) {
    throw new CursorError("invalid_cursor", "Invalid settled cursor");
  }

  const decoded = value as unknown as SettledCursor;
  if (decoded.epoch !== expected.epoch) {
    throw new CursorError("epoch_mismatch", "Cursor epoch does not match the managed subagent");
  }
  if (decoded.agentId !== expected.agentId) {
    throw new CursorError("cursor_mismatch", "Cursor does not match the requested agent");
  }
  return decoded;
}

export type CursorErrorCode = "invalid_cursor" | "cursor_mismatch" | "epoch_mismatch";

export class CursorError extends Error {
  readonly code: CursorErrorCode;

  constructor(code: CursorErrorCode, message: string) {
    super(message);
    this.name = "CursorError";
    this.code = code;
  }
}

function encodeCursor(value: object): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string): Record<string, unknown> {
  if (!cursor.startsWith(CURSOR_PREFIX)) {
    throw new CursorError("invalid_cursor", "Invalid cursor prefix");
  }

  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"),
    );
    if (!isRecord(value)) throw new Error("Cursor payload is not an object");
    return value;
  } catch (error) {
    if (error instanceof CursorError) throw error;
    throw new CursorError("invalid_cursor", "Invalid cursor payload");
  }
}

function isActivityView(value: unknown): value is ActivityView {
  return value === "recent_activity" || value === "turns" || value === "all_entries";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
