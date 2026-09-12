import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";

// Versioned optional event contract. No runtime dependency on the goal extension.
export interface GoalFooterDisplay {
  version: 1; ownerSessionId: string; goalId: string;
  objective: string; status: string; summary: string;
}
export function readGoalDisplay(value: unknown, ownerSessionId: string): GoalFooterDisplay | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as GoalFooterDisplay;
  if (v.version !== 1 || v.ownerSessionId !== ownerSessionId || typeof v.goalId !== "string" || v.goalId.length > 256
    || typeof v.objective !== "string" || v.objective.length > 2048 || typeof v.summary !== "string" || v.summary.length > 4096
    || !["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"].includes(v.status)) return;
  const clean = (text: string) => stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  return { version: 1, ownerSessionId, goalId: v.goalId, status: v.status, objective: clean(v.objective), summary: clean(v.summary) };
}
export function renderGoalDisplay(display: GoalFooterDisplay, width: number, theme: Theme): string[] {
  const tone = display.status === "active" ? "accent" : display.status === "complete" ? "success" : "warning";
  const icon = display.status === "active" ? "●" : display.status === "complete" ? "✓" : display.status === "paused" ? "Ⅱ" : "!";
  return [
    ` ${theme.fg(tone, icon)} ${theme.bold("Goal")}  ${display.objective}`,
    `   ${theme.fg("muted", display.summary)}`,
  ].map(line => truncateToWidth(line, Math.max(0, width), "…"));
}
