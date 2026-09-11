import { type HistoryIdentity } from "./history.js";
export declare const MAX_HANDOFF_BYTES: number;
export declare const HANDOFF_TTL_MS = 60000;
/** Bridges display metadata across extension instances in one CLI process. */
export declare class HistoryHandoff {
    readonly path: string;
    private readonly directory;
    constructor(agentDir: string, bootId?: string);
    consume(): HistoryIdentity[];
    publish(identities: readonly HistoryIdentity[]): void;
    clear(): void;
    private prune;
    private checkDirectory;
}
//# sourceMappingURL=history-handoff.d.ts.map