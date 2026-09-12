// PROTOTYPE: Use the frozen pre-Claude renderer; replace only the two metadata regions.
import { truncateTail, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderBashGroup } from "./frozen-bash-group-layout.js";
import { renderBashGroup as renderOriginal } from "./original-bash-group-layout.js";
import type { BashGroup, BashStatus } from "./frozen-bash-types.js";
import { ToolRenderCache } from "../../../extensions/codex-ui/src/render-cache.js";
import { fitToWidth, normalizeWidth } from "../../../extensions/codex-ui/src/layout.js";
import type { BashFixture } from "./fixtures.js";

export const POLISH_VARIANTS = ["original", "type", "instrument", "keycap"] as const;
export type PolishVariant = typeof POLISH_VARIANTS[number];
export const POLISH_LABELS: Record<PolishVariant, string> = {
  original: "原版对照", type: "精细排印", instrument: "仪表式排版", keycap: "轻底色按键",
};

export function fixtureGroup(rows: BashFixture[]): BashGroup {
  const cache = new ToolRenderCache();
  const group: BashGroup = { timerKey: "polish-fixture", members: [], counts: { pending: 0, running: 0, completed: 0, failed: 0 }, running: new Set() };
  group.members = rows.map(row => {
    const status: BashStatus = row.status === "timeout" || row.status === "cancelled" ? "failed" : row.status;
    group.counts[status]++;
    return { id: row.id, group, cache: cache.scope(), command: row.command, commandRevision: 0, outputRevision: 0, status,
      // Freeze clocks at the fixture frame; the historical renderer formats them.
      startedAt: status === "pending" ? undefined : 0, endedAt: row.durationMs,
      details: row.truncated ? { truncation: truncateTail("omitted fixture line\ncaptured fixture tail", { maxLines: 1 }) } : undefined,
      get content() { return [{ type: "text", text: row.output.join("\n") }]; },
    };
  });
  group.members.filter(member => member.status === "running").forEach(member => group.running.add(member));
  return group;
}

export function renderPolish(group: BashGroup, expanded: boolean, theme: Theme, availableWidth: number, toggleHint: string, variant: PolishVariant): string[] {
  // The accepted historical variant runs the frozen renderer, not the ANSI adapter.
  if (variant === "keycap") {
    const keys = stripTerminalSequences(toggleHint).replace(/\s+(expand|collapse)$/u, "");
    return renderBashGroup(group, expanded, theme, availableWidth, keys);
  }
  const lines = renderOriginal(group, expanded, theme, availableWidth, toggleHint);
  if (variant === "original" || !lines.length) return lines;
  const width = normalizeWidth(availableWidth);
  const number = (value: number | string) => theme.fg("muted", String(value));
  const label = (value: string) => theme.fg("dim", value);
  const separator = theme.fg("borderMuted", "  ·  ");
  const metric = (value: number, text: string) => variant === "instrument"
    ? `${label(text)} ${number(value)}` : `${number(value)} ${label(text)}`;
  const counts = ([ ["completed", "succeeded"], ["failed", "failed"], ["running", "running"], ["pending", "queued"] ] as const)
    .flatMap(([status, text]) => group.counts[status] ? [metric(group.counts[status], text)] : []);
  const summary = [metric(group.members.length, group.members.length === 1 ? "command" : "commands"), ...counts]
    .join(variant === "instrument" ? "   " : separator);
  const title = `${width >= 8 ? "  " : ""}${theme.fg("toolTitle", theme.bold("Bash"))} ${theme.fg("dim", "· ")}${summary}`;
  const rawHint = stripTerminalSequences(toggleHint);
  const match = /^(.*?)\s+(expand|collapse)$/u.exec(rawHint);
  const hint = match ? `${number(match[1]!)} ${label(match[2]!)}` : label(rawHint);
  const gap = width - 2 - visibleWidth(title) - visibleWidth(hint);
  lines[0] = gap >= 3 ? title + " ".repeat(gap) + hint + "  " : fitToWidth(title, width, { ellipsis: "…" });

  // Locate only command starts, never output lines with duration-like text.
  // Keep the production preview, wrapping, prefix, and all output byte-for-byte.
  let cursor = 1;
  group.members.forEach((member, index) => {
    const mark = { pending: ["dim", "○"], running: ["accent", "◌"], completed: ["success", "✓"], failed: ["error", "×"] } as const;
    const [color, symbol] = mark[member.status];
    if (width < 64) return;
    const branch = index === group.members.length - 1 ? "  ╰ " : "  ├ ";
    const prefix = theme.fg("borderMuted", branch) + theme.fg(color, symbol) + " " + theme.fg("dim", "$ ");
    const lineIndex = lines.findIndex((line, position) => position >= cursor && line.startsWith(prefix));
    if (lineIndex < 0) return;
    cursor = lineIndex + 1;
    const duration = member.status === "pending" ? "queued" : member.startedAt === undefined ? ""
      : `${(Math.max(0, (member.endedAt ?? Date.now()) - member.startedAt) / 1000).toFixed(1)}s`;
    if (!duration || expanded && member.status === "running") return;
    const old = theme.fg(member.status === "failed" ? "warning" : "dim", duration);
    const line = lines[lineIndex]!;
    if (!line.endsWith(old)) return;
    const left = line.slice(0, -old.length);
    const space = / +$/u.exec(left)?.[0].length ?? 0;
    const inset = space >= 5 ? 2 : 0;
    const styled = member.status === "failed" ? old : duration === "queued" ? label(duration)
      : number(duration.slice(0, -1)) + label("s");
    lines[lineIndex] = left.slice(0, left.length - inset) + styled + " ".repeat(inset);
  });
  return lines;
}
