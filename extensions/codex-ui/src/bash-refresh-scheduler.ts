export class BashRefreshScheduler {
  private readonly invalidators = new Map<string, () => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly refreshMs: number) {}

  track(toolCallId: string, invalidate: () => void): void {
    this.invalidators.set(toolCallId, invalidate);
    if (this.timer !== undefined) return;

    this.timer = setInterval(() => {
      for (const callback of [...this.invalidators.values()]) {
        callback();
      }
    }, this.refreshMs);
    this.timer.unref?.();
  }

  untrack(toolCallId: string): void {
    this.invalidators.delete(toolCallId);
    if (this.invalidators.size === 0) {
      this.stopTimer();
    }
  }

  dispose(): void {
    this.invalidators.clear();
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
