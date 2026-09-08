// PROTOTYPE: Replace only thinking presentation; keep production tools, editor and footer.
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import { REASONING_WIDGET_KEY, ReasoningStatus } from "./legacy-reasoning-status.js";

class FixedStatus extends ReasoningStatus {
  override render(width: number): string[] {
    const lines = super.render(width);
    return lines.length ? lines : ["", ""];
  }
}

export default function fixedCodexUi(pi: ExtensionAPI): void {
  // Public-API composition: do not instantiate the production thinking widget.
  // Its handlers then remain inactive. No host methods or prototypes are patched.
  codexUi(new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerMarkdownTransformer") return (transformer: MarkdownTransformer) => {
        target.registerMarkdownTransformer((markdown, context) => context.messageType === "assistant-thinking"
          ? "" : transformer(markdown, context));
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

  let status: FixedStatus | undefined;
  let active = false;
  let current: Pick<AssistantMessage, "timestamp" | "provider" | "model" | "api"> | undefined;
  let index = -1;
  const clear = () => { active = false; current = undefined; index = -1; status?.setTitle(""); };
  const matches = (message: AssistantMessage) => active && current !== undefined
    && message.timestamp === current.timestamp && message.provider === current.provider
    && message.model === current.model && message.api === current.api;

  pi.on("session_start", (_event, ctx) => {
    clear(); status?.dispose(); status = undefined;
    if (ctx.mode !== "tui") return;
    // Native Ctrl+T bypasses Markdown transformers; suppress its placeholder too.
    ctx.ui.setHiddenThinkingLabel?.("");
    ctx.ui.setWidget(REASONING_WIDGET_KEY, tui => {
      status = new FixedStatus(() => ctx.ui.theme, () => tui.requestRender());
      return status;
    });
  });
  pi.on("agent_start", () => { clear(); active = status !== undefined; });
  pi.on("message_start", event => {
    if (!active || event.message.role !== "assistant") return;
    const { timestamp, provider, model, api } = event.message;
    current = { timestamp, provider, model, api }; index = -1;
    // Keep the previous tool-phase title until a new complete title arrives.
  });
  pi.on("message_update", event => {
    if (event.message.role !== "assistant" || !matches(event.message)) return;
    const update = event.assistantMessageEvent;
    if ("contentIndex" in update) {
      if (update.contentIndex < index) return;
      index = update.contentIndex;
    }
    if (update.type === "thinking_delta") {
      const block = event.message.content[update.contentIndex];
      if (block?.type !== "thinking") return;
      // Small fixture snapshots only; a production parser should scan deltas incrementally.
      const titles = [...block.thinking.matchAll(/(?:^|\n)[ \t]*\*\*([^*\r\n]+)\*\*[ \t]*(?=\r?$|\n)/gmu)];
      const title = titles.at(-1)?.[1];
      if (title) status?.setTitle(title);
    } else if (update.type === "text_start" || update.type === "text_delta") {
      status?.setTitle("");
    }
  });
  pi.on("message_end", event => {
    if (event.message.role !== "assistant" || !matches(event.message)) return;
    current = undefined; index = -1;
    if (event.message.stopReason === "aborted" || event.message.stopReason === "error") status?.setTitle("");
  });
  pi.on("agent_end", clear);
  pi.on("agent_settled", clear);
  pi.on("session_before_compact", clear);
  pi.on("session_tree", clear);
  pi.on("session_shutdown", (_event, ctx) => {
    clear(); status?.dispose(); status = undefined;
    if (ctx.mode === "tui") ctx.ui.setWidget(REASONING_WIDGET_KEY, undefined);
  });
}
