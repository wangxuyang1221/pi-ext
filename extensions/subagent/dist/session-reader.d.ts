import { type ActivityDetailSection, type ActivityView } from "./cursor.js";
export type { ActivityDetailSection } from "./cursor.js";
export interface ActivityDetailRef {
    activityId: string;
    sections: ActivityDetailSection[];
}
export interface AssistantActivity {
    kind: "assistant";
    id: string;
    timestamp: string;
    text: string;
    stopReason: string;
    truncated: boolean;
    detailRef?: ActivityDetailRef;
}
export interface ToolActivity {
    kind: "tool";
    id: string;
    timestamp: string;
    toolName: string;
    outcome: "pending" | "succeeded" | "failed";
    detailRef: ActivityDetailRef;
    errorPreview?: string;
}
export type SessionActivity = AssistantActivity | ToolActivity;
export interface ReadSessionViewOptions {
    sessionFile: string;
    agentId: string;
    epoch: string;
    view: ActivityView | "activity_detail";
    assistantLimit?: number;
    toolLimit?: number;
    limit?: number;
    after?: string;
    activityId?: string;
    section?: ActivityDetailSection;
    detailCursor?: string;
    leafId?: string;
    maximumBytes?: number;
}
export interface RecentActivityViewResult {
    view: "recent_activity";
    activity: SessionActivity[];
    assistantCount: number;
    toolCount: number;
    omittedAssistant: number;
    omittedTools: number;
    hasMore: boolean;
    returnedBytes: number;
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
export interface ActivityDetailViewResult {
    view: "activity_detail";
    activityId: string;
    section: ActivityDetailSection;
    content: string;
    originalBytes: number;
    returnedBytes: number;
    truncated: boolean;
    hasMore: boolean;
    nextDetailCursor?: string;
}
export type SessionViewResult = RecentActivityViewResult | TurnsViewResult | ActivityDetailViewResult;
export declare function readSessionView(options: ReadSessionViewOptions): Promise<SessionViewResult>;
//# sourceMappingURL=session-reader.d.ts.map