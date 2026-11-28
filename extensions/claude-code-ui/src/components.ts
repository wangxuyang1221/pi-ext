import { type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { ProfileEditor } from "../../../shared/ui/profile-editor.js";
import type { HeaderOptions } from "../../../shared/ui/ui-options.js";
import { normalizeWidth } from "../../../shared/ui/layout.js";
import { bindingText } from "../../../shared/ui/keybinding-hints.js";
import { renderClaudeEditorFrame, renderClaudeHeader, resolveDisplayUser } from "./claude-components.js";
export { ClaudeFooter } from "./footer.js";

export class ClaudeHeader implements Component {
  private readonly userName: string | undefined;
  private cached: {
    width: number;
    theme: Theme;
    modelId: string;
    thinking: string;
    branch: string | null;
    expandKey: string;
    thinkingKey: string;
    lines: string[];
  } | undefined;

  constructor(private readonly options: HeaderOptions) {
    this.userName = options.userName ?? resolveDisplayUser();
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const theme = this.options.getTheme();
    const modelId = this.options.getModelId() ?? "No model";
    const thinking = this.options.getThinkingLevel();
    const branch = this.options.getBranch?.() ?? null;
    const keybindings = this.options.getKeybindings?.();
    const expandKey = bindingText(keybindings, "app.tools.expand");
    const thinkingKey = bindingText(keybindings, "app.thinking.cycle");
    const cached = this.cached;
    if (
      cached
      && cached.width === safeWidth
      && cached.theme === theme
      && cached.modelId === modelId
      && cached.thinking === thinking
      && cached.branch === branch
      && cached.expandKey === expandKey
      && cached.thinkingKey === thinkingKey
    ) {
      return cached.lines;
    }

    const lines = renderClaudeHeader({
      width: safeWidth,
      version: this.options.version,
      cwd: this.options.cwd,
      home: this.options.home,
      userName: this.userName,
      modelId,
      thinking,
      branch,
      keybindings,
      expandKey,
      thinkingKey,
      theme,
    });
    this.cached = { width: safeWidth, theme, modelId, thinking, branch, expandKey, thinkingKey, lines };
    return lines;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}

export class ClaudeEditor extends ProfileEditor {
  private lastClaudeReservedCols = 0;
  private lastClaudeBottomBorderIndex = 0;

  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const reserved = this.lastClaudeReservedCols;
    if (reserved > 0) {
      const innerWidth = Math.max(1, event.width - reserved);
      if (event.y >= 1 && event.y < this.lastClaudeBottomBorderIndex) {
        return super.handleMouse({
          ...event,
          x: Math.max(0, event.x - reserved),
          width: innerWidth,
        });
      }
      if (event.y > this.lastClaudeBottomBorderIndex) {
        return super.handleMouse({ ...event, width: innerWidth });
      }
    }
    return super.handleMouse(event);
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const theme = this.getTheme();
    const empty = this.isEmptyDraft();
    const editorPaddingX = typeof (this as unknown as { getPaddingX?: () => number }).getPaddingX === "function"
      ? (this as unknown as { getPaddingX: () => number }).getPaddingX()
      : 1;
    const reservedLeftCols = safeWidth > 6 ? (editorPaddingX === 0 ? 3 : 2) : 0;
    const { lines, bottomBorderIndex } = this.sourceFrame(Math.max(1, safeWidth - reservedLeftCols));
    this.lastClaudeReservedCols = reservedLeftCols;
    this.lastClaudeBottomBorderIndex = bottomBorderIndex;
    return renderClaudeEditorFrame(
      lines,
      bottomBorderIndex,
      safeWidth,
      theme,
      empty,
      this.isBashDraft(),
      reservedLeftCols,
    );
  }
}
