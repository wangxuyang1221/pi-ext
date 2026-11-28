import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { normalizeWidth } from "../../../shared/ui/layout.js";
import { WORKING_FRAME_MS, WorkingActivity } from "../../../shared/ui/working-activity.js";
import { claudeWorkingFrameKey, renderClaudeWorking } from "./claude-components.js";
export { WORKING_FRAME_MS, WorkingActivity };

export function workingFrameKey(elapsed: number, streamTokens: number): string {
  return claudeWorkingFrameKey(elapsed, WORKING_FRAME_MS, streamTokens);
}

export class Working implements Component {
  constructor(private readonly activity: WorkingActivity, private readonly getTheme: () => Theme) {}
  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (!this.activity.active || safeWidth === 0) return [];
    const elapsed = this.activity.elapsed(), theme = this.getTheme();
    return renderClaudeWorking(
      elapsed,
      this.activity.estimatedStreamTokens(),
      Math.max(0, this.activity.turnCount - 1),
      WORKING_FRAME_MS,
      theme,
      safeWidth,
    );
  }
  invalidate(): void {}
}
