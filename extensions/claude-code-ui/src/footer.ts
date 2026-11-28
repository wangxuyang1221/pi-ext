import type { FooterOptions } from "../../../shared/ui/ui-options.js";
import { sanitizeStatus } from "../../../shared/ui/footer-status.js";
import type { Component } from "@earendil-works/pi-tui";
import { normalizeWidth } from "../../../shared/ui/layout.js";
import { renderClaudeFooter } from "./claude-components.js";

export class ClaudeFooter implements Component {
  private unsubscribeBranch?: () => void;
  constructor(private readonly options: FooterOptions) {}

  setBranchSubscription(unsubscribe: () => void): void {
    this.unsubscribeBranch?.();
    this.unsubscribeBranch = unsubscribe;
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    const theme = this.options.getTheme();
    const statuses = this.options.getExtensionStatuses();
    const rate = this.options.getRate?.();
    const status = sanitizeStatus(statuses.get("status") ?? "");
    return renderClaudeFooter({
      width: safeWidth,
      modelId: this.options.getModelId() ?? "No model",
      thinking: this.options.getThinkingLevel(),
      branch: this.options.getBranch(),
      contextPercent: this.options.getContextUsage()?.percent,
      rate,
      bashMode: this.options.isBashMode?.() ?? false,
      status,
      keybindings: this.options.getKeybindings?.(),
      theme,
    });
  }

  invalidate(): void {}

  dispose(): void {
    this.unsubscribeBranch?.();
    this.unsubscribeBranch = undefined;
  }
}
