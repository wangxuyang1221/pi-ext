import { type ReadSessionViewOptions, type SessionActivity, type SessionViewResult } from "./session-reader.js";
import type { SessionState, TmuxLocator } from "./state-store.js";
import { SessionStateStore } from "./state-store.js";
import type { PromptDelivery, TmuxLaunchOptions } from "./tmux-runtime.js";
import { type WaitForSettledResult } from "./wait.js";
export declare const PI_SUBAGENT_MAX_ACTIVE = "PI_SUBAGENT_MAX_ACTIVE";
export declare const PI_SUBAGENT_STATE_ROOT = "PI_SUBAGENT_STATE_ROOT";
export declare const PI_SUBAGENT_PARENT = "PI_SUBAGENT_PARENT";
export declare const PI_SUBAGENT_LAUNCH = "PI_SUBAGENT_LAUNCH";
export interface ManagedTmuxRuntime {
    launch(options: TmuxLaunchOptions): Promise<TmuxLocator>;
    sendPrompt(locator: TmuxLocator, text: string, delivery: PromptDelivery): Promise<void>;
    isAlive(locator: TmuxLocator): Promise<boolean>;
    close(locator: TmuxLocator): Promise<void>;
}
export interface SubagentManagerOptions {
    store: SessionStateStore;
    runtime: ManagedTmuxRuntime;
    stateRoot: string;
    nativeSessionRoot: string;
    extensionPath: string;
    piPath: string;
    environment: Record<string, string>;
    createId?: () => string;
    now?: () => string;
    sleep?: (milliseconds: number) => Promise<void>;
    registrationTimeoutMs?: number;
    pollIntervalMs?: number;
    closeTimeoutMs?: number;
    maxActive?: number;
    reservationTtlMs?: number;
    nowMs?: () => number;
}
export interface SpawnSubagentOptions {
    task: string;
    name?: string;
    cwd?: string;
    model?: string;
    thinkingLevel?: string;
}
export interface SpawnDefaults {
    cwd: string;
    model?: string;
    thinkingLevel?: string;
}
export interface ManagedAgent {
    agentId: string;
    name: string;
    status: SessionState["runtime"]["status"];
    generation: number;
    settledGeneration: number;
    settledCursor: string;
    model?: string;
    thinkingLevel?: string;
    tmux?: TmuxLocator;
    sessionFile: string;
}
export interface SubagentCapacity {
    active: number;
    pending: number;
    limit: number;
    available: number;
}
export interface ManagedAgentList {
    agents: ManagedAgent[];
    capacity: SubagentCapacity;
}
export interface WaitManagedOptions {
    afterSettled: string;
    timeoutMs: number;
    afterActivity?: string;
    assistantLimit?: number;
    toolLimit?: number;
}
export interface ManagedWaitResult extends WaitForSettledResult {
    agent: ManagedAgent;
    activity: SessionActivity[];
    activityCursor?: string;
    assistantCount: number;
    toolCount: number;
    omittedAssistant: number;
    omittedTools: number;
    hasMore: boolean;
    returnedBytes: number;
}
export declare class SubagentManager {
    private readonly store;
    private readonly runtime;
    private readonly stateRoot;
    private readonly nativeSessionRoot;
    private readonly extensionPath;
    private readonly piPath;
    private readonly environment;
    private readonly createId;
    private readonly now;
    private readonly sleep;
    private readonly registrationTimeoutMs;
    private readonly pollIntervalMs;
    private readonly closeTimeoutMs;
    private readonly maxActive;
    private readonly reservationTtlMs;
    private readonly nowMs;
    private readonly inFlightSpawns;
    private readonly closingNamespaces;
    constructor(options: SubagentManagerOptions);
    spawn(parentSessionId: string, options: SpawnSubagentOptions, defaults: SpawnDefaults): Promise<ManagedAgent>;
    private spawnInternal;
    close(parentSessionId: string, target: string): Promise<ManagedAgent[]>;
    private closeAll;
    private closeReservations;
    private closeDirect;
    wait(parentSessionId: string, agentId: string, options: WaitManagedOptions, signal?: AbortSignal): Promise<ManagedWaitResult>;
    read(parentSessionId: string, agentId: string, options: Omit<ReadSessionViewOptions, "sessionFile" | "agentId" | "epoch" | "leafId">): Promise<SessionViewResult>;
    list(parentSessionId: string): Promise<ManagedAgentList>;
    prompt(parentSessionId: string, agentId: string, text: string, delivery: PromptDelivery): Promise<ManagedAgent>;
    private reserveSpawn;
    private reapExpiredReservations;
    private attachReservationLocator;
    private activeProcessIds;
    private confirmClosed;
    private requireDirectSession;
    private reconcileOwnedSessions;
    private markInterrupted;
    private assertRootNamespace;
    private assertManagedLeaf;
    private assertDirectOwnership;
    private requireSession;
    private waitForRegistration;
}
//# sourceMappingURL=manager.d.ts.map