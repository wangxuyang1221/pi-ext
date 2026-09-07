// PROTOTYPE: Deterministic six-second playback; one bounded timer per session.
export type CheckColor = "green" | "gray";
export type ColorStyle = "minimal" | "accent";
export type Scene = "success" | "error";
export const FRAME_MS = 100;
export const LAST_FRAME = 60;
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export interface Scheduler {
  every(callback: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}
const realScheduler: Scheduler = {
  every: (callback, ms) => setInterval(callback, ms),
  cancel: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};
export class SearchPlayback {
  frame = LAST_FRAME;
  check: CheckColor = "green";
  style: ColorStyle = "minimal";
  scene: Scene = "success";
  private timer: unknown;
  private listeners = new Set<() => void>();
  constructor(private scheduler: Scheduler = realScheduler) {}
  get playing() { return this.timer !== undefined; }
  get done() { return this.frame >= LAST_FRAME; }
  get completed() { return this.frame < 20 ? 0 : this.frame < 45 ? 1 : 2; }
  get elapsedMs() { return this.frame * FRAME_MS; }
  get spinner() { return SPINNER[this.frame % SPINNER.length]!; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  replay() { this.stop(); this.frame = 0; this.start(); this.notify(); }
  step() {
    if (this.done) return;
    this.frame++;
    if (this.done) this.stop();
    this.notify();
  }
  pause() {
    if (this.playing) this.stop();
    else if (!this.done) this.start();
    this.notify();
  }
  finish() { this.stop(); this.frame = LAST_FRAME; this.notify(); }
  setCheck(value: CheckColor) { this.check = value; this.notify(); }
  setStyle(value: ColorStyle) { this.style = value; this.notify(); }
  setScene(value: Scene) { this.scene = value; this.replay(); }
  dispose() { this.stop(); this.listeners.clear(); }
  private start() { this.timer = this.scheduler.every(() => this.step(), FRAME_MS); }
  private stop() { if (this.timer !== undefined) this.scheduler.cancel(this.timer); this.timer = undefined; }
  private notify() { for (const listener of this.listeners) listener(); }
}
