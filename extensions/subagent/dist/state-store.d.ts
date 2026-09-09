export declare const SESSION_STATE_SCHEMA_VERSION = 2;
export type RuntimeStatus = "starting" | "running" | "settled" | "closing" | "closed" | "interrupted" | "errored";
export interface TmuxLocator {
    sessionName: string;
    windowId: string;
    paneId: string;
    panePid?: number;
    windowName?: string;
}
export interface ParentOwnership {
    sessionId: string;
    epoch: string;
    registrationToken: string;
}
export interface LaunchMetadata {
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
    constructor(root: string);
    statePath(sessionId: string): string;
    load(sessionId: string): Promise<SessionState | undefined>;
    list(): Promise<SessionState[]>;
    delete(sessionId: string): Promise<void>;
    update(sessionId: string, updater: (state: SessionState) => SessionState | Promise<SessionState>): Promise<SessionState>;
    save(state: SessionState): Promise<void>;
}
//# sourceMappingURL=state-store.d.ts.map