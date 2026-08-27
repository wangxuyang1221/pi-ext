import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ManagedTmuxRuntime } from "./manager.js";
import { SessionStateStore, type TmuxLocator } from "./state-store.js";
type RuntimeWithPaneLookup = ManagedTmuxRuntime & {
    locatePane?: (paneId: string) => Promise<TmuxLocator>;
};
export interface SubagentExtensionOptions {
    env?: Record<string, string | undefined>;
    stateRoot?: string;
    nativeSessionRoot?: string;
    store?: SessionStateStore;
    runtime?: RuntimeWithPaneLookup;
    createId?: () => string;
    now?: () => string;
    extensionPath?: string;
    piPath?: string;
    tmuxPath?: string;
    tmuxSessionName?: string;
    maxActive?: number;
}
export default function subagentExtension(pi: ExtensionAPI, options?: SubagentExtensionOptions): void;
export {};
//# sourceMappingURL=index.d.ts.map