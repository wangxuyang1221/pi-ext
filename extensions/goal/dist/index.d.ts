import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GoalStore } from "./storage.js";
export declare const GOAL_MIRROR = "pi-ext-goal";
/** Register persistent goal controls and execution. The store is injectable for isolated tests. */
export declare function registerGoal(pi: ExtensionAPI, store: GoalStore, options?: {
    config?: unknown;
    configPath?: string;
    temporaryRoot?: string;
}): void;
export default function goalExtension(pi: ExtensionAPI): void;
//# sourceMappingURL=index.d.ts.map