import { STATUS_KEY, type FastModeConfig, type ModelRef } from "./types.js";
import { findMatchingTarget } from "./payload.js";

export type StatusText = "fast" | undefined;

export type StatusContext = {
  hasUI?: boolean;
  mode?: string;
  ui?: {
    setStatus?: (key: string, text: string | undefined) => void;
    setWidget?: (
      key: string,
      content: undefined,
      options?: { placement?: "aboveEditor" | "belowEditor" },
    ) => void;
  };
};

export function getStatusText(
  config: FastModeConfig,
  model: ModelRef | undefined,
  excludedCodexModels?: ReadonlySet<string>,
): StatusText {
  return config.enabled &&
    findMatchingTarget(model, config.targets, excludedCodexModels)
    ? "fast"
    : undefined;
}

export function canSetTuiStatus(ctx: StatusContext): boolean {
  if (!ctx.hasUI) return false;
  if (ctx.mode !== undefined && ctx.mode !== "tui") return false;
  return typeof ctx.ui?.setStatus === "function";
}

function setFastIndicator(ctx: StatusContext, text: StatusText): void {
  ctx.ui?.setWidget?.(STATUS_KEY, undefined, { placement: "belowEditor" });
  ctx.ui?.setStatus?.(STATUS_KEY, text);
}

export function updateFastStatus(
  ctx: StatusContext,
  config: FastModeConfig,
  model: ModelRef | undefined,
  excludedCodexModels?: ReadonlySet<string>,
): void {
  if (!canSetTuiStatus(ctx)) return;
  setFastIndicator(ctx, getStatusText(config, model, excludedCodexModels));
}

export function clearFastStatus(ctx: StatusContext): void {
  if (!canSetTuiStatus(ctx)) return;
  setFastIndicator(ctx, undefined);
}
