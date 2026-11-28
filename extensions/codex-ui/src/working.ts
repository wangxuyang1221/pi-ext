import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { fitToWidth, normalizeWidth } from "../../../shared/ui/layout.js";
import { WORKING_FRAME_MS, WorkingActivity } from "../../../shared/ui/working-activity.js";
export { WORKING_FRAME_MS, WorkingActivity };
const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** Discrete visual state key covering every time-dependent element of Working. */
export function workingFrameKey(elapsed: number): string {
  const spinner = Math.floor(elapsed / WORKING_FRAME_MS) % FRAMES.length;
  const seconds = Math.floor(elapsed / 1000);
  return `${spinner}:${seconds}`;
}

export class Working implements Component {
  constructor(private readonly activity: WorkingActivity, private readonly getTheme: () => Theme) {}
  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (!this.activity.active || safeWidth === 0) return [];
    const elapsed = this.activity.elapsed(), theme = this.getTheme();
    const spinner = theme.fg("accent", FRAMES[Math.floor(elapsed / WORKING_FRAME_MS) % FRAMES.length]!);
    const hint = safeWidth >= 40;
    const timing = `(${elapsedLabel(elapsed)}${hint ? " · esc to interrupt" : ""})`;
    const styled = hint
      ? theme.fg("dim", `(${elapsedLabel(elapsed)} · `) + theme.fg("muted", "esc") + theme.fg("dim", " to interrupt)")
      : theme.fg("dim", timing);
    const label = theme.bold(theme.fg("text", "Working"));
    const line = ` ${spinner} ${label} ${styled}`;
    // The fixed prefix and timing use single-cell glyphs; only narrow layouts need clipping.
    return [11 + timing.length <= safeWidth ? line : fitToWidth(line, safeWidth)];
  }
  invalidate(): void {}
}

function elapsedLabel(elapsed: number): string {
  const total = Math.floor(elapsed / 1000);
  if (total < 60) return `${total}s`;
  const seconds = String(total % 60).padStart(2, "0");
  if (total < 3600) return `${Math.floor(total / 60)}m ${seconds}s`;
  return `${Math.floor(total / 3600)}h ${String(Math.floor(total / 60) % 60).padStart(2, "0")}m ${seconds}s`;
}
