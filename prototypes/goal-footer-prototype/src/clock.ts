export type PreviewStatus = "active" | "paused" | "complete";
export interface ClockSnapshot {
  status: PreviewStatus;
  elapsedSeconds: number;
  timerWakeups: number;
}

// Display-only clock. No goal storage, usage accounting, or model events.
export class GoalPreviewClock {
  private anchor: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private refresh: (() => void) | undefined;
  private status: PreviewStatus = "active";
  private timerWakeups = 0;

  constructor(private readonly now = () => performance.now(), private elapsedMs = 775_000) {
    this.anchor = now();
  }

  private currentMs(): number {
    return this.elapsedMs + (this.status === "active" ? Math.max(0, this.now() - this.anchor) : 0);
  }

  snapshot(): ClockSnapshot {
    return { status: this.status, elapsedSeconds: Math.floor(this.currentMs() / 1000), timerWakeups: this.timerWakeups };
  }

  reset(elapsedMs = 775_000): void {
    this.elapsedMs = elapsedMs;
    this.anchor = this.now();
    this.status = "active";
    this.timerWakeups = 0;
    this.publish();
  }

  setStatus(status: PreviewStatus): void {
    this.elapsedMs = this.currentMs();
    this.anchor = this.now();
    this.status = status;
    this.publish();
  }

  start(refresh: () => void): void {
    this.refresh = refresh;
    this.publish();
  }

  private publish(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.refresh?.();
    if (this.refresh && this.status === "active") {
      const delay = 60_000 - this.currentMs() % 60_000;
      this.timer = setTimeout(() => {
        this.timerWakeups++;
        this.publish();
      }, delay);
      this.timer.unref?.();
    }
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.refresh = undefined;
  }
}
