import { STATUS_KEY } from "./types.js";
import { findMatchingTarget } from "./payload.js";
export function getStatusText(config, model) {
    return config.enabled && findMatchingTarget(model, config.targets)
        ? "fast"
        : undefined;
}
export function canSetTuiStatus(ctx) {
    if (!ctx.hasUI)
        return false;
    if (ctx.mode !== undefined && ctx.mode !== "tui")
        return false;
    return typeof ctx.ui?.setStatus === "function";
}
function setFastIndicator(ctx, text) {
    ctx.ui?.setWidget?.(STATUS_KEY, undefined, { placement: "belowEditor" });
    ctx.ui?.setStatus?.(STATUS_KEY, text);
}
export function updateFastStatus(ctx, config, model) {
    if (!canSetTuiStatus(ctx))
        return;
    setFastIndicator(ctx, getStatusText(config, model));
}
export function clearFastStatus(ctx) {
    if (!canSetTuiStatus(ctx))
        return;
    setFastIndicator(ctx, undefined);
}
//# sourceMappingURL=status.js.map