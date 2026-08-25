import {
  CustomEditor,
  type ContextUsage,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  visibleWidth,
  type Component,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

import {
  fitSegments,
  fitToWidth,
  formatContextLeft,
  formatHomePath,
  normalizeWidth,
  paintBackground,
  type PrioritizedSegment,
} from "./layout.js";

export interface CodexHeaderOptions {
  version: string;
  cwd: string;
  home?: string;
  getModelId: () => string | undefined;
  getThinkingLevel: () => string;
  getTheme: () => Theme;
}

export interface CodexFooterOptions {
  cwd: string;
  home?: string;
  getModelId: () => string | undefined;
  getThinkingLevel: () => string;
  getContextUsage: () => Pick<ContextUsage, "percent"> | undefined;
  getExtensionStatuses: () => ReadonlyMap<string, string>;
  getTheme: () => Theme;
}

export class CodexHeader implements Component {
  constructor(private readonly options: CodexHeaderOptions) {}

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const theme = this.options.getTheme();
    const brand = `${theme.bold(theme.fg("accent", "pi"))}${theme.fg("dim", ` v${this.options.version} · Codex profile`)}`;
    if (safeWidth < 12) {
      return [fitToWidth(brand, safeWidth)];
    }

    const frameWidth = Math.min(safeWidth, 84);
    const innerWidth = frameWidth - 2;
    const border = (text: string) => theme.fg("borderMuted", text);
    const frameLine = (content: string) => (
      `${border("│")}${fitToWidth(content, innerWidth, { pad: true })}${border("│")}`
    );

    const modelId = this.options.getModelId() ?? "No model";
    const thinking = this.options.getThinkingLevel();
    let modelLine = `${theme.fg("dim", "model: ")}${theme.bold(modelId)}${theme.fg("muted", ` · ${thinking}`)}`;
    const modelHint = `${theme.fg("accent", "/model")} ${theme.fg("dim", "to change")}`;
    if (visibleWidth(modelLine) + visibleWidth(modelHint) + 2 <= innerWidth) {
      modelLine += `${" ".repeat(innerWidth - visibleWidth(modelLine) - visibleWidth(modelHint))}${modelHint}`;
    }

    const directory = formatHomePath(this.options.cwd, this.options.home);
    const directoryLine = `${theme.fg("dim", "directory: ")}${theme.bold(directory)}`;

    return [
      border(`┌${"─".repeat(innerWidth)}┐`),
      frameLine(brand),
      frameLine(""),
      frameLine(modelLine),
      frameLine(directoryLine),
      border(`└${"─".repeat(innerWidth)}┘`),
    ];
  }

  invalidate(): void {}
}

export class CodexFooter implements Component {
  constructor(private readonly options: CodexFooterOptions) {}

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const theme = this.options.getTheme();
    const modelId = this.options.getModelId() ?? "No model";
    const thinking = this.options.getThinkingLevel();
    const context = formatContextLeft(this.options.getContextUsage());
    const statuses = [...this.options.getExtensionStatuses().values()]
      .filter((status) => status.trim().length > 0);

    const segments: PrioritizedSegment[] = [
      {
        text: theme.fg("warning", `${modelId} ${thinking}`),
        priority: 90,
      },
      {
        text: theme.fg("success", formatHomePath(this.options.cwd, this.options.home)),
        priority: 40,
      },
    ];
    if (context) {
      segments.push({ text: theme.fg("warning", context), priority: 60 });
    }
    for (const status of statuses) {
      segments.push({ text: status, priority: 100 });
    }

    const leftPadding = safeWidth > 1 ? " " : "";
    const contentWidth = safeWidth - visibleWidth(leftPadding);
    const separator = theme.fg("dim", " · ");
    const content = fitSegments(segments, contentWidth, separator);
    return [fitToWidth(`${leftPadding}${content}`, safeWidth)];
  }

  invalidate(): void {}
}

const PLACEHOLDER = "Ask Pi to do anything";
const FULL_RESET = "\x1b[0m";

export class CodexEditor extends CustomEditor {
  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly getTheme: () => Theme,
  ) {
    super(tui, editorTheme, keybindings, { paddingX: 1 });
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const lines = super.render(safeWidth);
    if (lines.length === 0) return [];

    const theme = this.getTheme();
    const bottomBorderIndex = findBottomBorderIndex(lines, this.isShowingAutocomplete());
    const output = [...lines];
    output[0] = " ".repeat(safeWidth);
    if (bottomBorderIndex !== undefined) {
      output[bottomBorderIndex] = " ".repeat(safeWidth);
    }

    if (output.length > 1 && bottomBorderIndex !== 1) {
      output[1] = addPrompt(
        output[1] ?? "",
        theme,
        this.getText().length === 0,
      );
    }

    const background = theme.getBgAnsi("selectedBg");
    return output.map((line) => paintBackground(line, safeWidth, background));
  }
}

function addPrompt(line: string, theme: Theme, showPlaceholder: boolean): string {
  const prompt = theme.fg("muted", "›");
  let prompted = line.startsWith(" ")
    ? `${prompt}${line.slice(1)}`
    : `${prompt}${line}`;

  if (!showPlaceholder) return prompted;

  const resetIndex = prompted.indexOf(FULL_RESET);
  const placeholder = theme.fg("dim", PLACEHOLDER);
  if (resetIndex === -1) {
    return `${prompted}${placeholder}`;
  }

  const insertionPoint = resetIndex + FULL_RESET.length;
  prompted = `${prompted.slice(0, insertionPoint)}${placeholder}${prompted.slice(insertionPoint)}`;
  return prompted;
}

function findBottomBorderIndex(
  lines: readonly string[],
  autocompleteVisible: boolean,
): number | undefined {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    const plain = stripTerminalSequences(lines[index] ?? "");
    if (/^─+$/u.test(plain) || /^─── [↑↓] \d+ more /u.test(plain)) {
      return index;
    }
  }

  return autocompleteVisible ? undefined : Math.max(1, lines.length - 1);
}
