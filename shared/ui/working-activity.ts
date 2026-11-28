import { ModelCalibration } from "./token-estimator.js";
import { TokenRate, type ModelCalibrationResolver } from "./token-rate.js";
export const WORKING_FRAME_MS = 80;

/** Keep task lifetime independent of the current model response. */
export class WorkingActivity {
  readonly calibration = new ModelCalibration();
  readonly rate: TokenRate;
  active = false;
  turnCount = 0;
  private started = 0;
  private streamedChars = 0;
  constructor(
    private readonly now = () => performance.now(),
    resolveCalibration?: ModelCalibrationResolver,
  ) {
    this.rate = new TokenRate(now, this.calibration, resolveCalibration);
  }
  start(): void {
    if (this.active) return;
    this.active = true;
    this.started = this.now();
    this.streamedChars = 0;
    this.turnCount += 1;
    this.rate.reset();
  }
  stop(): void {
    this.active = false;
    this.streamedChars = 0;
    this.rate.reset();
  }
  recordStreamDelta(chars: number): void {
    if (this.active && chars > 0) this.streamedChars += chars;
  }
  estimatedStreamTokens(): number {
    return Math.round(this.streamedChars / 4);
  }
  elapsed(): number { return Math.max(0, this.now() - this.started); }
  label(): string | undefined { return this.active ? this.rate.label() : undefined; }
}
