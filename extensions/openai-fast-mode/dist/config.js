import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_SERVICE_TIER, SUPPORTED_PROVIDERS, } from "./types.js";
export const DEFAULT_CONFIG = {
    enabled: false,
    targets: [
        { provider: "openai", model: "gpt-5.4", serviceTier: DEFAULT_SERVICE_TIER },
        { provider: "openai", model: "gpt-5.5", serviceTier: DEFAULT_SERVICE_TIER },
        { provider: "openai", model: "gpt-5.6", serviceTier: DEFAULT_SERVICE_TIER },
        {
            provider: "openai",
            model: "gpt-5.6-sol",
            serviceTier: DEFAULT_SERVICE_TIER,
        },
        {
            provider: "openai",
            model: "gpt-5.6-terra",
            serviceTier: DEFAULT_SERVICE_TIER,
        },
        {
            provider: "openai",
            model: "gpt-5.6-luna",
            serviceTier: DEFAULT_SERVICE_TIER,
        },
        {
            provider: "openai-codex",
            model: "gpt-5.4",
            serviceTier: DEFAULT_SERVICE_TIER,
        },
        {
            provider: "openai-codex",
            model: "gpt-5.5",
            serviceTier: DEFAULT_SERVICE_TIER,
        },
        {
            provider: "openai-codex",
            model: "gpt-5.6",
            serviceTier: DEFAULT_SERVICE_TIER,
        },
        {
            provider: "openai-codex",
            model: "gpt-5.6-sol",
            serviceTier: DEFAULT_SERVICE_TIER,
        },
        {
            provider: "openai-codex",
            model: "gpt-5.6-terra",
            serviceTier: DEFAULT_SERVICE_TIER,
        },
        {
            provider: "openai-codex",
            model: "gpt-5.6-luna",
            serviceTier: DEFAULT_SERVICE_TIER,
        },
    ],
};
const SUPPORTED_PROVIDER_SET = new Set(SUPPORTED_PROVIDERS);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cloneTarget(target) {
    return {
        provider: target.provider,
        model: target.model,
        serviceTier: target.serviceTier ?? DEFAULT_SERVICE_TIER,
    };
}
export function cloneConfig(config = DEFAULT_CONFIG) {
    return {
        enabled: config.enabled,
        targets: config.targets.map(cloneTarget),
    };
}
/** Keep the persisted toggle while replacing targets with this package's current list. */
export function syncSupportedTargets(config) {
    return {
        enabled: config.enabled,
        targets: DEFAULT_CONFIG.targets.map(cloneTarget),
    };
}
function normalizeTarget(rawTarget) {
    if (!isRecord(rawTarget))
        return undefined;
    const rawProvider = rawTarget.provider;
    const rawModel = rawTarget.model;
    if (typeof rawProvider !== "string" || typeof rawModel !== "string") {
        return undefined;
    }
    const provider = rawProvider.trim().toLowerCase();
    const model = rawModel.trim();
    if (!provider || !model || !SUPPORTED_PROVIDER_SET.has(provider)) {
        return undefined;
    }
    const rawServiceTier = rawTarget.serviceTier;
    const serviceTier = typeof rawServiceTier === "string" && rawServiceTier.trim() !== ""
        ? rawServiceTier.trim()
        : DEFAULT_SERVICE_TIER;
    return { provider, model, serviceTier };
}
export function normalizeTargets(rawTargets) {
    if (!Array.isArray(rawTargets))
        return undefined;
    const normalized = [];
    const seen = new Set();
    for (const rawTarget of rawTargets) {
        const target = normalizeTarget(rawTarget);
        if (!target)
            continue;
        const key = `${target.provider}\u0000${target.model}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        normalized.push(target);
    }
    return normalized;
}
/**
 * Convert arbitrary config input into a safe Fast Mode config.
 *
 * Invalid top-level values fall back entirely. Invalid or missing fields fall
 * back field-by-field, while an explicit empty targets array is preserved so a
 * user can opt out of every target in a scoped config.
 */
export function normalizeConfig(raw, fallback = DEFAULT_CONFIG) {
    const safeFallback = cloneConfig(fallback);
    if (!isRecord(raw))
        return safeFallback;
    const enabled = typeof raw.enabled === "boolean" ? raw.enabled : safeFallback.enabled;
    const targets = normalizeTargets(raw.targets) ?? safeFallback.targets;
    return { enabled, targets };
}
export function parseConfigJson(json, fallback = DEFAULT_CONFIG) {
    try {
        return normalizeConfig(JSON.parse(json), fallback);
    }
    catch {
        return cloneConfig(fallback);
    }
}
export function getUserConfigPath(agentDir = getAgentDir()) {
    return join(agentDir, "extensions", "pi-openai-fast-mode", "config.json");
}
export function getProjectConfigPath(cwd) {
    return join(resolve(cwd), ".pi", "pi-openai-fast-mode", "config.json");
}
export function isProjectLocalExtension(extensionDir, cwd) {
    if (!extensionDir)
        return false;
    const projectPiDir = resolve(cwd, ".pi");
    const resolvedExtensionDir = resolve(extensionDir);
    return (resolvedExtensionDir === projectPiDir ||
        resolvedExtensionDir.startsWith(projectPiDir.endsWith(sep) ? projectPiDir : `${projectPiDir}${sep}`));
}
export function selectConfigPath({ cwd, extensionDir, agentDir, exists = existsSync, }) {
    const projectPath = getProjectConfigPath(cwd);
    if (exists(projectPath)) {
        return { scope: "project", path: projectPath };
    }
    if (isProjectLocalExtension(extensionDir, cwd)) {
        return { scope: "project", path: projectPath };
    }
    return { scope: "user", path: getUserConfigPath(agentDir) };
}
export async function loadConfigFromPath(configPath, fallback = DEFAULT_CONFIG) {
    try {
        const json = await fs.readFile(configPath, "utf8");
        return parseConfigJson(json, fallback);
    }
    catch {
        return cloneConfig(fallback);
    }
}
export async function loadConfigForScope(options) {
    const selected = selectConfigPath(options);
    const config = await loadConfigFromPath(selected.path, options.fallback ?? DEFAULT_CONFIG);
    return { ...selected, config };
}
export async function saveConfigToPath(configPath, config) {
    const normalized = normalizeConfig(config);
    await fs.mkdir(dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
export async function saveConfigForScope(options, config) {
    const selected = selectConfigPath(options);
    await saveConfigToPath(selected.path, config);
    return selected;
}
//# sourceMappingURL=config.js.map