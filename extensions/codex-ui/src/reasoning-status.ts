import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { stripTerminalSequences, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { ReasoningTitle } from "./reasoning-title.js";

export const REASONING_WIDGET_KEY = "codex-ui-reasoning";

export class ReasoningStatus implements Component {
  private title = "";
  private width = -1;
  private colors = "";
  private lines: string[] | undefined;
  private disposed = false;

  constructor(private getTheme: () => Theme, private requestRender: () => void) {}

  setTitle(title: string): void {
    if (this.disposed) return;
    const next = stripTerminalSequences(title).replace(/\s+/gu, " ").replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").trim();
    if (next === this.title) return;
    this.title = next;
    this.invalidate();
    this.requestRender();
  }

  invalidate(): void { this.lines = undefined; }

  render(width: number): string[] {
    const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    const theme = this.getTheme();
    const colors = theme.getFgAnsi("dim") + theme.getFgAnsi("muted");
    if (this.lines && this.width === safeWidth && this.colors === colors) return this.lines;
    this.width = safeWidth; this.colors = colors;
    this.lines = !this.title || !safeWidth ? [] : [
      truncateToWidth(`${theme.fg("dim", "•")} ${theme.fg("muted", this.title)}`, safeWidth, "…"),
      "",
    ];
    return this.lines;
  }

  dispose(): void { this.disposed = true; this.title = ""; this.invalidate(); }
}

export function registerReasoningStatus(pi: ExtensionAPI): (ctx: ExtensionContext) => void {
  let status: ReasoningStatus | undefined;
  let active = false;
  let label = "";
  // Public events contain shallow message snapshots, not a stable object or message ID.
  let message: Pick<AssistantMessage, "timestamp" | "provider" | "model" | "api"> | undefined;
  const title = new ReasoningTitle();
  let contentIndex = -1;

  const show = (next: string): void => {
    if (next === label) return;
    label = next; status?.setTitle(next);
  };
  const clearMessage = (): void => { message = undefined; contentIndex = -1; title.reset(); };
  const clear = (): void => {
    active = false; clearMessage();
    show("");
  };
  const isCurrent = (next: AssistantMessage): boolean => active && message !== undefined
    && next.timestamp === message.timestamp && next.provider === message.provider
    && next.model === message.model && next.api === message.api;

  pi.on("agent_start", () => { clear(); active = status !== undefined; });
  pi.on("message_start", (event) => {
    if (!active || event.message.role !== "assistant") return;
    clearMessage();
    const { timestamp, provider, model, api } = event.message;
    message = { timestamp, provider, model, api };
    show("");
  });
  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant" || !isCurrent(event.message)) return;
    const update = event.assistantMessageEvent;
    if ("contentIndex" in update) {
      if (update.contentIndex < contentIndex) return;
      if (contentIndex !== update.contentIndex || update.type === "thinking_start") title.reset();
      contentIndex = update.contentIndex;
    }
    if (update.type === "thinking_delta" || update.type === "thinking_start") {
      const block = event.message.content[update.contentIndex];
      const next = block?.type === "thinking" ? title.read(block.thinking, update.type === "thinking_delta" ? update.delta : undefined) : undefined;
      show(next || "");
    } else if (update.type === "text_start" || update.type === "text_delta" || update.type === "toolcall_start") {
      title.reset(); show("");
    }
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant" || !isCurrent(event.message)) return;
    clearMessage(); show("");
  });
  // agent_end clears old labels before the host's retry/compaction loaders take over.
  pi.on("agent_end", clear);
  pi.on("agent_settled", clear);
  pi.on("session_before_compact", clear);
  pi.on("session_tree", clear);
  pi.on("session_shutdown", (_event, ctx) => {
    clear(); status?.dispose(); status = undefined;
    if (ctx.mode === "tui") ctx.ui.setWidget(REASONING_WIDGET_KEY, undefined);
  });
  return (ctx) => {
    clear(); status?.dispose(); status = undefined;
    if (ctx.mode !== "tui") return;
    ctx.ui.setWorkingIndicator({ frames: [] });
    ctx.ui.setWidget(REASONING_WIDGET_KEY, (tui) => {
      status = new ReasoningStatus(() => ctx.ui.theme, () => tui.requestRender());
      return status;
    });
  };
}
