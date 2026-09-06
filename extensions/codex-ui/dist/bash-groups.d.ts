import { type BashToolDetails, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { BashRefreshScheduler } from "./bash-refresh-scheduler.js";
import type { RenderCacheScope, ToolRenderCache } from "./render-cache.js";
type ToolRenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
export type BashStatus = "pending" | "running" | "completed" | "failed";
export interface BashMember {
    id: string;
    cache: RenderCacheScope;
    group: BashGroup;
    command: string;
    commandRevision: number;
    outputRevision: number;
    status: BashStatus;
    content?: Array<{
        type: string;
        text?: string;
    }>;
    details?: BashToolDetails;
    startedAt?: number;
    endedAt?: number;
    component?: Component;
    invalidate?: () => void;
}
export interface BashGroup {
    timerKey: string;
    members: BashMember[];
    counts: Record<BashStatus, number>;
    running: Set<BashMember>;
}
export interface BashGroupRowState {
    bashMember?: BashMember;
}
interface SourceMessage {
    role: string;
    content?: unknown;
}
/** Session-local ownership. Only bound full-mode rows may hide behind another row. */
export declare class BashGroups {
    private readonly cache;
    private readonly scheduler;
    private readonly members;
    private readonly candidates;
    private readonly membership;
    private activeCandidates;
    private notifying;
    private nextGroup;
    constructor(cache: ToolRenderCache, scheduler: BashRefreshScheduler);
    reset(ctx?: ExtensionContext, preserveBound?: boolean): void;
    discover(message: SourceMessage, start?: boolean): void;
    bind(context: ToolRenderContext & {
        state: BashGroupRowState;
    }): BashMember;
    updateCall(member: BashMember, context: ToolRenderContext, component: Component): void;
    updateResult(member: BashMember, result: {
        content: BashMember["content"];
        details?: BashToolDetails;
    }): void;
    private reflow;
    private assign;
    private schedule;
    private changed;
    private notify;
}
export {};
//# sourceMappingURL=bash-groups.d.ts.map