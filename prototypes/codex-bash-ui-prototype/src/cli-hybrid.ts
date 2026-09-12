// PROTOTYPE: Reuse frozen wrapping with a merged title and fixed metadata inset.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderBashGroup } from "./frozen-bash-group-layout.js";
import { fitToWidth } from "../../../extensions/codex-ui/src/layout.js";
import type { BashFixture } from "./fixtures.js";
import { fixtureGroup } from "./polish.js";

export function renderHybrid(rows: BashFixture[], expanded: boolean, theme: Theme, width: number): string[] {
  if (!rows.length) return [];
  const title = theme.fg("dim", expanded ? "▾ " : "▸ ") + theme.fg("toolTitle", theme.bold("Bash"));
  const group = fixtureGroup(rows);
  // Let commands use the entire terminal on very narrow screens.
  if (width < 32) return [fitToWidth(title, width), ...renderBashGroup(group, expanded, theme, width, "").slice(1)];
  const single = rows.length === 1;
  const offset = single ? 4 : 6;
  const inset = 2;
  // Reserve the margin before production wrapping, so expanded commands stay complete.
  const bodyWidth = width - offset - inset;
  const branches = ["  ├ ", "  ╰ "].map(branch => theme.fg("borderMuted", branch));
  const metadata = group.members.map((member, index) => {
    const duration = `${(rows[index]!.durationMs / 1000).toFixed(1)}s`;
    return member.status === "pending" ? theme.fg("dim", "queued")
      : member.status === "failed" ? theme.fg("warning", duration)
      : theme.fg("muted", duration.slice(0, -1)) + theme.fg("dim", "s");
  });
  return renderBashGroup(group, expanded, theme, bodyWidth, "").slice(1).map((line, index) => {
    // Undo the adaptive inset only on command metadata, never on output or tail clocks.
    if (bodyWidth >= 64 && branches.some(branch => line.startsWith(branch))) {
      const trimmed = line.trimEnd();
      const suffix = metadata.find(value => trimmed.endsWith(value));
      if (suffix) line = trimmed.slice(0, -suffix.length)
        + " ".repeat(bodyWidth - visibleWidth(trimmed)) + suffix + " ".repeat(inset);
    }
    if (index) return " ".repeat(offset) + line;
    const branch = theme.fg("borderMuted", single ? "  ╰ " : "  ├ ");
    return title + (single ? "  " : theme.fg("borderMuted", "  ┬ ")) + line.slice(branch.length);
  });
}
