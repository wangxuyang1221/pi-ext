import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
export type SubagentToolKind = "spawn" | "prompt" | "list" | "read" | "wait" | "close";
export type SubagentStatus = "starting" | "running" | "settled" | "closing" | "closed" | "interrupted" | "errored";
export interface AgentDisplay {
    agentId: string;
    name: string;
    status: SubagentStatus;
    generation: number;
    model?: string;
    thinkingLevel?: string;
    tmuxWindow?: string;
    sessionFile?: string;
}
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
    summary: string;
    result: string;
    isError?: boolean;
}
export type ActivityDisplay = AssistantActivity | ToolActivity;
export interface SubagentUiDetails {
    operation: SubagentToolKind;
    ok: boolean;
    agent?: AgentDisplay;
    agents?: AgentDisplay[];
    affected?: AgentDisplay[];
    task?: string;
    prompt?: string;
    delivery?: "steer" | "follow_up";
    view?: "recent_activity" | "turns" | "all_entries";
    assistantCount?: number;
    toolCount?: number;
    cursor?: string;
    settledCursor?: string;
    outcome?: "settled" | "interrupted" | "closed" | "timeout";
    durationMs?: number;
    activity?: ActivityDisplay[];
    capacity?: {
        active: number;
        pending: number;
        limit: number;
        available: number;
    };
    relationshipRemoved?: boolean;
    extensionDataRemoved?: boolean;
    piSessionRetained?: boolean;
    message?: string;
}
interface RendererContext {
    state: unknown;
    lastComponent: Component | undefined;
    isPartial: boolean;
    isError: boolean;
}
type ToolArgs = Record<string, unknown>;
export declare function renderSubagentCall(kind: SubagentToolKind, args: ToolArgs, theme: Theme, context: RendererContext): Component;
export declare function renderSubagentResult(kind: SubagentToolKind, args: ToolArgs, result: AgentToolResult<SubagentUiDetails>, options: ToolRenderResultOptions, theme: Theme, context: RendererContext): Component;
export {};
//# sourceMappingURL=renderers.d.ts.map