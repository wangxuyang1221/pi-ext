import { fitToWidth, normalizeWidth } from "./layout.js";
export class ResponsiveLinesComponent {
    renderer = () => [];
    linesAlreadyFit = false;
    cachedWidth;
    cachedLines;
    setRenderer(renderer, options = {}) {
        this.renderer = renderer;
        this.linesAlreadyFit = options.linesAlreadyFit ?? false;
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