import {
  CustomEditor,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  visibleWidth,
  type Component,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

import {
  fitToWidth,
  formatHomePath,
  normalizeWidth,
  paintBackground,
} from "./layout.js";

export { CodexFooter, type CodexFooterOptions } from "./footer.js";

export interface CodexHeaderOptions {
  version: string;
  cwd: string;
  home?: string;
  getModelId: () => string | undefined;
  getThinkingLevel: () => string;
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

  /** Decorate a source-coordinate editor projection without parsing rendered frame text. */
  renderProjectedLines(width: number, content: string[], menu: string[], _hiddenAbove: number, _hiddenBelow: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    const theme = this.getTheme();
    const body = [...content];
    if (body.length) body[0] = addPrompt(body[0], theme, this.getText().length === 0);
    const background = theme.getBgAnsi("selectedBg");
    return [" ".repeat(safeWidth), ...body, " ".repeat(safeWidth), ...menu]
      .map(line => paintBackground(line, safeWidth, background));
  }

  private sourceFrame(width: number): { lines: string[]; menuHeight: number } {
    let menuHeight = 0;
    if (this.isShowingAutocomplete()) {
      const wide = this.getLines().reduce((size, line) => Math.max(size, visibleWidth(line)), width) + 2 * this.getPaddingX() + 1;
      const unwrapped = super.render(wide);
      const bodyRows = Math.min(this.getLines().length, Math.max(5, Math.floor(this.tui.terminal.rows * 0.3)));
      menuHeight = unwrapped.length - bodyRows - 2;
    }
    return { lines: super.render(width), menuHeight };
  }

  /** Expose source/menu geometry for composed public editor projections. */
  renderSourceSurface(width: number): { nativeBodyRows: number; menu: string[] } {
    const { lines, menuHeight } = this.sourceFrame(width);
    return { nativeBodyRows: lines.length - menuHeight - 2, menu: menuHeight ? lines.slice(-menuHeight) : [] };
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const { lines, menuHeight } = this.sourceFrame(safeWidth);
    if (lines.length === 0) return [];

    const theme = this.getTheme();
    const bottomBorderIndex = lines.length - menuHeight - 1;
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
