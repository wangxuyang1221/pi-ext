import { type FastModeConfig, type FastTarget, type ModelRef } from "./types.js";
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function toModelRef(model: unknown): ModelRef | undefined;
export declare function isSupportedProvider(provider: string): boolean;
export declare function findMatchingTarget(model: ModelRef | undefined, targets: FastTarget[]): FastTarget | undefined;
export declare function applyFastModePayload(payload: unknown, serviceTier: string): unknown | undefined;
export declare function getFastModePayload(config: FastModeConfig, model: ModelRef | undefined, payload: unknown): unknown | undefined;
//# sourceMappingURL=payload.d.ts.map