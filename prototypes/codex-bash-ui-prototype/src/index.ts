// PROTOTYPE: Real Pi grouped tool rows, fixture-backed presentation, no shell or model execution.
import { createBashToolDefinition, type ExtensionAPI, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { ResponsiveLinesComponent } from "../../../extensions/codex-ui/src/responsive-lines.js";
import { LabController } from "./controller.js";
import { LAST_FRAME, parseScene, SCENES } from "./fixtures.js";
import { renderGroup } from "./renderers.js";

export function registerBashLab(pi: ExtensionAPI, controller: LabController): void {
  const invalidators = new Map<string, () => void>();
  let uiContext: ExtensionContext | undefined;
  let keybindings: KeybindingsManager | undefined;
  const toggleHint = (theme: Theme, description: string): string => {
    const keys = keybindings?.getKeys("app.tools.expand").map(String).join("/") ?? "";
    return `${theme.fg("dim", keys)}${theme.fg("muted", `${keys ? " " : ""}${description}`)}`;
  };

  const refresh = () => {
    for (const invalidate of [...invalidators.values()]) invalidate();
    const ctx = uiContext;
    if (!ctx) return;
    const playback = controller.playing ? `playing ${controller.frame}/${LAST_FRAME}`
      : controller.frame === null || controller.frame >= LAST_FRAME ? "settled" : `paused ${controller.frame}/${LAST_FRAME}`;
    ctx.ui.setWidget("bash-ui-lab", (_tui, theme) => {
      const component = new ResponsiveLinesComponent();
      component.setRenderer(() => [
        theme.fg("accent", `Grouped Bash · Scene ${controller.scene} · Playback ${playback}`),
        theme.fg("dim", `${toggleHint(theme, "expand/collapse all")} · /bash-scene · Alt+R replay · Alt+P pause`),
      ]);
      return component;
    });
  };
  const unsubscribe = controller.subscribe(refresh);
  const base = createBashToolDefinition(process.cwd());
  pi.registerTool({
    ...base,
    renderShell: "self",
    async execute() { throw new Error("Bash UI prototype does not execute commands."); },
    renderCall(_args, theme, context) {
      invalidators.set(context.toolCallId, context.invalidate);
      const component = context.lastComponent instanceof ResponsiveLinesComponent ? context.lastComponent : new ResponsiveLinesComponent();
      component.setRenderer(width => {
        const rows = controller.rows;
        if (rows[0]?.id !== context.toolCallId) return [];
        return renderGroup(rows, context.expanded, theme, width, toggleHint(theme, context.expanded ? "collapse" : "expand"));
      });
      return component;
    },
    renderResult(_result, _options, _theme, context) {
      const component = context.lastComponent instanceof ResponsiveLinesComponent ? context.lastComponent : new ResponsiveLinesComponent();
      component.setRenderer(() => []);
      return component;
    },
  });

  pi.registerCommand("bash-scene", {
    description: "Switch fixture scene: mixed, success, long, edge",
    async handler(args, ctx) {
      const value = args.trim() || await ctx.ui.select("Fixture scene", [...SCENES]);
      if (!value) return;
      const scene = parseScene(value);
      if (scene) controller.setScene(scene);
      else ctx.ui.notify("Usage: /bash-scene mixed|success|long|edge", "error");
    },
  });
  for (const [name, description, action] of [
    ["replay", "Replay the six-second fixture animation", () => controller.replay()],
    ["pause", "Pause or resume fixture playback", () => controller.pause()],
    ["step", "Advance one fixture frame", () => { if (controller.playing) controller.pause(); controller.step(); }],
    ["settle", "Show the final fixture results", () => controller.settle()],
  ] as const) pi.registerCommand(`bash-${name}`, { description, handler: async () => { action(); } });

  pi.registerShortcut("alt+r", { description: "Replay Bash fixtures", handler: async () => controller.replay() });
  pi.registerShortcut("alt+p", { description: "Pause Bash fixtures", handler: async () => controller.pause() });

  pi.on("input", (_event, ctx) => {
    ctx.ui.notify("Fixture-only session. Use /bash-scene or /bash-replay. No model request was sent.", "info");
    return { action: "handled" };
  });
  pi.on("tool_call", () => ({ block: true, reason: "Tool execution is disabled in this UI prototype." }));
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this UI prototype.", exitCode: 1, cancelled: false, truncated: false } }));
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    uiContext = ctx;
    const previousEditor = ctx.ui.getEditorComponent();
    if (previousEditor) ctx.ui.setEditorComponent((tui, theme, injectedKeybindings) => {
      keybindings = injectedKeybindings;
      return previousEditor(tui, theme, injectedKeybindings);
    });
    refresh();
  });
  pi.on("session_shutdown", () => {
    unsubscribe();
    controller.dispose();
    invalidators.clear();
    uiContext = undefined;
  });
}

export default function bashUiPrototype(pi: ExtensionAPI): void {
  // A local identity fixture prevents unrelated authentication warnings in this offline UI test.
  pi.registerProvider("bash-ui-fixture", {
    api: "openai-responses", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-not-a-secret",
    models: [{ id: "fixture", name: "Bash UI fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1 }],
    streamSimple() { throw new Error("Model requests are disabled in this UI prototype."); },
  });
  registerBashLab(pi, new LabController(parseScene(process.env.PI_BASH_LAB_SCENE ?? "") ?? "mixed"));
}
