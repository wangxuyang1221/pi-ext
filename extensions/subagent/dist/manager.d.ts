import { type ReadSessionViewOptions, type SessionActivity, type SessionViewResult } from "./session-reader.js";
import type { SessionState, TmuxLocator } from "./state-store.js";
import { SessionStateStore } from "./state-store.js";
import type { PromptDelivery, TmuxLaunchOptions, RuntimeObservation, RuntimeQueryOptions } from "./tmux-runtime.js";
import { type WaitForSettledResult } from "./wait.js";
export declare const PI_SUBAGENT_MAX_ACTIVE = "PI_SUBAGENT_MAX_ACTIVE";
export declare const PI_SUBAGENT_STATE_ROOT = "PI_SUBAGENT_STATE_ROOT";
export declare const PI_SUBAGENT_PARENT = "PI_SUBAGENT_PARENT";
export declare const PI_SUBAGENT_LAUNCH = "PI_SUBAGENT_LAUNCH";
export interface ManagedTmuxRuntime {
    launch(options: TmuxLaunchOptions): Promise<TmuxLocator>;
    sendPrompt(locator: TmuxLocator, text: string, delivery: PromptDelivery): Promise<void>;
    capturePane(locator: TmuxLocator): Promise<string>;
    isAlive(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<boolean>;
    observe?(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<RuntimeObservation>;
    close(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<void>;
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
    promptAckTimeoutMs?: number;
    closeTimeoutMs?: number;
    maxActive?: number;
    reservationTtlMs?: number;
    nowMs?: () => number;
    beforePrompt?: (parentSessionId: string, child: SessionState) => Promise<void>;
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
    diagnostics?: Array<{
        agentId: string;
        reason: string;
    }>;
}
export type PromptConfirmation = "session" | "steering_queue" | "follow_up_queue";
export interface ManagedPromptResult {
    agent: ManagedAgent;
    deliveryId: string;
    confirmation: PromptConfirmation;
}
export declare class DeliveryUnconfirmedError extends Error {
    readonly deliveryId: string;
    readonly code = "delivery_unconfirmed";
    constructor(deliveryId: string, cause?: unknown);
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
    private readonly promptAckTimeoutMs;
    private readonly closeTimeoutMs;
    private readonly maxActive;
    private readonly reservationTtlMs;
    private readonly nowMs;
    private readonly beforePrompt?;
    private readonly promptLocks;
    private readonly inFlightSpawns;
    private readonly closingNamespaces;
    private readonly controllers;
    private readonly controllerSignals;
    private readonly operations;
    private runOperation;
    claimNamespace(sessionId: string, required?: boolean): Promise<boolean>;
    controllerGuard(sessionId: string): Promise<() => Promise<void>>;
    releaseNamespace(sessionId: string): Promise<void>;
    constructor(options: SubagentManagerOptions);
    spawn(parentSessionId: string, options: SpawnSubagentOptions, defaults: SpawnDefaults, signal?: AbortSignal): Promise<ManagedAgent>;
    private spawnInternal;
    close(parentSessionId: string, target: string, signal?: AbortSignal): Promise<ManagedAgent[]>;
    private closeInternal;
    private closeAll;
    private closeReservations;
    private closeDirect;
    wait(parentSessionId: string, agentId: string, options: WaitManagedOptions, signal?: AbortSignal): Promise<ManagedWaitResult>;
    private waitInternal;
    read(parentSessionId: string, agentId: string, options: Omit<ReadSessionViewOptions, "sessionFile" | "agentId" | "epoch" | "leafId" | "leafPosition">, signal?: AbortSignal): Promise<SessionViewResult>;
    list(parentSessionId: string, signal?: AbortSignal): Promise<ManagedAgentList>;
    private listInternal;
    prompt(parentSessionId: string, agentId: string, text: string, delivery: PromptDelivery, signal?: AbortSignal): Promise<ManagedPromptResult>;
    private deliverPrompt;
    private withPromptLock;
    private readPromptBaseline;
    private waitForPromptConfirmation;
    private reserveSpawn;
    private reapExpiredReservations;
    private attachReservationLocator;
    private activeProcessIds;
    private retireProcesses;
    private observeRuntime;
    private confirmClosed;
    private requireDirectSession;
    private reconcileOwnedSessions;
    private markInterrupted;
    private recordControlStatus;
    private assertRootNamespace;
    private assertManagedLeaf;
    private assertDirectOwnership;
    private requireSession;
    private waitForRegistration;
}
//# sourceMappingURL=manager.d.ts.map