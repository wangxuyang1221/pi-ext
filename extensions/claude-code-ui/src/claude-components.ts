import { userInfo } from "node:os";
import type { ContextUsage, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

import { bindingText } from "../../../shared/ui/keybinding-hints.js";
import {
  fitToWidth,
  formatHomePath,
  normalizeWidth,
  paintBackground,
  paintForeground,
} from "../../../shared/ui/layout.js";
import { CLAUDE_RGB, fgRgb, renderShimmerText } from "./claude-palette.js";

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const SIDE_INSET = 1;
const CLAUDE_PLACEHOLDER = 'Try "refactor retry backoff"';

const CLAWD_LINES = [
  " ▐▛███▜▌ ",
  "▝▜█████▛▘",
  "  ▘▘ ▝▝  ",
] as const;

export const CLAUDE_SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"] as const;
const CLAUDE_VERBS = [
  "Clauding…",
  "Cogitating…",
  "Synthesizing…",
  "Pondering…",
  "Channeling…",
  "Percolating…",
] as const;

function middleEllipsis(path: string, width: number): string {
  if (visibleWidth(path) <= width || width < 8) return path;
  const parts = path.split("/");
  let tail = parts.pop() ?? "";
  const head = parts.shift() ?? "";
  while (parts.length && visibleWidth(`${head}/…/${parts.at(-1)}/${tail}`) <= width) {
    tail = `${parts.pop()}/${tail}`;
  }
  const joined = `${head}/…/${tail}`;
  return visibleWidth(joined) <= width ? joined : `…${keepEnd(tail, width - 1)}`;
}

function keepEnd(text: string, width: number): string {
  const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(text), part => part.segment);
  const kept: string[] = [];
  let used = 0;
  for (let index = graphemes.length - 1; index >= 0; index--) {
    const segment = graphemes[index]!;
    const segmentWidth = visibleWidth(segment);
    if (used + segmentWidth > width) break;
    kept.push(segment);
    used += segmentWidth;
  }
  return kept.reverse().join("");
}

function centerText(text: string, width: number): string {
  const fitted = fitToWidth(text, width, { ellipsis: "…" });
  const w = visibleWidth(fitted);
  const left = Math.max(0, Math.floor((width - w) / 2));
  const right = Math.max(0, width - w - left);
  return `${" ".repeat(left)}${fitted}${" ".repeat(right)}`;
}

function splitRow(left: string, right: string, width: number, minGap = 2): string {
  const lw = visibleWidth(left);
  const rw = visibleWidth(right);
  if (rw === 0) return fitToWidth(left, width, { ellipsis: "…" });
  if (lw + minGap + rw <= width) {
    return left + " ".repeat(width - lw - rw) + right;
  }
  const roomForLeft = width - rw - minGap;
  if (roomForLeft >= 12) {
    const clippedLeft = fitToWidth(left, roomForLeft, { ellipsis: "…" });
    return clippedLeft + " ".repeat(Math.max(1, width - visibleWidth(clippedLeft) - rw)) + right;
  }
  return fitToWidth(left, width, { ellipsis: "…" });
}

