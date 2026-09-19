import { type ResponseItem } from "./native-compaction.js";
/** Hashes JSON content without depending on object property insertion order. */
export declare function accountingFingerprint(value: unknown): string;
/** Tracks usage only for requests observed in the current session lifecycle. */
export declare class WindowUsageAccounting {
    private request;
    private response;
    observeRequest(prefix: string, input: ResponseItem[]): void;
    observeResponse(message: unknown): void;
    estimate(prefix: string, input: ResponseItem[], message: unknown, estimate: (items: ResponseItem[]) => number): number | undefined;
}
//# sourceMappingURL=usage-accounting.d.ts.map