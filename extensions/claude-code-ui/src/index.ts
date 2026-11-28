import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerProfile, type UiOptions } from "../../../shared/ui/profile.js";
import { ClaudeEditor, ClaudeFooter, ClaudeHeader } from "./components.js";
import { claudeTools } from "./tools.js";
import { Working, workingFrameKey } from "./working.js";
import { registerClaudeGenericToolRenderer } from "./claude-tools.js";
import { formatMarkdown } from "./markdown.js";

export const CLAUDE_THEME_NAME = "claude-code";
export type { UiOptions as ClaudeUiOptions };

export default function claudeUiExtension(pi: ExtensionAPI, options: UiOptions = {}): void {
  registerProfile(pi, {
    themeName: CLAUDE_THEME_NAME,
    Header: ClaudeHeader,
    Editor: ClaudeEditor,
    Footer: ClaudeFooter,
    tools: claudeTools,
    working: { widgetKey: "claude-code-ui-working", Working, frameKey: workingFrameKey },
    registerToolRenderers: registerClaudeGenericToolRenderer,
    transformMarkdown: formatMarkdown,
    hiddenThinkingLabel: toggleKey => (toggleKey ? `∴ Thinking… (${toggleKey} to expand)` : "∴ Thinking…"),
  }, options);
}
