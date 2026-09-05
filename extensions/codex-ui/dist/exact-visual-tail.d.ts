import type { RenderCacheScope } from "./render-cache.js";
export interface ExactVisualTail {
    visualLines: string[];
    skippedCount: number;
}
export declare function countExactVisualLines(physicalLines: readonly string[], width: number, cache: Pick<RenderCacheScope, "count">): number;
export declare function getExactVisualLines(physicalLines: readonly string[], styleLine: (line: string) => string, width: number): string[];
export declare function getExactFittedVisualLines(physicalLines: readonly string[], styleLine: (line: string) => string, width: number): string[];
export declare function getExactVisualTail(physicalLines: readonly string[], styleLine: (line: string) => string, width: number, maxVisualLines: number): ExactVisualTail;
//# sourceMappingURL=exact-visual-tail.d.ts.map