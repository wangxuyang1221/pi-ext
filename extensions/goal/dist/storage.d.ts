import { type ContentReference } from "./content.js";
import { WriterLock } from "./lock.js";
export interface GoalDisplayTiming {
    elapsedSeconds: number;
    nextUpdateMs?: number;
}
export interface UsageCheckpoint {
    sourceId: string;
    tokens: number;
    missing: boolean;
    lastReceipt?: string;
}
export interface ChildUsageCheckpoint extends UsageCheckpoint {
    reportPath: string;
}
export interface Goal {
    goalId: string;
    generation: number;
    activation?: number;
    objective: string;
    content?: ContentReference;
    status: "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";
    pauseReason?: "repeated_tool_calls";
    tokenBudget?: number;
    tokensUsed: number;
    elapsedSeconds: number;
    usageCheckpoint?: UsageCheckpoint;
    childUsage?: ChildUsageCheckpoint[];
    usageIncomplete?: boolean;
    toolRecoveryRequired?: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface Owner {
    ownerSessionId: string;
    cwd: string;
    sessionFile: string;
}
export interface GoalRecord extends Owner {
    schemaVersion: 1;
    recordId: string;
    revision: number;
    generation: number;
    goal: Goal | null;
    continuationDeferral: boolean;
    recoveredFrom: string | null;
}
export declare class GoalStore {
    readonly root: string;
    readonly now: () => number;
    /** Fault injection point after file sync, before authoritative replacement. */
    beforeRename?: () => void;
    constructor(root: string, now?: () => number);
    read(recordId: string): Promise<GoalRecord | undefined>;
    private catalog;
    records(): Promise<GoalRecord[]>;
    recoverable(cwd: string): Promise<GoalRecord[]>;
    openSession(owner: Owner, assertCurrent?: () => void): Promise<GoalLease>;
    takeover(expected: GoalRecord, owner: Owner): Promise<GoalLease>;
    commit(record: GoalRecord, assertCurrent?: () => void): Promise<void>;
}
export declare class GoalLease {
    private readonly store;
    private current;
    private readonly lock;
    private readonly assertCurrent?;
    private queue;
    private tick;
    private budgetInFlight;
    private displayAt;
    constructor(store: GoalStore, current: GoalRecord, lock: WriterLock, assertCurrent?: (() => void) | undefined);
    /** Display-only observer; exceptions cannot change an authoritative mutation's outcome. */
    onDisplayChange?: () => void;
    private notifyDisplay;
    /** Keep timing the already-running budget wrap-up, never an idle limited goal. */
    setBudgetInFlight(value: boolean): void;
    get snapshot(): GoalRecord;
    /** Read-only display projection using the same clock and accounting baseline. */
    get displayTiming(): GoalDisplayTiming | undefined;
    private mutate;
    /** Drain queued writes, verify authority, and commit whole active seconds if needed. */
    checkpoint(expected: GoalRecord): Promise<GoalRecord>;
    /** Copy a checkpoint into a never-committed record, with a durable launch gate. */
    inherit(source: GoalRecord): Promise<GoalRecord>;
    /** Stop new goal continuations without changing request attribution or status. */
    requireToolRecovery(expected: GoalRecord): Promise<GoalRecord>;
    /** Release inheritance gating, without changing the goal's stop state. */
    releaseDeferral(expected: GoalRecord): Promise<GoalRecord>;
    replace(objective: string, expected: GoalRecord, tokenBudget?: number, content?: ContentReference): Promise<GoalRecord>;
    /** Commit a source's cumulative usage and its deduplication checkpoint atomically. */
    account(expected: GoalRecord, usage: UsageCheckpoint): Promise<GoalRecord>;
    /** Register a report before delivering the managed task. */
    subscribeChild(expected: GoalRecord, source: ChildUsageCheckpoint): Promise<GoalRecord>;
    /** Child reports never replace the main response checkpoint. */
    accountChild(expected: GoalRecord, usage: UsageCheckpoint): Promise<GoalRecord>;
    /** Persist the diagnostic with the pause, never overwriting a terminal state. */
    pauseForLoop(expected: GoalRecord): Promise<GoalRecord>;
    /** Resume and release continuation gates in the same authoritative commit. */
    control(action: "resume" | "pause" | "edit" | "complete" | "blocked" | "usage_limited", expected: GoalRecord, objective?: string, content?: ContentReference): Promise<GoalRecord>;
    clear(expected: GoalRecord): Promise<GoalRecord>;
    close(): Promise<void>;
}
//# sourceMappingURL=storage.d.ts.map