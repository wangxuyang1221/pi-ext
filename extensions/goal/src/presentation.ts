import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type { Goal, GoalDisplayTiming, GoalRecord } from "./storage.js";

export const GOAL_DISPLAY_EVENT = "pi-ext:goal-display:v1";
export const GOAL_DISPLAY_REQUEST = "pi-ext:goal-display:request";
/** Bounded, plain-text event payload; never a persisted goal or an accounting API. */
export interface GoalDisplay {
  version: 1;
  ownerSessionId: string;
  goalId: string;
  objective: string;
  status: Goal["status"];
  summary: string;
}
export function displayText(text: string): string {
  return stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
}
export function formatGoalMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return !minutes ? "<1m" : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
export function formatGoalSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}
export function goalStatusLabel(status: Goal["status"]): string {
  return ({ active: "Active", paused: "Paused", blocked: "Blocked", usage_limited: "Usage limited", budget_limited: "Budget limited", complete: "Complete" })[status];
}
const tokens = (value: number) => value < 1000 ? String(value) : `${Number((value / 1000).toFixed(1))}k`;
interface Access {
  readTiming(): GoalDisplayTiming | undefined;
  expand(goal: Goal): Promise<string>;
  publish(display: GoalDisplay | undefined): void;
}
/** Event-driven metadata refresh plus a single elapsed-minute timeout. No I/O on ticks. */
export class GoalPresentation {
  private record: GoalRecord | undefined;
  private limitation = "";
  private suspended = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private key: string | undefined;
  private display: GoalDisplay | undefined;
  private contentKey: string | undefined;
  private contentEpoch = 0;
  private objective = "";
  private contentError = "";
  constructor(private readonly access: Access) {}

  update(record: GoalRecord | undefined, limitation = "", suspended = false): void {
    this.record = record;
    this.limitation = limitation;
    this.suspended = suspended;
    const goal = record?.goal;
    const key = goal ? JSON.stringify([record!.ownerSessionId, goal.goalId, goal.objective, goal.content]) : undefined;
    if (key !== this.contentKey) {
      this.contentKey = key;
      const epoch = ++this.contentEpoch;
      this.contentError = "";
      this.objective = goal?.content ? "Loading goal…" : this.preview(goal?.objective ?? "");
      if (goal?.content) void this.access.expand(goal).then(text => {
        if (epoch !== this.contentEpoch) return;
        this.objective = this.preview(text);
        this.refresh();
      }, () => {
        if (epoch !== this.contentEpoch) return;
        this.objective = "Goal content unavailable";
        this.contentError = "Open /goal for the content error";
        this.refresh();
      });
    }
    this.refresh();
  }
  get current(): GoalDisplay | undefined { return this.display; }
  private preview(text: string): string {
    const clean = displayText(text.slice(0, 1024));
    return [...clean].slice(0, 256).join("") + (clean.length > 256 || text.length > 1024 ? "…" : "");
  }

  private refresh(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const goal = this.record?.goal;
    const timing = goal ? this.access.readTiming() : undefined;
    let display: GoalDisplay | undefined;
    if (goal) {
      const usage = `${tokens(goal.tokensUsed)}${goal.tokenBudget === undefined ? "" : ` / ${tokens(goal.tokenBudget)}`} tokens`;
      const diagnostics = [goal.usageIncomplete ? "Observed usage only" : "", this.limitation, this.contentError].filter(Boolean);
      display = {
        version: 1, ownerSessionId: this.record!.ownerSessionId, goalId: goal.goalId,
        objective: this.objective, status: goal.status,
        summary: `${goalStatusLabel(goal.status)} · ${formatGoalMinutes(timing?.elapsedSeconds ?? goal.elapsedSeconds)} · ${usage}${diagnostics.length ? ` · ${diagnostics.join(" · ")}` : ""}`,
      };
    }
    const key = JSON.stringify(display);
    if (key !== this.key) { this.key = key; this.display = display; this.access.publish(display); }
    if (goal && !this.suspended && timing?.nextUpdateMs !== undefined && Number.isFinite(timing.nextUpdateMs) && timing.nextUpdateMs > 0 && timing.nextUpdateMs <= 60_000) {
      this.timer = setTimeout(() => this.refresh(), Math.max(1, timing.nextUpdateMs));
      this.timer.unref?.();
    }
  }
  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.record = undefined;
    this.contentEpoch++;
    this.contentKey = undefined;
    this.display = undefined;
    this.key = undefined;
    this.access.publish(undefined);
  }
}
