import type { Component } from "@earendil-works/pi-tui";

import { fitToWidth, normalizeWidth } from "./layout.js";

export interface ResponsiveLinesOptions {
  linesAlreadyFit?: boolean;
}

export class ResponsiveLinesComponent implements Component {
  private renderer: (width: number) => string[] = () => [];
  private linesAlreadyFit = false;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  setRenderer(
    renderer: (width: number) => string[],
    options: ResponsiveLinesOptions = {},
  ): void {
    this.renderer = renderer;
    this.linesAlreadyFit = options.linesAlreadyFit ?? false;
    this.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    if (this.cachedLines !== undefined && this.cachedWidth === safeWidth) {
      return this.cachedLines;
    }

    this.cachedWidth = safeWidth;
    const lines = this.renderer(safeWidth);
    this.cachedLines = this.linesAlreadyFit
      ? lines
      : lines.map((line) => fitToWidth(line, safeWidth));
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
