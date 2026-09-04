import { DEFAULT_SERVICE_TIER, SUPPORTED_PROVIDERS, } from "./types.js";
const SUPPORTED_PROVIDER_SET = new Set(SUPPORTED_PROVIDERS);
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function toModelRef(model) {
    if (!isRecord(model))
        return undefined;
    const { provider, id } = model;
    if (typeof provider !== "string" || typeof id !== "string")
        return undefined;
    if (!provider || !id)
        return undefined;
    return { provider, id };
}
export function isSupportedProvider(provider) {
    return SUPPORTED_PROVIDER_SET.has(provider);
}
export function findMatchingTarget(model, targets) {
    if (!model || !isSupportedProvider(model.provider))
        return undefined;
    return targets.find((target) => target.provider === model.provider &&
        target.model === model.id &&
        isSupportedProvider(target.provider));
}
export function applyFastModePayload(payload, serviceTier) {
    if (!isRecord(payload))
        return undefined;
    return {
        ...payload,
        service_tier: serviceTier || DEFAULT_SERVICE_TIER,
    };
}
export function getFastModePayload(config, model, payload) {
    if (!config.enabled)
        return undefined;
    const target = findMatchingTarget(model, config.targets);
    if (!target)
        return undefined;
    return applyFastModePayload(payload, target.serviceTier ?? DEFAULT_SERVICE_TIER);
}
//# sourceMappingURL=payload.js.map