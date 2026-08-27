import { fitToWidth, normalizeWidth } from "./layout.js";
export class ResponsiveLinesComponent {
    renderer = () => [];
    cachedWidth;
    cachedLines;
    setRenderer(renderer) {
        this.renderer = renderer;
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
        this.cachedLines = this.renderer(safeWidth)
            .map((line) => fitToWidth(line, safeWidth));
        return this.cachedLines;
    }
    invalidate() {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
}
//# sourceMappingURL=responsive-lines.js.map