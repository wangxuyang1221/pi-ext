import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { fitToWidth, normalizeWidth } from "./layout.js";
import type { RenderCacheScope } from "./render-cache.js";

export interface ExactVisualTail {
  visualLines: string[];
  skippedCount: number;
}

export function countExactVisualLines(
  physicalLines: readonly string[],
  width: number,
  cache: Pick<RenderCacheScope, "count">,
): number {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return 0;
  let total = 0;
  for (const line of physicalLines) {
    total += cache.count(`physical-line\0${safeWidth}\0${line}`,
      () => wrapTextWithAnsi(line.replace(/\t/gu, "   "), safeWidth).length);
  }
  return total;
}

export function getExactVisualLines(
  physicalLines: readonly string[],
  styleLine: (line: string) => string,
  width: number,
): string[] {
  const visualLines: string[] = [];
  for (const physicalLine of physicalLines) {
    const styledLine = styleLine(physicalLine).replace(/\t/gu, "   ");
    for (const visualLine of wrapTextWithAnsi(styledLine, width)) {
      visualLines.push(
        `${visualLine}${" ".repeat(Math.max(0, width - visibleWidth(visualLine)))}`,
      );
    }
  }
  return visualLines;
}

export function getExactFittedVisualLines(
  physicalLines: readonly string[],
  styleLine: (line: string) => string,
  width: number,
): string[] {
  const visualLines: string[] = [];
  for (const physicalLine of physicalLines) {
    const styledLine = styleLine(physicalLine).replace(/\t/gu, "   ");
    for (const visualLine of wrapTextWithAnsi(styledLine, width)) {
      const lineWidth = visibleWidth(visualLine);
      visualLines.push(lineWidth <= width
        ? `${visualLine}${" ".repeat(width - lineWidth)}`
        : fitToWidth(visualLine, width));
    }
  }
  return visualLines;
}

export function getExactVisualTail(
  physicalLines: readonly string[],
  styleLine: (line: string) => string,
  width: number,
  maxVisualLines: number,
): ExactVisualTail {
  if (physicalLines.length === 0 || maxVisualLines <= 0) {
    return { visualLines: [], skippedCount: 0 };
  }

  const ring = new Array<string>(maxVisualLines);
  let totalVisualLines = 0;

  for (const physicalLine of physicalLines) {
    const styledLine = styleLine(physicalLine).replace(/\t/gu, "   ");
    for (const visualLine of wrapTextWithAnsi(styledLine, width)) {
      const padded = `${visualLine}${" ".repeat(Math.max(0, width - visibleWidth(visualLine)))}`;
      ring[totalVisualLines % maxVisualLines] = padded;
      totalVisualLines += 1;
    }
  }

  const visibleCount = Math.min(totalVisualLines, maxVisualLines);
  if (totalVisualLines <= maxVisualLines) {
    return {
      visualLines: ring.slice(0, visibleCount),
      skippedCount: 0,
    };
  }

  const start = totalVisualLines % maxVisualLines;
  return {
    visualLines: [...ring.slice(start), ...ring.slice(0, start)],
    skippedCount: totalVisualLines - maxVisualLines,
  };
}
