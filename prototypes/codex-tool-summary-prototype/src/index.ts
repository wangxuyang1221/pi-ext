// PROTOTYPE: Real Pi input and tool rows; all execution boundaries are disabled.
import type { ExtensionAPI, ExtensionContext, KeybindingsManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ResponsiveLinesComponent } from "../../../extensions/codex-ui/src/responsive-lines.js";
import { renderMcpToolCall, renderMcpToolResult } from "../../../extensions/mcp/src/renderers.js";
import { MCP_NAME } from "./fixtures.js";
import { wrapSummaryTool, type LabState, type Variant } from "./renderers.js";

export function registerSummaryLab(pi: ExtensionAPI, write: ToolDefinition): LabState {
  let uiContext: ExtensionContext | undefined;
  let keybindings: KeybindingsManager | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  const clearWriteTimer = () => {
    if (writeTimer !== undefined) clearTimeout(writeTimer);
    writeTimer = undefined;
  };
  const initial = Number(process.env.PI_SUMMARY_LAB_VARIANT ?? 1);
  const lab: LabState = {
    variant: ([1, 2, 3, 4].includes(initial) ? initial : 1) as Variant,
    writeInProgress: false,
    invalidators: new Map(),
    hint(theme, expanded) {
      const keys = keybindings?.getKeys("app.tools.expand").map(String).join("/") ?? "ctrl+o";
      return theme.fg("dim", `${keys}${keys ? " " : ""}${expanded ? "collapse" : "expand"}`);
    },
  };
  const refresh = () => {
    for (const invalidate of lab.invalidators.values()) invalidate();
    uiContext?.ui.setWidget("summary-lab", (_tui, theme) => {
      const result = new ResponsiveLinesComponent();
      result.setRenderer(() => [
        [1, 2, 3, 4].map(value => theme.fg(value === lab.variant ? "accent" : "dim", `${value === lab.variant ? "[" : " "}${value}${value === lab.variant ? "]" : " "}`)).join(" · "),
        theme.fg("dim", "/summary-style 1|2|3|4 · Alt+1/2/3/4 · ") + lab.hint(theme, false),
        theme.fg("dim", "/write-replay · Alt+R · /write-settle"),
      ]);
      return result;
    });
  };
  const settleWrite = () => {
    clearWriteTimer();
    lab.writeInProgress = false;
    refresh();
  };
  const replayWrite = () => {
    clearWriteTimer();
    lab.writeInProgress = true;
    refresh();
    writeTimer = setTimeout(settleWrite, 4000);
  };
  pi.registerCommand("write-replay", { description: "/write-replay", handler: async () => replayWrite() });
  pi.registerCommand("write-settle", { description: "/write-settle", handler: async () => settleWrite() });
  pi.registerShortcut("alt+r", { description: "/write-replay", handler: async () => replayWrite() });
  const setVariant = (variant: Variant) => { lab.variant = variant; refresh(); };
  pi.registerTool(wrapSummaryTool(write, "write", lab));
  pi.registerTool(wrapSummaryTool({
    name: MCP_NAME, label: "context7 / resolve-library-id", description: "Fixture-only MCP tool",
    parameters: Type.Object({ libraryName: Type.String() }), renderShell: "self",
    async execute() { throw new Error("MCP execution is disabled in this UI prototype."); },
    renderCall: (args, theme, context) => renderMcpToolCall(args, { serverName: "context7", toolName: "resolve-library-id" }, theme, context),
    renderResult: renderMcpToolResult,
  }, "mcp", lab));
  pi.registerCommand("summary-style", {
    description: "/summary-style 1|2|3|4",
    getArgumentCompletions: prefix => ["1", "2", "3", "4"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      const value = Number(args.trim());
      if ([1, 2, 3, 4].includes(value)) setVariant(value as Variant);
      else ctx.ui.notify("/summary-style 1|2|3|4", "info");
    },
  });
  for (const variant of [1, 2, 3, 4] as const) pi.registerShortcut(`alt+${variant}`, {
    description: `/summary-style ${variant}`,
    handler: async () => setVariant(variant),
  });
  pi.on("input", (_event, ctx) => {
    ctx.ui.notify("/summary-style 1|2|3|4", "info");
    return { action: "handled" };
  });
  pi.on("tool_call", () => ({ block: true, reason: "Tool execution is disabled in this UI prototype." }));
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this UI prototype.", exitCode: 1, cancelled: false, truncated: false } }));
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    uiContext = ctx;
    const previousEditor = ctx.ui.getEditorComponent();
    if (previousEditor) ctx.ui.setEditorComponent((tui, theme, injected) => {
      keybindings = injected;
      return previousEditor(tui, theme, injected);
    });
    refresh();
  });
  pi.on("session_shutdown", () => {
    clearWriteTimer();
    lab.writeInProgress = false;
    lab.invalidators.clear();
    uiContext = undefined;
  });
  return lab;
}
