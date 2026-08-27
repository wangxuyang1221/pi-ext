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
export declare function encodeActivityCursor(value: Omit<ActivityCursor, "kind" | "version">): string;
export declare function decodeActivityCursor(cursor: string, expected: ActivityCursorBinding): ActivityCursor;
export declare function encodeSettledCursor(value: Omit<SettledCursor, "kind" | "version">): string;
export declare function decodeSettledCursor(cursor: string, expected: SettledCursorBinding): SettledCursor;
export type CursorErrorCode = "invalid_cursor" | "cursor_mismatch" | "epoch_mismatch";
export declare class CursorError extends Error {
    readonly code: CursorErrorCode;
    constructor(code: CursorErrorCode, message: string);
}
//# sourceMappingURL=cursor.d.ts.map