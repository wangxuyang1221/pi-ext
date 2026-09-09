export type ActivityView = "recent_activity" | "turns";
export type ActivityDetailSection = "assistant_text" | "user_text" | "assistant_error" | "tool_arguments" | "tool_result";
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
export declare function encodeTurnsPageCursor(value: Omit<TurnsPageCursor, "kind" | "version">): string;
export declare function decodeTurnsPageCursor(cursor: string, expected: SettledCursorBinding): TurnsPageCursor;
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
export declare function encodeActivityCursor(value: Omit<ActivityCursor, "kind" | "version">): string;
export declare function decodeActivityCursor(cursor: string, expected: ActivityCursorBinding): ActivityCursor;
export declare function encodeDetailCursor(value: Omit<DetailCursor, "kind" | "version">): string;
export declare function decodeDetailCursor(cursor: string, expected: DetailCursorBinding): DetailCursor;
export declare function encodeSettledCursor(value: Omit<SettledCursor, "kind" | "version">): string;
export declare function decodeSettledCursor(cursor: string, expected: SettledCursorBinding): SettledCursor;
export type CursorErrorCode = "invalid_cursor" | "cursor_mismatch" | "epoch_mismatch";
export declare class CursorError extends Error {
    readonly code: CursorErrorCode;
    constructor(code: CursorErrorCode, message: string);
}
//# sourceMappingURL=cursor.d.ts.map