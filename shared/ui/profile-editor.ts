import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, setKeybindings, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

const BOTTOM_BORDER_SENTINEL = "\x1b_pi:editor-bottom-border\x07";

export abstract class ProfileEditor extends CustomEditor {
  private capturingBottomBorder = false;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    private readonly hostKeybindings: KeybindingsManager,
    protected readonly getTheme: () => Theme,
    private readonly onCopy?: () => void,
    private readonly onBashModeChange?: (bashMode: boolean) => void,
  ) {
    super(tui, editorTheme, hostKeybindings, { paddingX: 1 });
  }

  isBashDraft(): boolean {
    return this.getText().trimStart().startsWith("!");
  }

  override setText(text: string): void {
    const beforeBash = this.isBashDraft();
    super.setText(text);
    const afterBash = this.isBashDraft();
    if (afterBash !== beforeBash) this.onBashModeChange?.(afterBash);
  }

  protected isEmptyDraft(): boolean {
    const nativeIsEmpty = (this as unknown as { isEditorEmpty?: () => boolean }).isEditorEmpty;
    return typeof nativeIsEmpty === "function" ? nativeIsEmpty.call(this) : this.getText() === "";
  }

  protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
    if (this.capturingBottomBorder) return BOTTOM_BORDER_SENTINEL;
    return super.renderBottomBorder(width, hiddenLineCount);
  }

  handleInput(data: string): void {
    const previousKeys = getKeybindings();
    setKeybindings(this.hostKeybindings);
    const submit = this.onSubmit;
    const beforeBash = this.isBashDraft();
    this.onSubmit = text => {
      if (text === "/copy" && this.onCopy) this.onCopy();
      else submit?.(text);
    };
    try {
      super.handleInput(data);
    } finally {
      this.onSubmit = submit;
      setKeybindings(previousKeys);
      const afterBash = this.isBashDraft();
      if (afterBash !== beforeBash) this.onBashModeChange?.(afterBash);
    }
  }

  protected sourceFrame(width: number): { lines: readonly string[]; bottomBorderIndex: number; menuHeight: number } {
    this.capturingBottomBorder = true;
    let lines: readonly string[];
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

}
