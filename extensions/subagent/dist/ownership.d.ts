import type { ChildLink, SessionState } from "./state-store.js";
export declare function registerDirectChild(parent: SessionState, child: SessionState, now: string): SessionState;
export declare function getDirectChild(parent: SessionState, agentId: string): ChildLink;
export declare function removeDirectChildren(parent: SessionState, agentIds: ReadonlySet<string>): SessionState;
//# sourceMappingURL=ownership.d.ts.map