import { type SessionEntry, type ToolInfo } from "@earendil-works/pi-coding-agent";
import { type Model, type Usage } from "@earendil-works/pi-ai";
export declare const NATIVE_COMPACTION_KIND = "openai-codex-native-compaction";
export declare const NATIVE_COMPACTION_BYPASS_KIND = "openai-codex-native-compaction-bypass";
export declare const FAILED_REQUEST_KIND = "openai-codex-failed-request";
export declare const NATIVE_COMPACTION_VERSION = 2;
export declare const NATIVE_COMPACTION_BYPASS_VERSION = 1;
export declare const REMOTE_COMPACTION_FEATURE = "remote_compaction_v2";
export declare function isFailClosedCompactionError(message: string): boolean;
export declare function isContextWindowCompactionError(error: unknown): boolean;
export type JsonObject = Record<string, unknown>;
export type ResponseItem = JsonObject & {
    type?: string;
};
export type FailedRequestDiagnostics = {
    phase: "before_provider_request";
    code: string;
    recoveryAttempted: boolean;
};
export type FailedRequestDetails = {
    kind: typeof FAILED_REQUEST_KIND;
    entryId: string;
    /** Legacy markers may contain this; new markers resolve it from the branch in memory. */
    content?: unknown;
    diagnostics?: FailedRequestDiagnostics;
};
export interface NativeCompactionDetails {
    kind: typeof NATIVE_COMPACTION_KIND;
    version: typeof NATIVE_COMPACTION_VERSION;
    modelKey: string;
    compHash?: string;
    preservedInput?: ResponseItem[];
    replacementHistory: ResponseItem[];
}
export type NativeCheckpoint = {
    entryIndex: number;
    entryId: string;
    details: NativeCompactionDetails;
};
export type NativeCompactionBypass = {
    kind: typeof NATIVE_COMPACTION_BYPASS_KIND;
    version: typeof NATIVE_COMPACTION_BYPASS_VERSION;
    gateEntryId: string;
    targetModelKey: string;
};
export type CheckpointLookup = {
    status: "none";
} | {
    status: "invalid";
    entryIndex: number;
    entryId: string;
} | {
    status: "bypassed";
    entryIndex: number;
    entryId: string;
    bypass: NativeCompactionBypass;
} | {
    status: "valid";
    checkpoint: NativeCheckpoint;
};
export declare function isJsonObject(value: unknown): value is JsonObject;
export declare function isOpenAICodexModel(model: unknown): model is Model<"openai-codex-responses">;
export declare function modelKey(model: Pick<Model<any>, "provider" | "api" | "id">): string;
export declare function parseNativeCompactionDetails(value: unknown): NativeCompactionDetails | undefined;
export declare function parseNativeCompactionBypass(value: unknown): NativeCompactionBypass | undefined;
export declare function findNativeCheckpoint(branch: SessionEntry[], targetModelKey?: string): CheckpointLookup;
/**
 * Finds the Codex body-after-prefix baseline for the active compaction window.
 * Server-observed assistant usage wins; a current native checkpoint provides the
 * estimate used before the first response in a new window.
 */
export declare function estimateCompactionWindowPrefillTokens(params: {
    branch: SessionEntry[];
    stablePrefixTokens: number;
    targetModelKey?: string;
}): number | undefined;
export declare function loadedToolNamesFromItems(items: ResponseItem[]): Set<string>;
export declare function fullInputForBranch(params: {
    branch: SessionEntry[];
    model: Model<any>;
    tools: ToolInfo[];
}): ResponseItem[];
export declare function piContextInputForBranch(params: {
    branch: SessionEntry[];
    model: Model<any>;
    tools: ToolInfo[];
}): ResponseItem[];
export declare function effectiveInputForBranch(params: {
    branch: SessionEntry[];
    model: Model<any>;
    tools: ToolInfo[];
    excludeLastAssistantError?: boolean;
    allowCheckpointModelMismatch?: boolean;
}): ResponseItem[];
export declare function approximateTokenCount(value: unknown): number;
export declare function approximateResponseItemTokens(items: ResponseItem[]): number;
export declare function approximateCompactionRequestTokens(params: {
    input: ResponseItem[];
    instructions: string;
    tools?: unknown[];
}): number;
/** Codex rewrites the newest truncatable tool output before an oversized request. */
export declare function trimFunctionCallHistoryToFitContextWindow(items: ResponseItem[], maxTokens: number, reservedTokens?: number): ResponseItem[];
/** Mirrors current Codex V2's retained message whitelist and 64k newest-first budget. */
export declare function retainRecentMessages(items: ResponseItem[], maxTokens?: number): ResponseItem[];
export declare function buildReplacementHistory(preCompactionInput: ResponseItem[], compactionItem: ResponseItem): ResponseItem[];
export declare function buildToolPayload(allTools: ToolInfo[], activeToolNames: string[], supportsStrictMode?: boolean, excludedToolNames?: ReadonlySet<string>): unknown[] | undefined;
export declare function buildCompactionRequestBody(params: {
    basePayload?: JsonObject;
    model: Model<any>;
    input: ResponseItem[];
    instructions: string;
    tools?: unknown[];
    sessionId: string;
}): JsonObject;
export declare function mergeFeatureHeader(existing: string | null | undefined): string;
export declare function buildCodexHeaders(params: {
    apiKey: string;
    headers?: Record<string, string | null>;
    sessionId: string;
    turnState?: string;
}): Headers;
export declare function markFallbackEligibility(error: Error, eligible: boolean): Error & {
    retryWithCurrentModel: boolean;
};
export declare function compactionFailureClassification(error: unknown): string;
export declare function callRemoteCompaction(params: {
    url: string;
    headers: Headers;
    body: JsonObject;
    model: Model<any>;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    onTurnState?: (turnState: string) => void;
}): Promise<{
    compactionItem: ResponseItem;
    usage: Usage | undefined;
}>;
export declare function stripInputFromPayload(payload: JsonObject): JsonObject;
//# sourceMappingURL=native-compaction.d.ts.map