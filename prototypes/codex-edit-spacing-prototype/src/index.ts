// PROTOTYPE: Keep production rendering and isolate the edit/reply layout experiments.
import type { ExtensionAPI, ExtensionContext, MarkdownTransformer, ToolDefinition } from "@earendil-works/pi-coding-agent";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import { ResponsiveLinesComponent } from "../../../extensions/codex-ui/src/responsive-lines.js";
import { wrapEditTool, type LabState, type Variant } from "./renderers.js";
import { registerReplyLab, type ReplyPreviewStyle } from "./reply-controls.js";

const labels = { 1: "Tinted header", 2: "Underlined header", 3: "Diff rail" } as const;
const hint = "Alt+1/2/3 or /edit-style 1|2|3 · Ctrl+O expand/collapse · Ctrl+D exit";

export function registerSpacingLab(pi: ExtensionAPI, lab: LabState): void {
  let uiContext: ExtensionContext | undefined;
  const refresh = () => {
    for (const invalidate of lab.invalidators.values()) invalidate();
    uiContext?.ui.setWidget("edit-spacing-lab", (_tui, theme) => {
      const component = new ResponsiveLinesComponent();
      component.setRenderer(() => [
        ([1, 2, 3] as const).map(value => theme.fg(value === lab.variant ? "accent" : "dim", `${value === lab.variant ? `[${value}]` : ` ${value} `} ${labels[value]}`)).join(" · "),
        theme.fg("dim", hint),
      ]);
      return component;
    });
  };
  const select = (value: Variant) => { lab.variant = value; refresh(); };
  pi.registerCommand("edit-style", {
    description: "Compare edit header separation: 1 tinted, 2 underlined, 3 rail",
    getArgumentCompletions: prefix => ["1", "2", "3"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      const value = args.trim();
      if (["1", "2", "3"].includes(value)) select(Number(value) as Variant);
      else ctx.ui.notify("Use /edit-style 1|2|3", "info");
    },
  });
  for (const value of [1, 2, 3] as const) pi.registerShortcut(`alt+${value}`, {
    description: labels[value], handler: async () => select(value),
  });
  pi.on("input", (_event, ctx) => {
    ctx.ui.notify(hint, "info");
    return { action: "handled" };
  });
  pi.on("tool_call", () => ({ block: true, reason: "Tool execution is disabled in this UI prototype." }));
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this UI prototype.", exitCode: 1, cancelled: false, truncated: false } }));
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    uiContext = ctx;
    refresh();
  });
  pi.on("session_shutdown", () => { lab.invalidators.clear(); uiContext = undefined; });
}

export default function composed(pi: ExtensionAPI): void {
  const productionReplies = process.env.PI_SPACING_LAB_PRODUCTION_REPLIES === "1";
  const initial = Number(process.env.PI_SPACING_LAB_VARIANT ?? 1);
  const lab: LabState = { variant: ([1, 2, 3].includes(initial) ? initial : 1) as Variant, invalidators: new Map() };
  codexUi(new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerMarkdownTransformer" && !productionReplies) return (transform: MarkdownTransformer) => {
        // Keep the comparison baseline raw, without stacking the production list.
        target.registerMarkdownTransformer((markdown, context) => context.messageType === "assistant" ? markdown : transform(markdown, context));
      };
      if (property === "registerTool") return (tool: ToolDefinition) => {
        target.registerTool(tool.name === "edit" ? wrapEditTool(tool, lab) : {
          ...tool, async execute() { throw new Error("Tool execution is disabled in this UI prototype."); },
        });
      };
      return Reflect.get(target, property, receiver);
    },
  }));
  registerSpacingLab(pi, lab);
  const replyStyle = process.env.PI_SPACING_LAB_REPLY_STYLE ?? "list";
  if (!productionReplies) registerReplyLab(pi, (["current", "list", "quote", "indented"].includes(replyStyle) ? replyStyle : "list") as ReplyPreviewStyle);
  pi.registerProvider("spacing-ui-fixture", {
    api: "openai-responses", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-not-a-secret",
    models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1 }],
    streamSimple() { throw new Error("Model requests are disabled in this UI prototype."); },
  });
}
