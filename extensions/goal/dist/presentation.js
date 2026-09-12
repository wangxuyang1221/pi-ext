import { stripTerminalSequences } from "@earendil-works/pi-tui";
export const GOAL_DISPLAY_EVENT = "pi-ext:goal-display:v1";
export const GOAL_DISPLAY_REQUEST = "pi-ext:goal-display:request";
export function displayText(text) {
    return stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
}
export function formatGoalMinutes(seconds) {
    const minutes = Math.floor(seconds / 60);
    return !minutes ? "<1m" : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
export function formatGoalSeconds(seconds) {
    return `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}
export function goalStatusLabel(status) {
    return ({ active: "Active", paused: "Paused", blocked: "Blocked", usage_limited: "Usage limited", budget_limited: "Budget limited", complete: "Complete" })[status];
}
const tokens = (value) => value < 1000 ? String(value) : `${Number((value / 1000).toFixed(1))}k`;
/** Event-driven metadata refresh plus a single elapsed-minute timeout. No I/O on ticks. */
export class GoalPresentation {
    access;
    record;
    limitation = "";
    suspended = false;
    timer;
    key;
    display;
    contentKey;
    contentEpoch = 0;
    objective = "";
    contentError = "";
    constructor(access) {
        this.access = access;
    }
    update(record, limitation = "", suspended = false) {
        this.record = record;
        this.limitation = limitation;
        this.suspended = suspended;
        const goal = record?.goal;
        const key = goal ? JSON.stringify([record.ownerSessionId, goal.goalId, goal.objective, goal.content]) : undefined;
        if (key !== this.contentKey) {
            this.contentKey = key;
            const epoch = ++this.contentEpoch;
            this.contentError = "";
            this.objective = goal?.content ? "Loading goal…" : this.preview(goal?.objective ?? "");
            if (goal?.content)
                void this.access.expand(goal).then(text => {
                    if (epoch !== this.contentEpoch)
                        return;
                    this.objective = this.preview(text);
                    this.refresh();
                }, () => {
                    if (epoch !== this.contentEpoch)
                        return;
                    this.objective = "Goal content unavailable";
                    this.contentError = "Open /goal for the content error";
                    this.refresh();
                });
        }
        this.refresh();
    }
    get current() { return this.display; }
    preview(text) {
        const clean = displayText(text.slice(0, 1024));
        return [...clean].slice(0, 256).join("") + (clean.length > 256 || text.length > 1024 ? "…" : "");
    }
    refresh() {
        if (this.timer !== undefined)
            clearTimeout(this.timer);
        this.timer = undefined;
        const goal = this.record?.goal;
        const timing = goal ? this.access.readTiming() : undefined;
        let display;
        if (goal) {
            const usage = `${tokens(goal.tokensUsed)}${goal.tokenBudget === undefined ? "" : ` / ${tokens(goal.tokenBudget)}`} tokens`;
            const diagnostics = [goal.usageIncomplete ? "Observed usage only" : "", this.limitation, this.contentError].filter(Boolean);
            display = {
                version: 1, ownerSessionId: this.record.ownerSessionId, goalId: goal.goalId,
                objective: this.objective, status: goal.status,
                summary: `${goalStatusLabel(goal.status)} · ${formatGoalMinutes(timing?.elapsedSeconds ?? goal.elapsedSeconds)} · ${usage}${diagnostics.length ? ` · ${diagnostics.join(" · ")}` : ""}`,
            };
        }
        const key = JSON.stringify(display);
        if (key !== this.key) {
            this.key = key;
            this.display = display;
            this.access.publish(display);
        }
        if (goal && !this.suspended && timing?.nextUpdateMs !== undefined && Number.isFinite(timing.nextUpdateMs) && timing.nextUpdateMs > 0 && timing.nextUpdateMs <= 60_000) {
            this.timer = setTimeout(() => this.refresh(), Math.max(1, timing.nextUpdateMs));
            this.timer.unref?.();
        }
    }
    dispose() {
        if (this.timer !== undefined)
            clearTimeout(this.timer);
        this.timer = undefined;
        this.record = undefined;
        this.contentEpoch++;
        this.contentKey = undefined;
        this.display = undefined;
        this.key = undefined;
        this.access.publish(undefined);
    }
}
//# sourceMappingURL=presentation.js.map