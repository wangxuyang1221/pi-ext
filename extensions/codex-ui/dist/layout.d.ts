export interface FitToWidthOptions {
    ellipsis?: string;
    pad?: boolean;
}
export interface PrioritizedSegment {
    text: string;
    priority: number;
}
export interface ContextPercent {
    percent: number | null;
}
export declare function normalizeWidth(width: number): number;
export declare function fitToWidth(text: string, width: number, options?: FitToWidthOptions): string;
export declare function paintBackground(line: string, width: number, backgroundAnsi: string, modifierAfterReset?: string): string;
export declare function fitSegments(segments: readonly PrioritizedSegment[], width: number, separator: string): string;
export declare function formatHomePath(path: string, home?: string | undefined): string;
export declare function formatContextLeft(usage: ContextPercent | undefined): string | undefined;
//# sourceMappingURL=layout.d.ts.map