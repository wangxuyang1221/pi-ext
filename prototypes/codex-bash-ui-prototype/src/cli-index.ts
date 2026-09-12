// PROTOTYPE: Real Pi rows with fixture-only execution and isolated controls.
import { createBashToolDefinition, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { ResponsiveLinesComponent } from "../../../extensions/codex-ui/src/responsive-lines.js";
import { LabController } from "./controller.js";
import { LAST_FRAME, parseScene, SCENES } from "./fixtures.js";
import { renderCliRows, type CliStyle } from "./cli-renderers.js";
import { CliLabController } from "./cli-fixtures.js";

export function registerCliLab(pi: ExtensionAPI, controller: LabController, initialStyle: CliStyle): void {
  let style = initialStyle;
  let ctx: ExtensionContext | undefined;
  let keys: KeybindingsManager | undefined;
  const invalidators = new Map<string, () => void>();
  const expandKey = () => keys?.getKeys("app.tools.expand").map(String).join("/") ?? "";
  const refresh = () => {
    for (const invalidate of invalidators.values()) invalidate();
    ctx?.ui.setWidget("bash-cli-lab", (_tui, theme) => {
      const component = new ResponsiveLinesComponent();
      const playback = controller.playing ? `重播 ${controller.frame}/${LAST_FRAME}`
        : controller.frame === null || controller.frame >= LAST_FRAME ? "最终结果" : `暂停 ${controller.frame}/${LAST_FRAME}`;
      component.setRenderer(() => [
        theme.fg("muted", `${style === "codex" ? "Codex CLI 0.154.0" : style === "claude" ? "Claude Code 2.1.236 · regular" : "Hybrid · 紧凑标题 + 现有命令树"} · ${controller.scene} · ${playback} · 离线 fixture`),
        theme.fg("dim", `Alt+1 Codex · Alt+2 Claude · Alt+3 Hybrid · ${expandKey()} 折叠/展开 · /bash-scene 场景`),
        theme.fg("dim", "Alt+R 重播 · Alt+P 暂停 · /bash-step 单步 · /bash-settle 结束重播 · Ctrl+D 退出"),
      ]);
      return component;
    });
  };
  const unsubscribe = controller.subscribe(refresh);
  pi.registerTool({
    ...createBashToolDefinition(process.cwd()),
    renderShell: "self",
    async execute() { throw new Error("Command execution is disabled in the Bash CLI prototype."); },
    renderCall(_args, theme, context) {
      invalidators.set(context.toolCallId, context.invalidate);
      const component = context.lastComponent instanceof ResponsiveLinesComponent ? context.lastComponent : new ResponsiveLinesComponent();
      component.setRenderer(width => controller.rows[0]?.id === context.toolCallId
        ? renderCliRows(controller.rows, style, context.expanded, theme, width, expandKey()) : []);
      return component;
    },
    renderResult(_result, _options, _theme, context) {
      const component = context.lastComponent instanceof ResponsiveLinesComponent ? context.lastComponent : new ResponsiveLinesComponent();
      component.setRenderer(() => []);
      return component;
    },
  });
  const choose = (next: CliStyle) => { style = next; refresh(); };
  pi.registerCommand("bash-style", {
    description: "切换 Codex CLI / Claude Code / Hybrid 样式",
    async handler(args, context) {
      const next = args.trim() || await context.ui.select("选择样式", ["codex", "claude", "hybrid"]);
      if (next === "codex" || next === "claude" || next === "hybrid") choose(next);
      else if (next) context.ui.notify("使用 /bash-style codex|claude|hybrid", "error");
    },
  });
  pi.registerShortcut("alt+1", { description: "Codex CLI 参考", handler: async () => choose("codex") });
  pi.registerShortcut("alt+2", { description: "Claude Code 参考", handler: async () => choose("claude") });
  pi.registerShortcut("alt+3", { description: "Hybrid 紧凑分组", handler: async () => choose("hybrid") });
  pi.registerCommand("bash-scene", {
    description: "切换 single、mixed、success、long、edge 场景",
    async handler(args, context) {
      const next = args.trim() || await context.ui.select("选择场景", [...SCENES]);
      if (!next) return;
      const scene = parseScene(next);
      if (scene) controller.setScene(scene);
      else context.ui.notify("使用 /bash-scene single|mixed|success|long|edge", "error");
    },
  });
  for (const [name, description, action] of [
    ["replay", "重播离线命令状态", () => controller.replay()],
    ["pause", "暂停或继续重播", () => controller.pause()],
    ["step", "推进一个状态帧", () => { if (controller.playing) controller.pause(); controller.step(); }],
    ["settle", "显示最终结果", () => controller.settle()],
  ] as const) pi.registerCommand(`bash-${name}`, { description, handler: async () => { action(); } });
  pi.registerShortcut("alt+r", { description: "重播", handler: async () => controller.replay() });
  pi.registerShortcut("alt+p", { description: "暂停或继续", handler: async () => controller.pause() });

  pi.on("input", (_event, context) => {
    context.ui.notify("此会话只展示 fixture；请使用 /bash-style、/bash-scene 或 /bash-replay。不会发送模型请求。", "info");
    return { action: "handled" };
  });
  pi.on("tool_call", () => ({ block: true, reason: "Tool execution is disabled in this prototype." }));
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this prototype.", exitCode: 1, cancelled: false, truncated: false } }));
  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;
    ctx = context;
    const previous = ctx.ui.getEditorComponent();
    if (previous) ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      keys = keybindings;
      return previous(tui, theme, keybindings);
    });
    refresh();
  });
  pi.on("session_shutdown", () => {
    unsubscribe();
    controller.dispose();
    invalidators.clear();
    ctx = undefined;
  });
}

export default function cliPrototype(pi: ExtensionAPI): void {
  pi.registerProvider("bash-cli-fixture", {
    api: "openai-responses", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-not-a-secret",
    models: [{ id: "fixture", name: "Bash CLI fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1 }],
    streamSimple() { throw new Error("Model requests are disabled in this prototype."); },
  });
  registerCliLab(pi, new CliLabController(parseScene(process.env.PI_BASH_LAB_SCENE ?? "") ?? "single"),
    process.env.PI_BASH_CLI_STYLE === "hybrid" ? "hybrid" : process.env.PI_BASH_CLI_STYLE === "claude" ? "claude" : "codex");
}
