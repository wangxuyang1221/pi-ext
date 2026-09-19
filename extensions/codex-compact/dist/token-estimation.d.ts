import type { JsonObject, ResponseItem } from "./native-compaction.js";
export declare function textTokens(text: string): number;
export declare function inlineImagePayload(url: string): {
    mime: string;
    payload: string;
} | undefined;
export declare function inlineAudioPayload(url: string): {
    mime: string;
    payload: string;
} | undefined;
/** Preserve Codex's 64-bit saturation even for corrupt, enormous duration metadata. */
export declare function audioTokenCount(url: string): bigint;
/** Numeric convenience view; integer accounting uses audioTokenCount directly. */
export declare function audioTokens(url: string): number;
/** Codex 0.154.0 heuristic with the pinned Rust full-image decoder. */
export declare function imageBytes(part: JsonObject): number;
export declare function contentTokens(part: JsonObject): number;
/** Match Codex's UTF-8 middle truncation, including its marker outside the text budget. */
export declare function truncateText(text: string, maxTokens: number): string;
/** Retain newest content first, with adjacent image labels kept or removed atomically. */
export declare function truncateImageMessage(item: ResponseItem, maxTokens: number): ResponseItem | undefined;
//# sourceMappingURL=token-estimation.d.ts.map