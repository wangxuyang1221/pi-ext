import type { Component } from "@earendil-works/pi-tui";
export interface ResponsiveLinesOptions {
    linesAlreadyFit?: boolean;
    cacheKey?: unknown;
}
export declare class ResponsiveLinesComponent implements Component {
    private renderer;
    private linesAlreadyFit;
    private hasCacheKey;
    private cacheKey;
    private cachedWidth;
    private cachedLines;
    setRenderer(renderer: (width: number) => string[], options?: ResponsiveLinesOptions): void;
    render(width: number): string[];
    invalidate(): void;
}
//# sourceMappingURL=responsive-lines.d.ts.map