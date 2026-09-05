import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { fitToWidth, normalizeWidth } from "./layout.js";
export function countExactVisualLines(physicalLines, width, cache) {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return 0;
    let total = 0;
    for (const line of physicalLines) {
        total += cache.count(`physical-line\0${safeWidth}\0${line}`, () => wrapTextWithAnsi(line.replace(/\t/gu, "   "), safeWidth).length);
    }
    return total;
}
export function getExactVisualLines(physicalLines, styleLine, width) {
    const visualLines = [];
    for (const physicalLine of physicalLines) {
        const styledLine = styleLine(physicalLine).replace(/\t/gu, "   ");
        for (const visualLine of wrapTextWithAnsi(styledLine, width)) {
            visualLines.push(`${visualLine}${" ".repeat(Math.max(0, width - visibleWidth(visualLine)))}`);
        }
    }
    return visualLines;
}
export function getExactFittedVisualLines(physicalLines, styleLine, width) {
    const visualLines = [];
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
export function getExactVisualTail(physicalLines, styleLine, width, maxVisualLines) {
    if (physicalLines.length === 0 || maxVisualLines <= 0) {
        return { visualLines: [], skippedCount: 0 };
    }
    const ring = new Array(maxVisualLines);
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
//# sourceMappingURL=exact-visual-tail.js.map