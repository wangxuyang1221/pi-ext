import { SessionStateStore, type LaunchMetadata, type ParentOwnership, type TmuxLocator } from "./state-store.js";
export interface SessionRuntimeHostOptions {
    store: SessionStateStore;
    parent?: ParentOwnership;
    launch?: LaunchMetadata;
    createEpoch: () => string;
    now?: () => string;
}
export interface StartRuntimeSessionOptions {
    sessionId: string;
    cwd: string;
    sessionFile: string;
    leafId: string | null;
    pid?: number;
    tmux?: TmuxLocator;
}
export declare class SessionRuntimeHost {
    private readonly store;
    private readonly parent?;
    private readonly launch?;
    private readonly createEpoch;
    private readonly now;
    private activeSessionId?;
    constructor(options: SessionRuntimeHostOptions);
    getActiveSessionId(): string | undefined;
    startSession(options: StartRuntimeSessionOptions): Promise<void>;
    agentStarted(): Promise<void>;
    agentSettled(): Promise<void>;
    leafChanged(leafId: string | null): Promise<void>;
    shutdown(): Promise<void>;
    private updateActive;
}
//# sourceMappingURL=runtime-host.d.ts.map