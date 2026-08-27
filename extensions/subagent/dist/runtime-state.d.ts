import { type LaunchMetadata, type ParentOwnership, type SessionState, type TmuxLocator } from "./state-store.js";
export interface ActivateSessionOptions {
    sessionId: string;
    cwd: string;
    sessionFile: string;
    now: string;
    parent?: ParentOwnership;
    launch?: LaunchMetadata;
    pid?: number;
    processInstanceId?: string;
    tmux?: TmuxLocator;
    createEpoch: () => string;
}
export declare function activateSession(existing: SessionState | undefined, options: ActivateSessionOptions): SessionState;
//# sourceMappingURL=runtime-state.d.ts.map