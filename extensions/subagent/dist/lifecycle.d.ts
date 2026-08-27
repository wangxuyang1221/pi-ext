import type { SessionState } from "./state-store.js";
export declare function markAgentStarted(state: SessionState, now: string): SessionState;
export declare function markRuntimeStopped(state: SessionState, status: "closed" | "interrupted" | "errored", now: string): SessionState;
export declare function markAgentSettled(state: SessionState, now: string, settledEntryId?: string): SessionState;
//# sourceMappingURL=lifecycle.d.ts.map