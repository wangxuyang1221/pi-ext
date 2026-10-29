import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { fitToWidth, normalizeWidth } from "./layout.js";
import { TokenRate } from "./token-rate.js";

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

/** Keep task lifetime independent of the current model response. */
export class WorkingActivity {
  readonly rate: TokenRate;
  active = false;
  private started = 0;
  constructor(private readonly now = () => performance.now()) { this.rate = new TokenRate(now); }
  start(): void {
    if (this.active) return;
    this.active = true; this.started = this.now(); this.rate.reset();
  }
  stop(): void { this.active = false; this.rate.reset(); }
  elapsed(): number { return Math.max(0, this.now() - this.started); }
  label(): string | undefined { return this.active ? this.rate.label() : undefined; }
}

export class Working implements Component {
  constructor(private readonly activity: WorkingActivity, private readonly getTheme: () => Theme) {}
  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (!this.activity.active || safeWidth === 0) return [];
    const elapsed = this.activity.elapsed(), theme = this.getTheme();
    const spinner = theme.fg("accent", FRAMES[Math.floor(elapsed / 80) % FRAMES.length]!);
    const timing = `(${elapsedLabel(elapsed)}${safeWidth >= 40 ? " • esc to interrupt" : ""})`;
    const line = ` ${spinner} ${shimmer(elapsed)} ${theme.fg("dim", timing)}`;
    // The fixed prefix and timing use single-cell glyphs; only narrow layouts need clipping.
    return [11 + timing.length <= safeWidth ? line : fitToWidth(line, safeWidth)];
  }
  invalidate(): void {}
}

// Adapted from OpenAI Codex rust-v0.97.0 tui/src/shimmer.rs, Apache-2.0.
// Preserve the prototype's 2s sweep, 10-cell padding, cosine band and gray palette.
function shimmer(elapsed: number): string {
  const position = Math.floor(elapsed % 2000 / 2000 * 27);
  return [..."Working"].map((char, index) => {
    const distance = Math.abs(index + 10 - position);
    const intensity = distance <= 5 ? 0.5 * (1 + Math.cos(Math.PI * distance / 5)) : 0;
    const gray = Math.trunc(255 * intensity * 0.9 + 128 * (1 - intensity * 0.9));
    return `\x1b[1;38;2;${gray};${gray};${gray}m${char}\x1b[22;39m`;
  }).join("");
}

function elapsedLabel(elapsed: number): string {
  const total = Math.floor(elapsed / 1000);
  if (total < 60) return `${total}s`;
  const seconds = String(total % 60).padStart(2, "0");
  if (total < 3600) return `${Math.floor(total / 60)}m ${seconds}s`;
  return `${Math.floor(total / 3600)}h ${String(Math.floor(total / 60) % 60).padStart(2, "0")}m ${seconds}s`;
}
