import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
const BACKGROUND_RESET = "\x1b[49m";
const FULL_SGR_RESET = /\x1b\[(?:0)?m/g;
export function normalizeWidth(width) {
    if (!Number.isFinite(width))
        return 0;
    return Math.max(0, Math.floor(width));
}
export function fitToWidth(text, width, options = {}) {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return "";
    const fitted = truncateToWidth(text, safeWidth, options.ellipsis ?? "");
    if (!options.pad)
        return fitted;
    return `${fitted}${" ".repeat(Math.max(0, safeWidth - visibleWidth(fitted)))}`;
}
export function paintBackground(line, width, backgroundAnsi) {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return "";
    const fitted = fitToWidth(line, safeWidth, { pad: true });
    const backgroundSafe = fitted.replace(FULL_SGR_RESET, (reset) => `${reset}${backgroundAnsi}`);
    return `${backgroundAnsi}${backgroundSafe}${BACKGROUND_RESET}`;
}
export function fitSegments(segments, width, separator) {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return "";
    const active = segments
        .map((segment, index) => ({ ...segment, index }))
        .filter((segment) => segment.text.length > 0);
    if (active.length === 0)
        return "";
    const join = () => active
        .sort((left, right) => left.index - right.index)
        .map((segment) => segment.text)
        .join(separator);
    while (active.length > 1 && visibleWidth(join()) > safeWidth) {
        let removableIndex = 0;
        for (let index = 1; index < active.length; index += 1) {
            const candidate = active[index];
            const current = active[removableIndex];
            if (candidate.priority < current.priority
                || (candidate.priority === current.priority && candidate.index > current.index)) {
                removableIndex = index;
            }
        }
        active.splice(removableIndex, 1);
    }
    return fitToWidth(join(), safeWidth);
}
export function formatHomePath(path, home = process.env.HOME) {
    if (!home)
        return path;
    const normalizedHome = home.replace(/[\\/]+$/u, "");
    if (path === normalizedHome)
        return "~";
    if (path.startsWith(`${normalizedHome}/`)
        || path.startsWith(`${normalizedHome}\\`)) {
        return `~${path.slice(normalizedHome.length)}`;
    }
    return path;
}
export function formatContextLeft(usage) {
    if (!usage || usage.percent === null || !Number.isFinite(usage.percent)) {
        return undefined;
    }
    const left = Math.round(Math.max(0, Math.min(100, 100 - usage.percent)));
    return `Context ${left}% left`;
}
//# sourceMappingURL=layout.js.map