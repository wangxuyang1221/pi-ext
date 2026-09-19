import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
const DEFAULT_CONFIG = {
    autoCompactScope: "total",
};
export function parseConfig(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input))
        return {};
    const value = input;
    return {
        ...(typeof value.effectiveContextWindowPercent === "number" && Number.isFinite(value.effectiveContextWindowPercent)
            && value.effectiveContextWindowPercent > 0 && value.effectiveContextWindowPercent <= 100
            ? { effectiveContextWindowPercent: value.effectiveContextWindowPercent } : {}),
        ...(typeof value.autoCompactTokenLimit === "number" && value.autoCompactTokenLimit > 0
            ? { autoCompactTokenLimit: value.autoCompactTokenLimit }
            : {}),
        ...(value.autoCompactScope === "total" || value.autoCompactScope === "bodyAfterPrefix"
            ? { autoCompactScope: value.autoCompactScope }
            : {}),
    };
}
function readConfig(path) {
    try {
        return parseConfig(JSON.parse(readFileSync(path, "utf8")));
    }
    catch {
        return {};
    }
}
export function loadConfig(cwd, trusted) {
    const global = readConfig(join(getAgentDir(), "pi-codex-compact.json"));
    const project = trusted ? readConfig(join(cwd, CONFIG_DIR_NAME, "pi-codex-compact.json")) : {};
    return { ...DEFAULT_CONFIG, ...global, ...project };
}
/** Reserve Codex's default headroom without changing the raw-window auto threshold. */
export function effectiveContextWindow(config, contextWindow) {
    return Math.floor(contextWindow * (config.effectiveContextWindowPercent ?? 95) / 100);
}
/** Codex caps configured auto-compaction limits at 90% of the context window. */
export function autoCompactTokenLimit(config, contextWindow) {
    const codexLimit = Math.floor(contextWindow * 0.9);
    return config.autoCompactTokenLimit === undefined
        ? codexLimit
        : Math.min(config.autoCompactTokenLimit, codexLimit);
}
//# sourceMappingURL=config.js.map