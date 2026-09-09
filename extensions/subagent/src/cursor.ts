export type ActivityView = "recent_activity" | "turns";

export type ActivityDetailSection =
  | "assistant_text"
  | "user_text"
  | "assistant_error"
  | "tool_arguments"
  | "tool_result";

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

export interface TurnsPageCursor {
  kind: "turns_page";
  version: 1;
  agentId: string;
  epoch: string;
  leafId: string;
  position: number;
  afterPosition: number;
  limit: number;
  turnIndex: number;
  activityIndex: number;
}

export function encodeTurnsPageCursor(value: Omit<TurnsPageCursor, "kind" | "version">): string {
  return encodeCursor({ kind: "turns_page", version: 1, ...value });
}

export function decodeTurnsPageCursor(cursor: string, expected: SettledCursorBinding): TurnsPageCursor {
  const value = decodeCursor(cursor);
  if (value.kind !== "turns_page" || value.version !== 1
    || typeof value.agentId !== "string" || typeof value.epoch !== "string"
    || typeof value.leafId !== "string"
    || ![value.position, value.afterPosition, value.limit, value.turnIndex, value.activityIndex]
      .every((item) => Number.isSafeInteger(item) && (item as number) >= 0)) {
    throw new CursorError("invalid_cursor", "Invalid activity cursor");
  }
  if (value.epoch !== expected.epoch) {
    throw new CursorError("epoch_mismatch", "Cursor epoch does not match the managed subagent");
  }
  if (value.agentId !== expected.agentId) {
    throw new CursorError("cursor_mismatch", "Cursor does not match the requested agent and view");
  }
  return value as unknown as TurnsPageCursor;
}

export interface DetailCursor {
  kind: "detail";
  version: 1;
  agentId: string;
  epoch: string;
  activityId: string;
  section: ActivityDetailSection;
  bytePosition: number;
}

export interface DetailCursorBinding {
  agentId: string;
  epoch: string;
  activityId: string;
  section: ActivityDetailSection;
}

export interface SettledCursor {
  kind: "settled";
  version: 1;
  agentId: string;
  epoch: string;
  generation: number;
  deliveryId?: string;
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

export function encodeDetailCursor(
  value: Omit<DetailCursor, "kind" | "version">,
): string {
  return encodeCursor({ kind: "detail", version: 1, ...value });
}

export function decodeDetailCursor(
  cursor: string,
  expected: DetailCursorBinding,
): DetailCursor {
  const value = decodeCursor(cursor);
  if (
    value.kind !== "detail"
    || value.version !== 1
    || typeof value.agentId !== "string"
    || typeof value.epoch !== "string"
    || typeof value.activityId !== "string"
    || !isActivityDetailSection(value.section)
    || !Number.isSafeInteger(value.bytePosition)
    || (value.bytePosition as number) < 0
  ) {
    throw new CursorError("invalid_cursor", "Invalid detail cursor");
  }

  const decoded = value as unknown as DetailCursor;
  if (decoded.epoch !== expected.epoch) {
    throw new CursorError("epoch_mismatch", "Cursor epoch does not match the managed subagent");
  }
  if (
    decoded.agentId !== expected.agentId
    || decoded.activityId !== expected.activityId
    || decoded.section !== expected.section
  ) {
    throw new CursorError("cursor_mismatch", "Cursor does not match the requested activity detail");
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
    || !(value.deliveryId === undefined || (
      typeof value.deliveryId === "string" && /^[a-f0-9]{12}$/u.test(value.deliveryId)
    ))
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
  return value === "recent_activity" || value === "turns";
}

function isActivityDetailSection(value: unknown): value is ActivityDetailSection {
  return value === "assistant_text" || value === "assistant_error" || value === "user_text" || value === "tool_arguments" || value === "tool_result";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
