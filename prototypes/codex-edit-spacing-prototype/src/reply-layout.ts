// PROTOTYPE: Install only inside the isolated lab process; never patch installed files.
import { AssistantMessageComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, type Component, type Container } from "@earendil-works/pi-tui";

export type ReplyStyle = "current" | "indented";

class ReplyBody implements Component {
  constructor(
    private inner: Component,
    private first: boolean,
    private getStyle: () => ReplyStyle,
    private getTheme: () => Theme,
  ) {}

  render(width: number): string[] {
    const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    if (!safeWidth) return [];
    if (this.getStyle() === "current") return this.inner.render(safeWidth);
    const indent = Math.min(2, safeWidth - 1);
    const lines = this.inner.render(safeWidth - indent);
    const firstVisible = this.first ? lines.findIndex(line => stripTerminalSequences(line).trim().length > 0) : -1;
    return lines.map((line, index) => {
      const prefix = index === firstVisible && indent > 0
        ? this.getTheme().fg("dim", "•") + " ".repeat(indent - 1)
        : " ".repeat(indent);
      return prefix + line;
    });
  }

  invalidate(): void { this.inner.invalidate(); }
}

export function installReplyLayout(getStyle: () => ReplyStyle, getTheme: () => Theme): { refresh(): void; dispose(): void } {
  const original = AssistantMessageComponent.prototype.updateContent;
  const rows = new Set<AssistantMessageComponent>();
  let disposed = false;
  const wrapped: typeof original = function (this: AssistantMessageComponent, message, isStreaming) {
    original.call(this, message, isStreaming);
    if (message.provider !== "spacing-ui-fixture") { rows.delete(this); return; }
    rows.add(this);
    // Pi 0.84.3 has no public assistant-component wrapper hook. This lab-only
    // adapter touches its component tree after the native renderer builds it.
    const container = (this as unknown as { contentContainer: Container }).contentContainer;
    let first = true;
    container.children = container.children.map(child => {
      // Native thinking Markdown has a defaultTextStyle; ordinary reply Markdown does not.
      if (!(child instanceof Markdown) || (child as unknown as { defaultTextStyle?: unknown }).defaultTextStyle) return child;
      const decorated = new ReplyBody(child, first, getStyle, getTheme);
      first = false;
      return decorated;
    });
  };
  AssistantMessageComponent.prototype.updateContent = wrapped;
  return {
    refresh() { if (!disposed) for (const row of rows) row.invalidate(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (AssistantMessageComponent.prototype.updateContent === wrapped) AssistantMessageComponent.prototype.updateContent = original;
      for (const row of rows) row.invalidate();
      rows.clear();
    },
  };
}
