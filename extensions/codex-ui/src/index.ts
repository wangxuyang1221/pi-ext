import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerProfile, type UiOptions } from "../../../shared/ui/profile.js";
import { CodexEditor, CodexFooter, CodexHeader } from "./components.js";
import { codexTools } from "./tools.js";
import { Working, workingFrameKey } from "./working.js";
import { formatThinkingBlocks } from "./markdown.js";

export const CODEX_THEME_NAME = "codex-pi";
export type { UiOptions as CodexUiOptions };

export default function codexUiExtension(pi: ExtensionAPI, options: UiOptions = {}): void {
  registerProfile(pi, {
    themeName: CODEX_THEME_NAME,
    Header: CodexHeader,
    Editor: CodexEditor,
    Footer: CodexFooter,
    tools: codexTools,
    working: { widgetKey: "codex-ui-working", Working, frameKey: workingFrameKey },
    transformMarkdown: (markdown, context) => context.messageType === "assistant-thinking" ? formatThinkingBlocks(markdown) : markdown,
  }, options);
}
