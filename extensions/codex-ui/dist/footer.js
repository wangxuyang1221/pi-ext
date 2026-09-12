import { basename } from "node:path";
import { stripTerminalSequences, truncateToWidth, visibleWidth, } from "@earendil-works/pi-tui";
import { fitToWidth, formatHomePath, normalizeWidth, } from "./layout.js";
import { renderGoalDisplay } from "./goal-display.js";
const FAST_STATUS_KEY = "pi-openai-fast-mode";
const PERMISSIONS_STATUS_KEY = "permissions";
const ITEM_SEPARATOR = " ⋅ ";
const SIDE_PADDING = 1;
const ANSI_FOREGROUND_RESET = "\x1b[39m";
// Codex CLI 0.151.0 adaptive dark palette after its status-line softening pass.
const CODEX_STATUS_RGB = {
    model: [246, 226, 183],
    usage: [242, 181, 144],
    mode: [200, 169, 238],
};
export class CodexFooter {
    options;
    statusCache = new Map();
    unsubscribeBranch;
    cachedSnapshot;
    combined;
    constructor(options) {
        this.options = options;
    }
    setBranchSubscription(unsubscribe) {
        this.unsubscribeBranch?.();
        this.unsubscribeBranch = unsubscribe;
    }
    render(width) {
        const safeWidth = normalizeWidth(width);
        if (safeWidth === 0)
            return [];
        const statuses = this.options.getExtensionStatuses();
        const base = this.renderBase(safeWidth, statuses);
        const theme = this.options.getTheme();
        const goal = this.readStatus(statuses, "goal");
        const display = goal ? this.options.getGoalDisplay?.() : undefined;
        const key = JSON.stringify([safeWidth, display ?? goal]);
        if (this.combined?.base === base && this.combined.key === key && this.combined.theme === theme)
            return this.combined.lines;
        const lines = [...base];
        if (display)
            lines.push(...renderGoalDisplay(display, safeWidth, theme));
        else if (goal)
            lines.push(fitToWidth(theme.fg("muted", ` ${goal}`), safeWidth));
        this.combined = { base, key, theme, lines };
        return lines;
    }
    renderBase(width, statuses) {
        const safeWidth = normalizeWidth(width);
        if (safeWidth === 0)
            return [];
        const theme = this.options.getTheme();
        const modelId = this.options.getModelId() ?? "No model";
        const thinking = this.options.getThinkingLevel();
        const branch = this.options.getBranch();
        const contextPercent = this.options.getContextUsage()?.percent;
        const fastStatus = this.readStatus(statuses, FAST_STATUS_KEY);
        const fast = fastStatus?.toLowerCase() === "fast" ? "fast" : undefined;
        const permissions = this.readStatus(statuses, PERMISSIONS_STATUS_KEY);
        const cached = this.cachedSnapshot;
        if (cached?.width === safeWidth
            && cached.theme === theme
            && cached.modelId === modelId
            && cached.thinking === thinking
            && cached.branch === branch
            && cached.contextPercent === contextPercent
            && cached.fast === fast
            && cached.permissions === permissions) {
            return cached.lines;
        }
        const input = {
            width: safeWidth,
            modelId,
            thinking,
            cwd: this.options.cwd,
            home: this.options.home,
            branch,
            contextPercent,
            fast,
            permissions,
            theme,
        };
        const lines = [renderFooter(input)];
        this.cachedSnapshot = {
            width: safeWidth,
            theme,
            modelId,
            thinking,
            branch,
            contextPercent,
            fast,
            permissions,
            lines,
        };
        return lines;
    }
    invalidate() {
        this.combined = undefined;
        this.cachedSnapshot = undefined;
    }
    dispose() {
        this.unsubscribeBranch?.();
        this.unsubscribeBranch = undefined;
    }
    readStatus(statuses, key) {
        const raw = statuses.get(key);
        if (raw === undefined) {
            this.statusCache.delete(key);
            return undefined;
        }
        const cached = this.statusCache.get(key);
        if (cached?.raw === raw)
            return cached.sanitized || undefined;
        const sanitized = sanitizeStatus(raw);
        this.statusCache.set(key, { raw, sanitized });
        return sanitized || undefined;
    }
}
function renderFooter(input) {
    const horizontalPadding = input.width > SIDE_PADDING * 2 ? SIDE_PADDING * 2 : 0;
    const contentWidth = Math.max(0, input.width - horizontalPadding);
    const states = buildItems(input).map((item) => ({
        item,
        variantIndex: 0,
        hidden: false,
    }));
    fitItems(states, contentWidth);
    const content = visibleStates(states)
        .map((state) => {
        const current = state.item.variants[state.variantIndex];
        return current ? renderVariant(current, input.theme) : "";
    })
        .filter(Boolean)
        .join(input.theme.fg("dim", ITEM_SEPARATOR));
    const padding = horizontalPadding === 0 ? "" : " ";
    return fitToWidth(`${padding}${content}${padding}`, input.width);
}
function buildItems(input) {
    const items = [createModelItem(input.modelId, input.thinking)];
    if (input.fast)
        items.push(createFastItem(input.fast));
    items.push(createLocationItem(input.cwd, input.home, input.branch));
    const context = createContextItem(input.contextPercent);
    if (context)
        items.push(context);
    if (input.permissions)
        items.push(createPermissionsItem(input.permissions));
    return items;
}
function createModelItem(modelId, thinking) {
    return {
        key: "model",
        priority: 100,
        order: 0,
        pinned: true,
        variants: uniqueVariants([
            variant(part(`${modelId} ${thinking}`, "model")),
            variant(part(modelId, "model")),
            variant(part(truncateToWidth(modelId, 24, "…"), "model")),
        ]),
    };
}
function createFastItem(text) {
    return {
        key: "fast",
        priority: 90,
        order: 50,
        variants: [variant(part(text, "mode"))],
    };
}
function createLocationItem(cwd, home, branch) {
    const path = formatHomePath(cwd, home);
    const project = basename(cwd) || path;
    if (!branch) {
        return {
            key: "location",
            priority: 60,
            order: 100,
            variants: uniqueVariants([
                variant(part(path, "muted")),
                variant(part(project, "muted")),
            ]),
        };
    }
    return {
        key: "location",
        priority: 60,
        order: 100,
        variants: uniqueVariants([
            variant(part(path, "muted"), part(ITEM_SEPARATOR, "dim"), part(`git:${branch}`, "accent")),
            variant(part(project, "muted"), part(ITEM_SEPARATOR, "dim"), part(branch, "accent")),
            variant(part(`git:${branch}`, "accent")),
            variant(part(truncateToWidth(branch, 22, "…"), "accent")),
        ]),
    };
}
function createContextItem(percent) {
    if (percent === null || percent === undefined || !Number.isFinite(percent))
        return undefined;
    const left = Math.round(100 - Math.max(0, Math.min(100, percent)));
    return {
        key: "context",
        priority: 85,
        order: 200,
        pinned: true,
        variants: uniqueVariants([
            variant(part(`Context ${left}% left`, "usage")),
            variant(part(`${left}% left`, "usage")),
            variant(part(`${left}%`, "usage")),
        ]),
    };
}
function createPermissionsItem(text) {
    return {
        key: "permissions",
        priority: 110,
        order: 300,
        pinned: true,
        variants: [variant(part(text, /full access/iu.test(text) ? "warning" : "muted"))],
    };
}
function fitItems(states, width) {
    while (measureStates(states) > width) {
        const downgrade = states
            .filter((state) => !state.hidden && state.variantIndex + 1 < state.item.variants.length)
            .map((state) => ({ state, saving: nextVariantSaving(state) }))
            .filter(({ saving }) => saving > 0)
            .sort((left, right) => (left.state.item.priority - right.state.item.priority
            || right.saving - left.saving
            || right.state.item.order - left.state.item.order))[0];
        const removable = states
            .filter((state) => !state.hidden && !state.item.pinned)
            .sort((left, right) => (left.item.priority - right.item.priority
            || right.item.order - left.item.order))[0];
        if (downgrade && (!removable || downgrade.state.item.priority <= removable.item.priority)) {
            downgrade.state.variantIndex += 1;
            continue;
        }
        if (!removable)
            break;
        removable.hidden = true;
    }
}
function measureStates(states) {
    const visible = visibleStates(states);
    return visible.reduce((total, state) => total + currentVariantWidth(state), 0)
        + visibleWidth(ITEM_SEPARATOR) * Math.max(0, visible.length - 1);
}
function visibleStates(states) {
    return states
        .filter((state) => !state.hidden)
        .sort((left, right) => left.item.order - right.item.order || left.item.key.localeCompare(right.item.key));
}
function nextVariantSaving(state) {
    const current = state.item.variants[state.variantIndex];
    const next = state.item.variants[state.variantIndex + 1];
    return current && next ? variantWidth(current) - variantWidth(next) : 0;
}
function currentVariantWidth(state) {
    const current = state.item.variants[state.variantIndex];
    return current ? variantWidth(current) : 0;
}
function variantWidth(value) {
    return value.parts.reduce((total, item) => total + visibleWidth(item.text), 0);
}
function renderVariant(value, theme) {
    return value.parts.map((item) => (isCodexTone(item.tone)
        ? paintCodexTone(item.tone, item.text, theme)
        : theme.fg(item.tone, item.text))).join("");
}
function paintCodexTone(tone, text, theme) {
    if (theme.getColorMode() !== "truecolor") {
        const fallback = {
            model: "syntaxType",
            usage: "syntaxNumber",
            mode: "syntaxKeyword",
        };
        return theme.fg(fallback[tone], text);
    }
    const [red, green, blue] = CODEX_STATUS_RGB[tone];
    return `\x1b[38;2;${red};${green};${blue}m${text}${ANSI_FOREGROUND_RESET}`;
}
function isCodexTone(tone) {
    return tone === "model" || tone === "usage" || tone === "mode";
}
function sanitizeStatus(raw) {
    return stripTerminalSequences(raw)
        .replace(/[\r\n\t]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/^(?:[.·⋅∙│|]\s*)+/u, "");
}
function uniqueVariants(values) {
    const seen = new Set();
    return values.filter((value) => {
        const key = value.parts.map((item) => item.text).join("");
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function variant(...parts) {
    return { parts };
}
function part(text, tone) {
    return { text, tone };
}
//# sourceMappingURL=footer.js.map