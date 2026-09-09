import { type DeliveryReceipt } from "./delivery-receipt.js";
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
    leafPosition?: number;
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
    consumePrompt(text: string): Promise<DeliveryReceipt | undefined>;
    agentSettled(): Promise<void>;
    leafChanged(leafId: string | null, pinned?: boolean, leafPosition?: number): Promise<void>;
    shutdown(): Promise<void>;
    private updateActive;
}
//# sourceMappingURL=runtime-host.d.ts.map