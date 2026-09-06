import { LAST_FRAME, playbackRows, type Scene } from "./fixtures.js";

export class LabController {
  scene: Scene;
  frame: number | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(scene: Scene = "mixed") {
    this.scene = scene;
  }

  get playing(): boolean { return this.timer !== undefined; }
  get rows() { return playbackRows(this.scene, this.frame); }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  setScene(scene: Scene): void {
    this.stopTimer();
    this.scene = scene;
    this.frame = null;
    this.notify();
  }

  replay(): void {
    this.stopTimer();
    this.frame = 0;
    this.timer = setInterval(() => this.step(), 500);
    this.notify();
  }

  pause(): void {
    if (this.playing) this.stopTimer();
    else if (this.frame !== null && this.frame < LAST_FRAME) this.timer = setInterval(() => this.step(), 500);
    this.notify();
  }

  step(): void {
    this.frame = this.frame === null || this.frame >= LAST_FRAME ? 0 : this.frame + 1;
    if (this.frame >= LAST_FRAME) this.stopTimer();
    this.notify();
  }

  settle(): void {
    this.stopTimer();
    this.frame = null;
    this.notify();
  }

  dispose(): void {
    this.stopTimer();
    this.listeners.clear();
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
