import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GoalRecord, UsageCheckpoint } from "./storage.js";
interface Access {
    snapshot(): GoalRecord | undefined;
    account(expected: GoalRecord, usage: UsageCheckpoint, ctx: ExtensionContext): Promise<void>;
    budget(ctx: ExtensionContext): void;
    error(error: unknown, ctx: ExtensionContext): void;
}
/** Pi input already excludes cache reads and output already contains reasoning. */
export declare function goalTokens(usage: unknown): number | undefined;
/** Attribute finalized responses to the goal bound before that request, not the latest goal. */
export declare function registerGoalAccounting(pi: ExtensionAPI, access: Access): {
    checkpoint: (ctx: ExtensionContext) => Promise<void>;
};
export {};
//# sourceMappingURL=accounting.d.ts.map