import { stripTerminalSequences, truncateToWidth, visibleWidth, } from "@earendil-works/pi-tui";
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
export function paintBackground(line, width, backgroundAnsi, modifierAfterReset = "") {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return "";
    const fitted = fitToWidth(line, safeWidth, { pad: true });
    const backgroundSafe = fitted.replace(FULL_SGR_RESET, (reset) => `${reset}${backgroundAnsi}${modifierAfterReset}`);
    return `${backgroundAnsi}${backgroundSafe}${BACKGROUND_RESET}`;
}
export function fitSegments(segments, width, separator) {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return "";
    const active = segments
        .map((segment, index) => ({
        ...segment,
        index,
        width: visibleWidth(segment.text),
    }))
        .filter((segment) => segment.text.length > 0);
    if (active.length === 0)
        return "";
    const plainSeparator = stripTerminalSequences(separator);
    if (!(plainSeparator.startsWith(" ") && plainSeparator.endsWith(" "))
        || active.some((segment) => !Number.isFinite(segment.priority))) {
        return fitSegmentsWithExactJoins(active, safeWidth, separator);
    }
    const separatorWidth = visibleWidth(separator);
    let joinedWidth = active.reduce((total, segment) => total + segment.width, 0)
        + separatorWidth * Math.max(0, active.length - 1);
    if (active.length > 1 && joinedWidth > safeWidth) {
        const removalOrder = [...active].sort((left, right) => (left.priority - right.priority || right.index - left.index));
        const removed = new Set();
        let remaining = active.length;
        for (const segment of removalOrder) {
            if (remaining <= 1 || joinedWidth <= safeWidth)
                break;
            removed.add(segment.index);
            joinedWidth -= segment.width + separatorWidth;
            remaining -= 1;
        }
        const joined = active
            .filter((segment) => !removed.has(segment.index))
            .map((segment) => segment.text)
            .join(separator);
        return fitToWidth(joined, safeWidth);
    }
    return fitToWidth(active.map((segment) => segment.text).join(separator), safeWidth);
}
function fitSegmentsWithExactJoins(segments, width, separator) {
    const active = [...segments];
    const join = () => active
        .sort((left, right) => left.index - right.index)
        .map((segment) => segment.text)
        .join(separator);
    while (active.length > 1 && visibleWidth(join()) > width) {
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
    return fitToWidth(join(), width);
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