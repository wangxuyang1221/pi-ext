export declare const SESSION_STATE_SCHEMA_VERSION = 3;
export type RuntimeStatus = "starting" | "running" | "settled" | "closing" | "closed" | "interrupted" | "errored";
export interface TmuxLocator {
    sessionName: string;
    windowId: string;
    paneId: string;
    panePid?: number;
    windowName?: string;
    serverPid?: number;
    serverStartedAt?: string;
    socketPath?: string;
    processInstanceId?: string;
}
export interface ParentOwnership {
    sessionId: string;
    epoch: string;
    registrationToken: string;
}
export interface LaunchConfiguration {
    protocolVersion: number;
    agentDir: string;
    tmuxPath: string;
    piPath: string;
}
export interface LaunchMetadata {
    configuration?: LaunchConfiguration;
    cwd: string;
    sessionDir: string;
    model?: string;
    thinkingLevel?: string;
    displayName: string;
    processInstanceId: string;
}
export interface SpawnReservation {
    reservationId: string;
    processInstanceId: string;
    createdAt: string;
    expiresAt: string;
    launchState?: "reserved" | "launching";
    tmux?: TmuxLocator;
}
export interface ChildLink {
    agentId: string;
    epoch: string;
    name: string;
    cwd: string;
    sessionFile: string;
    launch: LaunchMetadata;
    createdAt: string;
    updatedAt: string;
}
export interface SessionRuntimeState {
    configuration?: LaunchConfiguration;
    status: RuntimeStatus;
    busy: boolean;
    generation: number;
    settledGeneration: number;
    settledEntryId?: string;
    leafId?: string;
    leafPinned?: boolean;
    leafPosition?: number;
    cwd: string;
    sessionFile: string;
    pid?: number;
    processInstanceId?: string;
    tmux?: TmuxLocator;
    updatedAt: string;
}
export interface SessionState {
    schemaVersion: typeof SESSION_STATE_SCHEMA_VERSION;
    sessionId: string;
    epoch: string;
    parent?: ParentOwnership;
    launch?: LaunchMetadata;
    runtime: SessionRuntimeState;
    children: ChildLink[];
    reservations: SpawnReservation[];
    processes?: Record<string, {
        registrationToken: string;
        tmux?: TmuxLocator;
        phase: "active" | "closing";
    }>;
    control?: {
        children: Record<string, {
            epoch: string;
            status: "closing" | "interrupted";
            updatedAt: string;
        }>;
        tombstones: Record<string, string>;
        retiredProcesses?: Record<string, true>;
        closingAll?: boolean;
        controllerEpoch?: string;
    };
}
export interface CreateSessionStateOptions {
    sessionId: string;
    epoch: string;
    cwd: string;
    sessionFile: string;
    now: string;
    parent?: ParentOwnership;
    launch?: LaunchMetadata;
    pid?: number;
    processInstanceId?: string;
    tmux?: TmuxLocator;
}
export declare function createSessionState(options: CreateSessionStateOptions): SessionState;
export declare class SessionStateStore {
    readonly root: string;
    private readonly updateQueues;
    private readonly controllers;
    authorizeController(sessionId: string, assertOwned: () => Promise<void>): void;
    rollbackControllerAuthorization(sessionId: string, assertOwned: () => Promise<void>): void;
    constructor(root: string);
    recordDelivery(parent: SessionState, child: SessionState, deliveryId: string, delivery: string): Promise<void>;
    statePath(sessionId: string): string;
    load(sessionId: string, parentSnapshot?: SessionState): Promise<SessionState | undefined>;
    /** Raw lifecycle facts; control intent must never be copied into a child snapshot. */
    loadRuntime(sessionId: string): Promise<SessionState | undefined>;
    /** Enumerates only bindings of processes authorized by this namespace. */
    listOwned(parent: SessionState, diagnostics?: Array<{
        agentId: string;
        reason: string;
    }>): Promise<SessionState[]>;
    private bindingDirectory;
    list(): Promise<SessionState[]>;
    /** Diagnostic scan only; namespace operations use listOwned instead. */
    scan(): Promise<{
        states: SessionState[];
        diagnostics: Array<{
            path: string;
            reason: string;
        }>;
    }>;
    delete(sessionId: string): Promise<void>;
    update(sessionId: string, updater: (state: SessionState) => SessionState | Promise<SessionState>): Promise<SessionState>;
    mutate(sessionId: string, updater: (state: SessionState | undefined) => SessionState | Promise<SessionState>): Promise<SessionState>;
    save(state: SessionState): Promise<void>;
    private writeState;
}
export declare function parseSessionState(value: unknown, expectedSessionId: string): SessionState;
//# sourceMappingURL=state-store.d.ts.map