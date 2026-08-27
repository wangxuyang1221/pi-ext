import { truncateToWidth } from "@earendil-works/pi-tui";
export function normalizeWidth(width) {
    if (!Number.isFinite(width))
        return 0;
    return Math.max(0, Math.floor(width));
}
export function fitToWidth(text, width, options = {}) {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return "";
    return truncateToWidth(text, safeWidth, options.ellipsis ?? "");
}
//# sourceMappingURL=layout.js.map