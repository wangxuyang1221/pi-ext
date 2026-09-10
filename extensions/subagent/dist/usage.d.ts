import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export declare const GOAL_TASK_EVENT = "pi-ext:goal:subagent-task";
export interface ChildUsage {
    sourceId: string;
    tokens: number;
    missing: boolean;
    lastReceipt?: string;
}
export declare function usageDirectory(stateRoot: string, processInstanceId: string): string;
/** Assignment contains only an opaque report ID, never root goal or provider credentials. */
export declare function assignUsage(directory: string, sourceId: string | undefined): Promise<void>;
export declare class ChildUsageReporter {
    readonly directory: string;
    private queue;
    private readonly seen;
    private readonly pending;
    constructor(directory: string);
    capture(): Promise<string | undefined>;
    remember(key: string): void;
    record(sourceId: string | undefined, key: string, usage: unknown): Promise<void>;
    drain(): Promise<void>;
}
/** Runs in managed children in every Pi mode without registering goal tools or loops. */
export declare function registerChildUsage(pi: ExtensionAPI, directory: string): void;
//# sourceMappingURL=usage.d.ts.map