export function resolveDisplayUser(): string | undefined {
  try {
    const name = userInfo().username?.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

export interface ClaudeHeaderInput {
  width: number;
  version: string;
  cwd: string;
  home?: string;
  userName?: string;
  modelId: string;
  thinking: string;
  branch: string | null;
  keybindings?: Pick<KeybindingsManager, "getKeys">;
  expandKey?: string;
  thinkingKey?: string;
  theme: Theme;
}

export function renderClaudeHeader(input: ClaudeHeaderInput): string[] {
  const safeWidth = normalizeWidth(input.width);
  if (safeWidth === 0) return [];

  const { theme, modelId, thinking, branch } = input;
  const expandKey = input.expandKey ?? bindingText(input.keybindings, "app.tools.expand");
  const thinkingKey = input.thinkingKey ?? bindingText(input.keybindings, "app.thinking.cycle");

  const pad = " ".repeat(SIDE_INSET);
  const boxWidth = Math.min(Math.max(0, safeWidth - SIDE_INSET * 2), 104);
  if (boxWidth < 34) {
    return [
      pad + fitToWidth(
        `${fgRgb(CLAUDE_RGB.terracotta, "✳", theme)} ${theme.bold("Claude Code")} ${theme.fg("dim", `v${input.version}`)}`,
        Math.max(1, safeWidth - SIDE_INSET * 2),
      ),
      "",
    ];
  }

  const border = (text: string) => fgRgb(CLAUDE_RGB.terracotta, text, theme, "accent");
  const inner = boxWidth - 2;
  const title = ` ${theme.bold(fgRgb(CLAUDE_RGB.terracotta, "Claude Code", theme))} ${theme.fg("dim", `v${input.version}`)} `;
  const titleW = visibleWidth(title);
  const topRightLen = Math.max(1, inner - 3 - titleW);
  const topLine = `${pad}${border("╭───")}${title}${border(`${"─".repeat(topRightLen)}╮`)}`;
  const bottomLine = `${pad}${border(`╰${"─".repeat(inner)}╯`)}`;

  const dir = formatHomePath(input.cwd, input.home);
  const greetName = input.userName ? ` ${input.userName}` : "";
  const welcome = theme.bold(fgRgb(CLAUDE_RGB.brightWhite, `Welcome back${greetName}!`, theme, "text"));
  const modelLine = `${theme.fg("muted", modelId)}${thinking !== "off" ? theme.fg("dim", ` · ${thinking}`) : ""}`;

  if (safeWidth < 78) {
    const colW = inner - 2;
    const row = (content: string) => `${pad}${border("│")} ${fitToWidth(content, colW, { pad: true, ellipsis: "…" })} ${border("│")}`;
    return [
      topLine,
      row(centerText(welcome, colW)),
      row(centerText(fgRgb(CLAUDE_RGB.terracotta, CLAWD_LINES[0], theme), colW)),
      row(centerText(fgRgb(CLAUDE_RGB.terracotta, CLAWD_LINES[1], theme), colW)),
      row(centerText(fgRgb(CLAUDE_RGB.terracotta, CLAWD_LINES[2], theme), colW)),
      row(centerText(modelLine, colW)),
      row(centerText(theme.fg("dim", middleEllipsis(dir, colW)), colW)),
      bottomLine,
      "",
    ];
  }

  const leftW = Math.min(34, Math.max(26, Math.floor((inner - 3) * 0.36)));
  const rightW = inner - leftW - 3;
  const leftRows = [
    centerText(welcome, leftW),
    "",
    centerText(fgRgb(CLAUDE_RGB.terracotta, CLAWD_LINES[0], theme), leftW),
    centerText(fgRgb(CLAUDE_RGB.terracotta, CLAWD_LINES[1], theme), leftW),
    centerText(fgRgb(CLAUDE_RGB.terracotta, CLAWD_LINES[2], theme), leftW),
    centerText(modelLine, leftW),
    centerText(theme.fg("dim", middleEllipsis(dir, leftW)), leftW),
  ];

  const tipTitle = theme.bold(fgRgb(CLAUDE_RGB.terracotta, "Tips for getting started", theme));
  const divider = theme.fg("borderMuted", "─".repeat(Math.max(8, rightW - 2)));
  const sessionTitle = theme.bold(fgRgb(CLAUDE_RGB.terracotta, "Session", theme));
  const branchLabel = branch
    ? `${theme.fg("dim", "git ")}${fgRgb(CLAUDE_RGB.gitPink, ` ${branch}`, theme, "accent")}`
    : theme.fg("dim", "no git branch");
  const cwdBrief = `${theme.fg("dim", "cwd ")}${theme.fg("muted", middleEllipsis(dir, Math.max(10, rightW - 6)))}`;

  const modelTip = thinkingKey
    ? `${theme.fg("muted", "Use ")}${theme.fg("text", "/model")}${theme.fg("muted", " to switch, ")}${theme.fg("text", thinkingKey)}${theme.fg("muted", " for thinking")}`
    : `${theme.fg("muted", "Use ")}${theme.fg("text", "/model")}${theme.fg("muted", " to switch")}`;
  const toolsTip = expandKey
    ? `${theme.fg("muted", "Press ")}${theme.fg("text", expandKey)}${theme.fg("muted", " to expand tools, ")}${theme.fg("text", "!")}${theme.fg("muted", " for bash")}`
    : `${theme.fg("muted", "Use ")}${theme.fg("text", "!")}${theme.fg("muted", " for bash")}`;

  const rightRows = [
    tipTitle,
    modelTip,
    toolsTip,
    divider,
    sessionTitle,
    cwdBrief,
    branchLabel,
  ];

  const sep = theme.fg("borderMuted", "│");
  const body = leftRows.map((left, idx) => {
    const l = fitToWidth(left, leftW, { pad: true, ellipsis: "…" });
    const r = fitToWidth(rightRows[idx] ?? "", rightW - 1, { pad: true, ellipsis: "…" });
    return `${pad}${border("│")} ${l} ${sep} ${r}${border("│")}`;
  });

  return [topLine, ...body, bottomLine, ""];
}

export function renderClaudeEditorFrame(
  lines: readonly string[],
  bottomBorderIndex: number,
  width: number,
  theme: Theme,
  empty: boolean,
  bashMode: boolean,
  reservedLeftCols = 0,
): string[] {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return [];

  const inner = Math.max(1, safeWidth - SIDE_INSET * 2);
  const pad = " ".repeat(SIDE_INSET);
  const rule = bashMode
    ? fgRgb(CLAUDE_RGB.bashPink, "─".repeat(inner), theme, "bashMode")
    : theme.fg("border", "─".repeat(inner));

  const output = [...lines];
  output[0] = `${pad}${rule}${pad}`;
  output[1] = injectClaudePrompt(output[1] ?? "", theme, empty, bashMode, reservedLeftCols);
  if (reservedLeftCols > 0) {
    const continuationPad = " ".repeat(reservedLeftCols);
    for (let i = 2; i < bottomBorderIndex; i++) {
      output[i] = `${continuationPad}${output[i] ?? ""}`;
    }
  }
  output[bottomBorderIndex] = `${pad}${rule}${pad}`;

  const fg = theme.getFgAnsi("text");
  return output.map((line, index) => {
    if (index > bottomBorderIndex) {
      return paintBackground(paintForeground(line, fg), safeWidth, theme.getBgAnsi("selectedBg"));
    }
    return fitToWidth(paintForeground(line, fg), safeWidth);
  });
}

function injectClaudePrompt(
  line: string,
  theme: Theme,
  showPlaceholder: boolean,
  bashMode: boolean,
  reservedLeftCols: number,
): string {
  // When the viewport is too narrow to reserve prompt columns, leave the host line intact
  // so tail characters and cursor are never clipped.
  if (reservedLeftCols === 0) {
    return line;
  }
  const glyph = bashMode
    ? theme.bold(fgRgb(CLAUDE_RGB.bashPink, "❯", theme, "bashMode"))
    : theme.bold(fgRgb(CLAUDE_RGB.brightWhite, "❯", theme, "text"));
  // Reserve 3 cols (` ❯ `) when editor paddingX is 0, or 2 cols (` ❯`) when paddingX >= 1
  // already supplies the separating space, keeping exact total width == safeWidth in both cases.
  const prompted = reservedLeftCols >= 3 ? ` ${glyph} ${line}` : ` ${glyph}${line}`;
  if (!showPlaceholder) return prompted;

  const prefix = prompted.trimEnd();
  const gap = " ".repeat(Math.max(0, 3 - visibleWidth(prefix)));
  return `${prefix}${gap}${theme.fg("dim", CLAUDE_PLACEHOLDER)}`;
}

export function renderClaudeWorking(
  elapsed: number,
  tokens: number,
  verbIndex: number,
  frameMs: number,
  theme: Theme,
  width: number,
  interruptKey = "",
): string[] {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return [];

  const tick = Math.floor(elapsed / frameMs);
  const glyph = CLAUDE_SPINNER_FRAMES[tick % CLAUDE_SPINNER_FRAMES.length]!;
  const verb = CLAUDE_VERBS[verbIndex % CLAUDE_VERBS.length]!;
  const spinner = fgRgb(CLAUDE_RGB.terracotta, glyph, theme, "accent");
  const shimmerVerb = renderShimmerText(verb, tick, theme);

  const timeText = elapsedLabel(elapsed);
  const detailParts: string[] = [];
  if (safeWidth >= 46 && interruptKey) detailParts.push(`${theme.fg("muted", interruptKey)}${theme.fg("dim", " to interrupt")}`);
  detailParts.push(theme.fg("dim", timeText));
  if (tokens > 0 && safeWidth >= 56) {
    detailParts.push(theme.fg("dim", `↓ ${formatTokenCount(tokens)} tokens`));
  } else if (safeWidth >= 56) {
    detailParts.push(theme.fg("dim", "thinking"));
  }

  const detail = `${theme.fg("dim", "(")}${detailParts.join(theme.fg("dim", " · "))}${theme.fg("dim", ")")}`;
  return [fitToWidth(` ${spinner} ${shimmerVerb} ${detail}`, safeWidth)];
}

export function claudeWorkingFrameKey(elapsed: number, frameMs: number, tokens: number): string {
  const tick = Math.floor(elapsed / frameMs);
  const seconds = Math.floor(elapsed / 1000);
  return `claude:${tick}:${seconds}:${tokens}`;
}

export interface ClaudeFooterInput {
  width: number;
  modelId: string;
  thinking: string;
  branch: string | null;
  contextPercent: number | null | undefined;
  rate?: string;
  bashMode: boolean;
  status?: string;
  keybindings?: Pick<KeybindingsManager, "getKeys">;
  theme: Theme;
}

export function renderClaudeFooter(input: ClaudeFooterInput): string[] {
  const safeWidth = normalizeWidth(input.width);
  if (safeWidth === 0) return [];

  const { theme, modelId, thinking, branch, contextPercent, rate, bashMode } = input;
  const thinkingKey = bindingText(input.keybindings, "app.thinking.cycle");
  const interruptKey = bindingText(input.keybindings, "app.interrupt", { shortEscape: true });
  const status = input.status ? stripTerminalSequences(input.status).replace(/\s+/gu, " ").trim() : undefined;

  const inner = Math.max(1, safeWidth - SIDE_INSET * 2);
  const pad = " ".repeat(SIDE_INSET);
  const compact = inner < 84;
  const sep = theme.fg("dim", " · ");

  let left: string;
  if (bashMode) {
    left = ` ${fgRgb(CLAUDE_RGB.bashPink, "! for bash mode", theme, "bashMode")}${compact || !interruptKey ? "" : theme.fg("dim", ` · ${interruptKey} to cancel`)}`;
  } else if (thinking === "off") {
    left = ` ${theme.fg("dim", thinkingKey ? `? for shortcuts · ${thinkingKey} thinking off` : "? for shortcuts · thinking off")}`;
  } else {
    const modeText = compact || !thinkingKey
      ? `⏵⏵ thinking: ${thinking}`
      : `⏵⏵ thinking: ${thinking} (${thinkingKey} to cycle)`;
    left = ` ${fgRgb(CLAUDE_RGB.modePurple, modeText, theme, "accent")}`;
  }

  const rightParts: string[] = [theme.fg("muted", modelId)];
  if (branch) {
    rightParts.push(fgRgb(CLAUDE_RGB.gitPink, ` ${branch}`, theme, "accent"));
  }
  if (contextPercent !== null && contextPercent !== undefined && Number.isFinite(contextPercent)) {
    const leftPct = Math.round(100 - Math.max(0, Math.min(100, contextPercent)));
    const ctxLabel = compact ? `${leftPct}%` : `Context left: ${leftPct}%`;
    const tone: "dim" | "warning" | "error" = leftPct <= 10 ? "error" : leftPct <= 25 ? "warning" : "dim";
    rightParts.push(theme.fg(tone, ctxLabel));
  }
  if (rate) {
    rightParts.push(theme.fg(rate === "-- t/s" ? "dim" : "muted", rate));
  }
  const right = `${rightParts.join(sep)} `;

  const lines = [fitToWidth(`${pad}${splitRow(left, right, inner, 2)}`, safeWidth)];
  if (status) lines.push(fitToWidth(theme.fg("muted", `${pad} ${status}`), safeWidth));
  return lines;
}

function elapsedLabel(elapsed: number): string {
  const total = Math.floor(elapsed / 1000);
  if (total < 60) return `${total}s`;
  const seconds = String(total % 60).padStart(2, "0");
  if (total < 3600) return `${Math.floor(total / 60)}m ${seconds}s`;
  return `${Math.floor(total / 3600)}h ${String(Math.floor(total / 60) % 60).padStart(2, "0")}m ${seconds}s`;
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
}

export type ClaudeContextUsage = Pick<ContextUsage, "percent">;
