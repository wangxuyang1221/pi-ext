import {
  CustomEditor,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  setKeybindings,
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
  paintForeground,
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

const MAX_CARD_WIDTH = 84;
const CARD_CHROME = "│  │".length;
const LABEL_WIDTH = "directory: ".length;
const MIN_CARD_INNER = 46;

export class CodexHeader implements Component {
  constructor(private readonly options: CodexHeaderOptions) {}

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const theme = this.options.getTheme();
    const brand = `${theme.bold(theme.fg("accent", "pi"))}${theme.fg("dim", ` v${this.options.version} · `)}${theme.fg("muted", "Codex profile")}`;
    if (safeWidth < 12) {
      return [fitToWidth(brand, safeWidth)];
    }

    const border = (text: string) => theme.fg("borderMuted", text);
    const modelId = this.options.getModelId() ?? "No model";
    const thinking = this.options.getThinkingLevel();
    const label = (text: string) => theme.fg("dim", text.padEnd(LABEL_WIDTH));
    const model = `${label("model:")}${theme.bold(modelId)} ${theme.fg("muted", thinking)}`;
    const modelHint = `${theme.fg("accent", "/model")} ${theme.fg("dim", "to change")}`;
    const directory = formatHomePath(this.options.cwd, this.options.home);
    const maxInner = Math.min(safeWidth, MAX_CARD_WIDTH) - CARD_CHROME;
    const pathRoom = maxInner - LABEL_WIDTH;
    const directoryLine = `${label("directory:")}${theme.bold(middleEllipsis(directory, pathRoom))}`;
    const hinted = visibleWidth(model) + 3 + visibleWidth(modelHint);
    const innerWidth = Math.min(maxInner, Math.max(visibleWidth(brand), hinted, visibleWidth(directoryLine), MIN_CARD_INNER));
    const modelLine = hinted <= innerWidth
      ? model + " ".repeat(innerWidth - visibleWidth(model) - visibleWidth(modelHint)) + modelHint
      : model;
    const frameLine = (content: string) => (
      `${border("│")} ${fitToWidth(content, innerWidth, { pad: true, ellipsis: "…" })} ${border("│")}`
    );

    return [
      border(`╭${"─".repeat(innerWidth + 2)}╮`),
      frameLine(brand),
      frameLine(""),
      frameLine(modelLine),
      frameLine(directoryLine),
      border(`╰${"─".repeat(innerWidth + 2)}╯`),
      "",
    ];
  }

  invalidate(): void {}
}

const PLACEHOLDER = "Ask Pi to do anything";

export class CodexEditor extends CustomEditor {
  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    private readonly hostKeybindings: KeybindingsManager,
    private readonly getTheme: () => Theme,
    private readonly onCopy?: () => void,
  ) {
    super(tui, editorTheme, hostKeybindings, { paddingX: 1 });
  }

  handleInput(data: string): void {
    const previousKeys = getKeybindings();
    setKeybindings(this.hostKeybindings);
    const submit = this.onSubmit;
    this.onSubmit = text => {
      if (text === "/copy" && this.onCopy) this.onCopy();
      else submit?.(text);
    };
    try {
      super.handleInput(data);
    } finally {
      this.onSubmit = submit;
      setKeybindings(previousKeys);
    }
  }

  /** Decorate a source-coordinate editor projection without parsing rendered frame text. */
  renderProjectedLines(width: number, content: string[], menu: string[], _hiddenAbove: number, _hiddenBelow: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    const theme = this.getTheme();
    const body = [...content];
    if (body.length) body[0] = addPrompt(body[0], theme, this.getText().length === 0);
    const background = theme.getBgAnsi("selectedBg");
    const foreground = theme.getFgAnsi("text");
    return [" ".repeat(safeWidth), ...body, emptyHint(safeWidth, theme, this.getText().length === 0 && menu.length === 0), ...menu]
      .map(line => paintBackground(paintForeground(line, foreground), safeWidth, background));
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
    const theme = this.getTheme();
    const bottomBorderIndex = lines.length - menuHeight - 1;
    const output = [...lines];
    // Native Editor always supplies two borders and at least one body row.
    output[0] = " ".repeat(safeWidth);
    output[bottomBorderIndex] = emptyHint(safeWidth, theme, this.getText().length === 0 && menuHeight === 0);
    output[1] = addPrompt(output[1], theme, this.getText().length === 0);

    const background = theme.getBgAnsi("selectedBg");
    const foreground = theme.getFgAnsi("text");
    return output.map((line) => paintBackground(paintForeground(line, foreground), safeWidth, background));
  }
}

function middleEllipsis(path: string, width: number): string {
  if (visibleWidth(path) <= width || width < 8) return path;
  const parts = path.split("/");
  let tail = parts.pop() ?? "";
  const head = parts.shift() ?? "";
  while (parts.length && visibleWidth(`${head}/…/${parts.at(-1)}/${tail}`) <= width) tail = `${parts.pop()}/${tail}`;
  const joined = `${head}/…/${tail}`;
  return visibleWidth(joined) <= width ? joined : `…${tail.slice(-(width - 1))}`;
}

const EMPTY_HINT = "/ for commands";

function emptyHint(width: number, theme: Theme, show: boolean): string {
  if (!show || width < 48) return " ".repeat(width);
  return " ".repeat(width - EMPTY_HINT.length - 2) + theme.fg("dim", EMPTY_HINT) + "  ";
}

function addPrompt(line: string, theme: Theme, showPlaceholder: boolean): string {
  const prompt = theme.bold(theme.fg("accent", "›"));
  let prompted = line.startsWith(" ")
    ? `${prompt}${line.slice(1)}`
    : `${prompt}${line}`;

  if (!showPlaceholder) return prompted;

  // Pi 1.3 uses cursor markers instead of a full ANSI reset around the empty cell.
  // Remove only right padding, preserving both the hardware and fake cursor markers.
  const prefix = prompted.trimEnd();
  const gap = " ".repeat(Math.max(0, 2 - visibleWidth(prefix)));
  return `${prefix}${gap}${theme.fg("dim", PLACEHOLDER)}`;
}
