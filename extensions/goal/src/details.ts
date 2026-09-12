import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, stripTerminalSequences, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
export type GoalDetailAction = "pause" | "resume";
/** Scrollable, immutable opening snapshot. No timer and no storage access. */
export class GoalDetails implements Component {
  private offset = 0;
  private rows = 1;
  private cached: { width: number; lines: string[] } | undefined;
  constructor(
    private readonly body: string,
    private readonly actions: { pause: boolean; resume: boolean },
    private readonly getTheme: () => Theme,
    private readonly height: () => number,
    private readonly done: (action: GoalDetailAction | undefined) => void,
    private readonly refresh: () => void,
  ) {}
  render(width: number): string[] {
    if (width < 1) return [];
    const theme = this.getTheme();
    if (this.cached?.width !== width) this.cached = {
      width,
      lines: wrapTextWithAnsi(stripTerminalSequences(this.body).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " "), Math.max(1, width - 2)),
    };
    this.rows = Math.max(1, this.height() - 5);
    this.offset = Math.min(this.offset, Math.max(0, this.cached.lines.length - this.rows));
    const hints = [this.actions.pause ? "[p] Pause" : "", this.actions.resume ? "[r] Resume" : "", "[esc] Close"].filter(Boolean).join("   ");
    return [
      ` ${theme.bold("Goal details")} ${theme.fg("dim", "· opening snapshot")}`,
      theme.fg("dim", " Reopen to refresh exact time. ↑↓ / PgUp / PgDn to scroll."),
      "",
      ...this.cached.lines.slice(this.offset, this.offset + this.rows).map(line => ` ${line}`),
      "",
      ` ${theme.fg("accent", hints)}`,
    ].map(line => truncateToWidth(line, width, "…"));
  }
  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "enter")) { this.done(undefined); return; }
    if (data === "p" && this.actions.pause) { this.done("pause"); return; }
    if (data === "r" && this.actions.resume) { this.done("resume"); return; }
    const previous = this.offset;
    if (matchesKey(data, "down")) this.offset++;
    else if (matchesKey(data, "up")) this.offset--;
    else if (matchesKey(data, "pageDown")) this.offset += this.rows;
    else if (matchesKey(data, "pageUp")) this.offset -= this.rows;
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, (this.cached?.lines.length ?? 0) - this.rows)));
    if (previous !== this.offset) this.refresh();
  }
  invalidate(): void { this.cached = undefined; }
}
