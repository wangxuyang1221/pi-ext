import type { Component } from "@earendil-works/pi-tui";
export declare class ResponsiveLinesComponent implements Component {
    private renderer;
    private cachedWidth;
    private cachedLines;
    setRenderer(renderer: (width: number) => string[]): void;
    render(width: number): string[];
    invalidate(): void;
}
//# sourceMappingURL=responsive-lines.d.ts.map