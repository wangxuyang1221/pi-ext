import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { ClockSnapshot } from "./clock.js";

export const GOAL_FIXTURE = {
  objective: "完成 goal extension 的界面改版",
  tokensUsed: 12_345,
  tokenBudget: 80_000,
};

export function formatMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (!minutes) return "<1m";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatExact(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

const states = {
  active: { icon: "●", label: "Active", tone: "accent" },
  paused: { icon: "Ⅱ", label: "Paused", tone: "warning" },
  complete: { icon: "✓", label: "Complete", tone: "success" },
} as const;

export function renderGoalLines(width: number, snapshot: ClockSnapshot, theme: Theme): string[] {
  const state = states[snapshot.status];
  const limit = Math.max(0, Math.floor(width));
  const title = ` ${theme.fg(state.tone, state.icon)} ${theme.bold("Goal")}  ${GOAL_FIXTURE.objective}`;
  const hint = snapshot.status === "paused" ? " · /goal resume" : "";
  const usage = `${(GOAL_FIXTURE.tokensUsed / 1000).toFixed(1)}k / ${GOAL_FIXTURE.tokenBudget / 1000}k tokens`;
  const meta = `   ${theme.fg(state.tone, state.label)}${theme.fg("muted", ` · ${formatMinutes(snapshot.elapsedSeconds)} · ${usage}${hint}`)}`;
  return [title, meta].map(line => truncateToWidth(line, limit, "…"));
}

// Keep the production footer independent of the prototype clock's cache key.
export class GoalPreviewFooter implements Component {
  private cached: { key: string; theme: Theme; lines: string[] } | undefined;
  constructor(
    private readonly base: Component & { dispose?(): void },
    private readonly snapshot: () => ClockSnapshot,
    private readonly theme: () => Theme,
  ) {}

  render(width: number): string[] {
    const snapshot = this.snapshot();
    const theme = this.theme();
    const key = `${width}:${snapshot.status}:${formatMinutes(snapshot.elapsedSeconds)}`;
    if (this.cached?.key !== key || this.cached.theme !== theme) {
      this.cached = { key, theme, lines: renderGoalLines(width, snapshot, theme) };
    }
    return [...this.base.render(width), ...this.cached.lines];
  }

  invalidate(): void {
    this.cached = undefined;
    this.base.invalidate();
  }

  dispose(): void { this.base.dispose?.(); }
}
