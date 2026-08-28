import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { buildToolPayload, callRemoteCompaction, type JsonObject, type NativeCompactionDetails, type ResponseItem } from "./native-compaction.js";
export type NativeCheckpointRequest = {
    ctx: ExtensionContext;
    model: Model<any>;
    input: ResponseItem[];
    basePayload?: JsonObject;
    turnState?: string;
    onTurnState?: (turnState: string) => void;
    signal?: AbortSignal;
    allTools: Parameters<typeof buildToolPayload>[0];
    activeToolNames: string[];
};
/** Owns the V2 remote protocol seam. The lifecycle adapter supplies session facts. */
export declare function createNativeCheckpoint(params: NativeCheckpointRequest): Promise<{
    details: NativeCompactionDetails;
    usage?: Awaited<ReturnType<typeof callRemoteCompaction>>["usage"];
}>;
//# sourceMappingURL=remote-compaction.d.ts.map