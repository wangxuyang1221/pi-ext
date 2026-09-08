import { type ExtensionContext, type ReadToolDetails, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { RenderCacheScope, ToolRenderCache } from "./render-cache.js";
type RenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
export interface ReadMember {
    id: string;
    cache: RenderCacheScope;
    group: ReadMember[];
    path: string;
    fullPath: string;
    offset?: number;
    limit?: number;
    status: "pending" | "running" | "completed" | "failed";
    content?: Array<{
        type: string;
        text?: string;
    }>;
    details?: ReadToolDetails;
    revision: number;
    hasImage?: boolean;
    component?: Component;
    invalidate?: () => void;
}
export interface ReadRowState {
    readMember?: ReadMember;
}
/** Discover adjacency from assistant source blocks; never infer it from result arrival. */
export declare class ReadGroups {
    private readonly cache;
    private readonly members;
    private readonly candidates;
    private readonly membership;
    private active;
    private notifying;
    constructor(cache: ToolRenderCache);
    reset(ctx?: ExtensionContext, preserveBound?: boolean): void;
    discover(message: {
        role: string;
        content?: unknown;
    }, start?: boolean): void;
    bind(context: RenderContext): ReadMember;
    updateCall(member: ReadMember, context: RenderContext, component: Component, path: string): void;
    updateResult(member: ReadMember, result: Pick<ReadMember, "content" | "details">, isPartial: boolean, isError: boolean): void;
    private reflow;
    private assign;
    private changed;
    private notify;
}
export {};
//# sourceMappingURL=read-groups.d.ts.map