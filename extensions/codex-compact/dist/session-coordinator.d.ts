import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { effectiveInputForBranch, type FailedRequestDetails, type FailedRequestDiagnostics, type JsonObject, type NativeCompactionBypass, type NativeCompactionDetails, type ResponseItem } from "./native-compaction.js";
export type ModelSelectLike = {
    model: Model<any>;
    previousModel?: Model<any>;
};
export type RemoteCompactionReason = "manual" | "automatic" | "model-transition" | "context-recovery";
export type CheckpointFactory = (params: {
    ctx: ExtensionContext;
    model: Model<any>;
    input: ReturnType<typeof effectiveInputForBranch>;
    basePayload?: JsonObject;
    signal?: AbortSignal;
}) => Promise<{
    details: NativeCompactionDetails;
}>;
export type SessionCoordinatorDeps = {
    getBranch: (ctx: ExtensionContext) => SessionEntry[];
    getAllTools: () => Parameters<typeof effectiveInputForBranch>[0]["tools"];
    createCheckpoint: CheckpointFactory;
    appendCheckpoint: (details: NativeCompactionDetails) => void;
    appendCheckpointBypass: (bypass: NativeCompactionBypass) => void;
    appendFailedRequest?: (details: FailedRequestDetails) => void;
    onAutomaticCompactionFailure?: (ctx: ExtensionContext, error: unknown) => void;
    shouldAutoCompact?: (params: {
        ctx: ExtensionContext;
        model: Model<any>;
        input: ResponseItem[];
        reason?: "automatic" | "downshift";
    }) => boolean;
    runCompaction?: <T>(ctx: ExtensionContext, reason: RemoteCompactionReason, operation: () => Promise<T>) => Promise<T>;
};
export declare function createSessionCoordinator(deps: SessionCoordinatorDeps): {
    clear: () => void;
    recordFailedRequest: (ctx: ExtensionContext, requestInput: ResponseItem[] | undefined, diagnostics?: FailedRequestDiagnostics) => void;
    selectModel: (event: ModelSelectLike, ctx: ExtensionContext) => Promise<void>;
    recoverCurrentModel: (model: Model<any>, ctx: ExtensionContext, basePayload?: JsonObject, requestInput?: ResponseItem[], excludeLastAssistantError?: boolean, signal?: AbortSignal) => Promise<void>;
    prepareRequest: (model: Model<any>, ctx: ExtensionContext, requestInput: ResponseItem[] | undefined, basePayload?: JsonObject, skipAutomaticCompaction?: boolean) => Promise<ResponseItem[] | undefined>;
    prepareCompaction: (model: Model<any>, ctx: ExtensionContext, excludeLastAssistantError?: boolean, signal?: AbortSignal) => Promise<ResponseItem[]>;
};
//# sourceMappingURL=session-coordinator.d.ts.map