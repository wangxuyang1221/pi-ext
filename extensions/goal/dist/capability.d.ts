import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
/** Shared execution boundary; inspecting saved goals does not require a provider. */
export declare function goalCapability(ctx: ExtensionContext, child?: boolean): {
    supported: boolean;
    reason?: string;
};
//# sourceMappingURL=capability.d.ts.map