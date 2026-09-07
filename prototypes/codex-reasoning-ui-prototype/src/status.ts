// PROTOTYPE: A width-aware, event-driven status row on Pi's public widget surface.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";

export class ReasoningStatus implements Component {
  private title = "";
  private cachedWidth = -1;
  private cachedLines: string[] | undefined;

  constructor(private getTheme: () => Theme, private requestRender: () => void) {}

  setTitle(title: string): void {
    const next = title.replace(/\s+/gu, " ").trim();
    if (next === this.title) return;
    this.title = next;
    this.invalidate();
    this.requestRender();
  }

  invalidate(): void {
    this.cachedWidth = -1;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    if (this.cachedLines && this.cachedWidth === safeWidth) return this.cachedLines;
    const theme = this.getTheme();
    this.cachedWidth = safeWidth;
    this.cachedLines = !this.title || safeWidth === 0 ? [] : [truncateToWidth(
      `${theme.fg("dim", "•")} ${theme.fg("muted", this.title)}`,
      safeWidth, "…",
    ), ""];
    return this.cachedLines;
  }
}

/** Read a closed title only; incomplete token fragments never become a status label. */
export function extractTitle(markdown: string): string | undefined {
  const match = markdown.match(/\*\*([^*]+)\*\*/u);
  return match?.[1]?.replace(/\s+/gu, " ").trim() || undefined;
}

/** Keep completed content, without repeating a leading status title above its body. */
export function historyMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "";
  const leading = trimmed.match(/^\*\*[^*]+\*\*\r?\n([\s\S]*)$/u);
  const body = leading?.[1]?.trim() || (trimmed.startsWith("**") && !trimmed.slice(2).includes("**")
    ? trimmed.slice(2).trim() : trimmed);
  if (!body) return "";
  // A literal bullet inherits thinkingText, unlike the frozen baseline's code-span marker.
  return `• ${body}`;
}
