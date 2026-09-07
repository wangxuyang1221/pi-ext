export type SearchStatus = "running" | "completed" | "failed" | "cancelled";
export interface SearchActivity {
  startedAt: number;
  endedAt?: number;
  status: SearchStatus;
  invalidate?: () => void;
}
const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Return a deterministic spinner frame without allocating a second timer. */
export function searchSpinner(activity: SearchActivity): string {
  return frames[Math.floor(Math.max(0, Date.now() - activity.startedAt) / 100) % frames.length]!;
}

/** Own only currently executing searches; rendered history keeps its own final snapshot. */
export class SearchAnimations {
  private active = new Map<string, { activity: SearchActivity; timer?: ReturnType<typeof setInterval>; finish: (status: SearchStatus) => void }>();

  /** Attach one row invalidator. Repeated renders replace it rather than accumulating listeners. */
  watch(id: string, invalidate: () => void): SearchActivity | undefined {
    const entry = this.active.get(id);
    if (!entry) return undefined;
    entry.activity.invalidate = invalidate;
    if (entry.timer === undefined && entry.activity.status === "running") {
      entry.timer = setInterval(() => entry.activity.invalidate?.(), 100);
      entry.timer.unref?.();
    }
    return entry.activity;
  }

  /** Animate a TUI execution, stopping on every exit path and immediately on abort. */
  async run<T>(id: string, enabled: boolean, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    if (!enabled) return operation();
    const activity: SearchActivity = { startedAt: Date.now(), status: "running" };
    const entry: { activity: SearchActivity; timer?: ReturnType<typeof setInterval>; finish: (status: SearchStatus) => void } = {
      activity,
      finish: status => {
        if (activity.status !== "running") return;
        activity.status = status;
        activity.endedAt = Date.now();
        if (entry.timer !== undefined) clearInterval(entry.timer);
        signal?.removeEventListener("abort", abort);
        this.active.delete(id);
        const invalidate = activity.invalidate;
        activity.invalidate = undefined;
        invalidate?.();
      },
    };
    const abort = () => entry.finish("cancelled");
    this.active.set(id, entry);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      const value = await operation();
      signal?.throwIfAborted();
      entry.finish("completed");
      return value;
    } catch (error) {
      entry.finish(signal?.aborted ? "cancelled" : "failed");
      throw error;
    }
  }

  /** Stop timers and detach abort listeners before session reload, replacement, or shutdown. */
  dispose(): void {
    for (const entry of [...this.active.values()]) entry.finish("cancelled");
  }
}
