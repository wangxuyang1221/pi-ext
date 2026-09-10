import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChildUsageCheckpoint, GoalRecord, UsageCheckpoint } from "./storage.js";
interface Access {
    snapshot(): GoalRecord | undefined;
    subscribe(expected: GoalRecord, source: ChildUsageCheckpoint, ctx: ExtensionContext): Promise<void>;
    account(expected: GoalRecord, usage: UsageCheckpoint, ctx: ExtensionContext): Promise<void>;
    budget(ctx: ExtensionContext): void;
    error(error: unknown, ctx: ExtensionContext): void;
    busy(): boolean;
}
/** Only explicitly subscribed files are read; observations never manufacture tool usage. */
export declare function registerChildAccounting(pi: ExtensionAPI, access: Access): {
    start(ctx: ExtensionContext): Promise<void>;
    stop(ctx: ExtensionContext): Promise<void>;
    checkpoint: (caller: ExtensionContext) => Promise<void>;
    refresh: () => void;
};
export {};
//# sourceMappingURL=children.d.ts.map