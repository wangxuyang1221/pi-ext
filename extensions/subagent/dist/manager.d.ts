import { type ReadSessionViewOptions, type SessionActivity, type SessionViewResult } from "./session-reader.js";
import type { SessionState, TmuxLocator } from "./state-store.js";
import { SessionStateStore } from "./state-store.js";
import type { PromptDelivery, TmuxLaunchOptions } from "./tmux-runtime.js";
import { type WaitForSettledResult } from "./wait.js";
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
    constructor(options: SubagentManagerOptions);
    spawn(parentSessionId: string, options: SpawnSubagentOptions, defaults: SpawnDefaults): Promise<ManagedAgent>;
    close(parentSessionId: string, target: string): Promise<ManagedAgent[]>;
    forget(parentSessionId: string, target: string): Promise<ManagedAgent[]>;
    wait(parentSessionId: string, agentId: string, options: WaitManagedOptions, signal?: AbortSignal): Promise<ManagedWaitResult>;
    read(parentSessionId: string, agentId: string, options: Omit<ReadSessionViewOptions, "sessionFile" | "agentId" | "epoch" | "leafId">): Promise<SessionViewResult>;
    list(parentSessionId: string): Promise<ManagedAgent[]>;
    prompt(parentSessionId: string, agentId: string, text: string, delivery: PromptDelivery): Promise<ManagedAgent>;
    resume(parentSessionId: string, agentId: string): Promise<ManagedAgent>;
    private collectSubtree;
    private closeStates;
    private confirmClosed;
    private requireDirectSession;
    private reconcileOwnedSessions;
    private requireSession;
    private waitForRegistration;
}
//# sourceMappingURL=manager.d.ts.map