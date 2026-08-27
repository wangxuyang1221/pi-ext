import type { Component } from "@earendil-works/pi-tui";

import { fitToWidth, normalizeWidth } from "./layout.js";

export class ResponsiveLinesComponent implements Component {
  private renderer: (width: number) => string[] = () => [];
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  setRenderer(renderer: (width: number) => string[]): void {
    this.renderer = renderer;
    this.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    if (this.cachedLines !== undefined && this.cachedWidth === safeWidth) {
      return this.cachedLines;
    }

    this.cachedWidth = safeWidth;
    this.cachedLines = this.renderer(safeWidth)
      .map((line) => fitToWidth(line, safeWidth));
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
