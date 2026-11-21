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
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const BOTTOM_BORDER_SENTINEL = "\x1b_pi:codex-editor-bottom-border\x07";

export class CodexHeader implements Component {
  private cached: {
    width: number;
    theme: Theme;
    modelId: string;
    thinking: string;
    lines: string[];
  } | undefined;

  constructor(private readonly options: CodexHeaderOptions) {}

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const theme = this.options.getTheme();
    const modelId = this.options.getModelId() ?? "No model";
    const thinking = this.options.getThinkingLevel();
    const cached = this.cached;
    if (
      cached
      && cached.width === safeWidth
      && cached.theme === theme
      && cached.modelId === modelId
      && cached.thinking === thinking
    ) {
      return cached.lines;
    }

    const brand = `${theme.bold(theme.fg("accent", "pi"))}${theme.fg("dim", ` v${this.options.version} · `)}${theme.fg("muted", "Codex profile")}`;
    if (safeWidth < 12) {
      const lines = [fitToWidth(brand, safeWidth)];
      this.cached = { width: safeWidth, theme, modelId, thinking, lines };
      return lines;
    }

    const border = (text: string) => theme.fg("borderMuted", text);
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

    const lines = [
      border(`╭${"─".repeat(innerWidth + 2)}╮`),
      frameLine(brand),
      frameLine(""),
      frameLine(modelLine),
      frameLine(directoryLine),
      border(`╰${"─".repeat(innerWidth + 2)}╯`),
      "",
    ];
    this.cached = { width: safeWidth, theme, modelId, thinking, lines };
    return lines;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}

const PLACEHOLDER = "Ask Pi to do anything";

export class CodexEditor extends CustomEditor {
  private capturingBottomBorder = false;
  private paintedCache: {
    width: number;
    foreground: string;
    background: string;
    lines: Map<string, string>;
  } | undefined;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    private readonly hostKeybindings: KeybindingsManager,
    private readonly getTheme: () => Theme,
    private readonly onCopy?: () => void,
  ) {
    super(tui, editorTheme, hostKeybindings, { paddingX: 1 });
  }

  private isEmptyDraft(): boolean {
    const nativeIsEmpty = (this as unknown as { isEditorEmpty?: () => boolean }).isEditorEmpty;
    return typeof nativeIsEmpty === "function" ? nativeIsEmpty.call(this) : this.getText() === "";
  }

  override invalidate(): void {
    this.paintedCache = undefined;
    super.invalidate();
  }

  protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
    if (this.capturingBottomBorder) return BOTTOM_BORDER_SENTINEL;
    return super.renderBottomBorder(width, hiddenLineCount);
  }

  private paintFrame(lines: readonly string[], width: number, theme: Theme): string[] {
    const background = theme.getBgAnsi("selectedBg");
    const foreground = theme.getFgAnsi("text");
    const previous = this.paintedCache;
    const reusable = previous
      && previous.width === width
      && previous.foreground === foreground
      && previous.background === background
      ? previous.lines
      : undefined;
    const next = new Map<string, string>();
    const painted = lines.map((line) => {
      let result = reusable?.get(line) ?? next.get(line);
      if (result === undefined) {
        result = paintBackground(paintForeground(line, foreground), width, background);
      }
      next.set(line, result);
      return result;
    });
    this.paintedCache = { width, foreground, background, lines: next };
    return painted;
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
    const empty = this.isEmptyDraft();
    const body = [...content];
    if (body.length) body[0] = addPrompt(body[0], theme, empty);
    return this.paintFrame(
      [" ".repeat(safeWidth), ...body, emptyHint(safeWidth, theme, empty && menu.length === 0), ...menu],
      safeWidth,
      theme,
    );
  }

  private sourceFrame(width: number): { lines: string[]; bottomBorderIndex: number; menuHeight: number } {
    this.capturingBottomBorder = true;
    let lines: string[];
    try {
      lines = super.render(width);
    } finally {
      this.capturingBottomBorder = false;
    }
    const markerIndex = lines.lastIndexOf(BOTTOM_BORDER_SENTINEL);
    const bottomBorderIndex = markerIndex >= 0 ? markerIndex : lines.length - 1;
    const menuHeight = Math.max(0, lines.length - 1 - bottomBorderIndex);
    return { lines, bottomBorderIndex, menuHeight };
  }

  /** Expose source/menu geometry for composed public editor projections. */
  renderSourceSurface(width: number): { nativeBodyRows: number; menu: string[] } {
    const { lines, bottomBorderIndex, menuHeight } = this.sourceFrame(width);
    return {
      nativeBodyRows: Math.max(0, bottomBorderIndex - 1),
      menu: menuHeight ? lines.slice(bottomBorderIndex + 1) : [],
    };
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const { lines, bottomBorderIndex, menuHeight } = this.sourceFrame(safeWidth);
    const theme = this.getTheme();
    const empty = this.isEmptyDraft();
    const output = [...lines];
    // Native Editor always supplies two borders and at least one body row.
    output[0] = " ".repeat(safeWidth);
    output[bottomBorderIndex] = emptyHint(safeWidth, theme, empty && menuHeight === 0);
    output[1] = addPrompt(output[1], theme, empty);

    return this.paintFrame(output, safeWidth, theme);
  }
}

function middleEllipsis(path: string, width: number): string {
  if (visibleWidth(path) <= width || width < 8) return path;
  const parts = path.split("/");
  let tail = parts.pop() ?? "";
  const head = parts.shift() ?? "";
  while (parts.length && visibleWidth(`${head}/…/${parts.at(-1)}/${tail}`) <= width) tail = `${parts.pop()}/${tail}`;
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
