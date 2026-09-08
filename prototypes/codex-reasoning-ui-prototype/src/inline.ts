// PROTOTYPE: Keep one live summary in the native thinking slot, with no editor widget.
import type { ExtensionAPI, ExtensionContext, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import { REASONING_WIDGET_KEY } from "./legacy-reasoning-status.js";

function inlineSummary(markdown: string, width: number): string {
  // The host joins consecutive thinking blocks before this display-only hook.
  // Scan small fixture snapshots; keep the same rule for streaming and final renders.
  const titles = [...markdown.matchAll(/(?:^|\n)[ \t]*\*\*([^*\r\n]+)\*\*[ \t]*(?=\r?$|\n)/gmu)];
  const title = titles.at(-1)?.[1];
  if (!title) return "";
  const clean = stripTerminalSequences(title).replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
  const line = truncateToWidth(`• ${clean}`, Math.max(0, Math.floor(width)), "…");
  // Pi also recognizes escaped brackets as LaTeX delimiters. Use a literal code span
  // for those uncommon titles; ordinary fixture titles retain native thinking styling.
  if (/[\[\]()\\]/u.test(line)) {
    const ticks = "`".repeat(Math.max(0, ...[...line.matchAll(/`+/gu)].map(match => match[0].length)) + 1);
    return `${ticks} ${line} ${ticks}`;
  }
  // Escape after measuring plain text so native Markdown cannot add formatting.
  return line.replace(/[\\`*_{}#+.!<>|~=-]/gu, "\\$&");
}

export default function inlineCodexUi(pi: ExtensionAPI): void {
  codexUi(new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerMarkdownTransformer") return (transformer: MarkdownTransformer) => {
        target.registerMarkdownTransformer((markdown, context) => context.messageType === "assistant-thinking"
          ? inlineSummary(markdown, context.availableWidth) : transformer(markdown, context));
      };
      if (property === "on") return (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
        const register = target.on as (name: string, handler: unknown) => void;
        register(name, name !== "session_start" ? handler : (event: unknown, ctx: ExtensionContext) => handler(event, {
          ...ctx,
          ui: new Proxy(ctx.ui, {
            get(ui, key, uiReceiver) {
              if (key === "setWidget") return (...args: Parameters<typeof ui.setWidget>) => {
                if (args[0] !== REASONING_WIDGET_KEY) ui.setWidget(...args);
              };
              return Reflect.get(ui, key, uiReceiver);
            },
          }),
        }));
      };
      return Reflect.get(target, property, receiver);
    },
  }));
}
