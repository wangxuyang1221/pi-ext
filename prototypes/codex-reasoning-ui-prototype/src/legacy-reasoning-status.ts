import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, type Component } from "@earendil-works/pi-tui";

export const REASONING_WIDGET_KEY = "codex-ui-reasoning";

export class ReasoningStatus implements Component {
  private title = "";
  private width = -1;
  private colors = "";
  private lines: string[] | undefined;
  private disposed = false;

  constructor(private getTheme: () => Theme, private requestRender: () => void) {}

  setTitle(title: string): void {
    if (this.disposed) return;
    const next = stripTerminalSequences(title).replace(/\s+/gu, " ").replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").trim();
    if (next === this.title) return;
    this.title = next;
    this.invalidate();
    this.requestRender();
  }

  invalidate(): void { this.lines = undefined; }

  render(width: number): string[] {
    const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    const theme = this.getTheme();
    const colors = theme.getFgAnsi("dim") + theme.getFgAnsi("muted");
    if (this.lines && this.width === safeWidth && this.colors === colors) return this.lines;
    this.width = safeWidth; this.colors = colors;
    this.lines = !this.title || !safeWidth ? [] : [
      truncateToWidth(`${theme.fg("dim", "•")} ${theme.fg("muted", this.title)}`, safeWidth, "…"),
      "",
    ];
    return this.lines;
  }

  dispose(): void { this.disposed = true; this.title = ""; this.invalidate(); }
}
