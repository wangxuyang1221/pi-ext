import { type ActivityView } from "./cursor.js";
export interface AssistantActivity {
    kind: "assistant";
    id: string;
    timestamp: string;
    text: string;
    stopReason: string;
}
export interface ToolActivity {
    kind: "tool";
    id: string;
    timestamp: string;
    toolName: string;
    arguments: Record<string, unknown>;
    result?: string;
    isError?: boolean;
    complete: boolean;
}
export type SessionActivity = AssistantActivity | ToolActivity;
export interface ReadSessionViewOptions {
    sessionFile: string;
    agentId: string;
    epoch: string;
    view: ActivityView;
    assistantLimit?: number;
    toolLimit?: number;
    limit?: number;
    after?: string;
    leafId?: string;
}
export interface RecentActivityViewResult {
    view: "recent_activity";
    activity: SessionActivity[];
    assistantCount: number;
    toolCount: number;
    warnings: string[];
    cursor: string;
    position: number;
}
export interface SessionTurn {
    id: string;
    user: {
        id: string;
        timestamp: string;
        text: string;
    };
    activity: SessionActivity[];
}
export interface TurnsViewResult {
    view: "turns";
    turns: SessionTurn[];
    warnings: string[];
    cursor: string;
    position: number;
}
export interface AllEntriesViewResult {
    view: "all_entries";
    entries: unknown[];
    warnings: string[];
    cursor: string;
    position: number;
}
export type SessionViewResult = RecentActivityViewResult | TurnsViewResult | AllEntriesViewResult;
export declare function readSessionView(options: ReadSessionViewOptions): Promise<SessionViewResult>;
//# sourceMappingURL=session-reader.d.ts.map