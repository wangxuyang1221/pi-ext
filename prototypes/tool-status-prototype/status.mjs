export const STATUS_GLYPH = "⏺";

/** Resolve fixture cancellation state per member, not from a group's first row. */
export function memberTheme(theme, id, status) {
  return theme.prototypeForTool?.(id, status) ?? theme;
}

export function marker(theme, tone) {
  return theme.fg(tone === "dim" ? "warning" : tone, STATUS_GLYPH);
}
