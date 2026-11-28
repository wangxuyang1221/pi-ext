import type { Theme } from "@earendil-works/pi-coding-agent";

export const CLAUDE_THEME_NAME = "claude-code";

export const CLAUDE_RGB = {
  terracotta: [222, 127, 93],
  terracottaBright: [246, 178, 144],
  terracottaMid: [235, 152, 118],
  modePurple: [184, 166, 232],
  bashPink: [234, 138, 184],
  gitPink: [245, 194, 231],
  brightWhite: [242, 242, 246],
} as const;

export function isClaudeTheme(theme: Pick<Theme, "name"> | undefined): boolean {
  return theme?.name === CLAUDE_THEME_NAME;
}

export function fgRgb(
  rgb: readonly [number, number, number],
  text: string,
  theme: Theme,
  fallback: "accent" | "warning" | "muted" | "text" | "bashMode" = "accent",
): string {
  if (theme.getColorMode() !== "truecolor") {
    return theme.fg(fallback, text);
  }
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m`;
}

/** Render Claude Code's left-to-right terracotta shimmer wave across a working verb. */
export function renderShimmerText(text: string, step: number, theme: Theme): string {
  if (theme.getColorMode() !== "truecolor") {
    return theme.fg("accent", text);
  }
  const chars = Array.from(text);
  const period = chars.length + 10;
  const center = (step % period) - 3;
  return chars.map((ch, index) => {
    const dist = Math.abs(index - center);
    const rgb =
      dist === 0
        ? CLAUDE_RGB.terracottaBright
        : dist === 1
          ? CLAUDE_RGB.terracottaMid
          : CLAUDE_RGB.terracotta;
    return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${ch}`;
  }).join("") + "\x1b[39m";
}
