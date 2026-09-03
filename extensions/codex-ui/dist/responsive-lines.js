import { fitToWidth, normalizeWidth } from "./layout.js";
export class ResponsiveLinesComponent {
    renderer = () => [];
    linesAlreadyFit = false;
    hasCacheKey = false;
    cacheKey;
    cachedWidth;
    cachedLines;
    setRenderer(renderer, options = {}) {
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
        if (!preserveCache)
            this.invalidate();
    }
    render(width) {
        const safeWidth = normalizeWidth(width);
        if (safeWidth === 0)
            return [];
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
    invalidate() {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
}
//# sourceMappingURL=responsive-lines.js.map