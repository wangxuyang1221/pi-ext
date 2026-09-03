import type { Component } from "@earendil-works/pi-tui";

import { fitToWidth, normalizeWidth } from "./layout.js";

export interface ResponsiveLinesOptions {
  linesAlreadyFit?: boolean;
  cacheKey?: unknown;
}

export class ResponsiveLinesComponent implements Component {
  private renderer: (width: number) => string[] = () => [];
  private linesAlreadyFit = false;
  private hasCacheKey = false;
  private cacheKey: unknown;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  setRenderer(
    renderer: (width: number) => string[],
    options: ResponsiveLinesOptions = {},
  ): void {
    const linesAlreadyFit = options.linesAlreadyFit ?? false;
    const hasCacheKey = Object.prototype.hasOwnProperty.call(options, "cacheKey");
    const preserveCache = hasCacheKey
      && this.hasCacheKey
      && Object.is(this.cacheKey, options.cacheKey)
      && this.linesAlreadyFit === linesAlreadyFit;

    this.renderer = renderer;
    this.linesAlreadyFit = linesAlreadyFit;
    this.hasCacheKey = hasCacheKey;
    this.cacheKey = options.cacheKey;
    if (!preserveCache) this.invalidate();
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
