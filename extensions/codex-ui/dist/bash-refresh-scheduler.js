export class BashRefreshScheduler {
    refreshMs;
    invalidators = new Map();
    timer;
    constructor(refreshMs) {
        this.refreshMs = refreshMs;
    }
    track(toolCallId, invalidate) {
        this.invalidators.set(toolCallId, invalidate);
        if (this.timer !== undefined)
            return;
        this.timer = setInterval(() => {
            for (const callback of [...this.invalidators.values()]) {
                callback();
            }
        }, this.refreshMs);
        this.timer.unref?.();
    }
    untrack(toolCallId) {
        this.invalidators.delete(toolCallId);
        if (this.invalidators.size === 0) {
            this.stopTimer();
        }
    }
    dispose() {
        this.invalidators.clear();
        this.stopTimer();
    }
    stopTimer() {
        if (this.timer === undefined)
            return;
        clearInterval(this.timer);
        this.timer = undefined;
    }
}
//# sourceMappingURL=bash-refresh-scheduler.js.map