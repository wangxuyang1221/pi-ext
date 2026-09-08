// PROTOTYPE: Controls change restored rows, never replay real tools.
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ResponsiveLinesComponent } from "../../../extensions/codex-ui/src/responsive-lines.js";
import { fixturesFor, SCENES, type Scene } from "./fixtures.js";
import { FILE_COLORS, wrapReadTool, type FileColor, type LabState, type Variant } from "./renderers.js";
export const LABELS = ["当前样式", "极简日志", "文件卡片", "内容预览", "合并读取", "活动时间线", "合并读取与预览"];
export const NOTES = [
  "当前仓库的真实 Read 渲染，作为对照。",
  "一行摘要，展开后显示完整路径与内容。",
  "文件名优先，目录与操作类型退到第二行。",
  "默认预览前三行，展开后显示更多内容。",
  "将本场景的连续读取合并展示；分组关系来自 fixture。",
  "弱化成功状态，用节点与细线组织读取信息。",
  "保留分组，每个文件附三行预览；长行截断，Ctrl+O 展开。",
];
export function registerReadLab(pi: ExtensionAPI, read: ToolDefinition): LabState {
  let context: ExtensionContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scene = process.env.PI_READ_LAB_SCENE ?? "batch";
  const initial = Number(process.env.PI_READ_LAB_VARIANT ?? 1);
  const lab: LabState = {
    variant: (Number.isInteger(initial) && initial >= 0 && initial <= 6 ? initial : 1) as Variant,
    pending: false,
    fileColor: "soft",
    fixtures: fixturesFor(SCENES.includes(scene as Scene) ? scene as Scene : "batch"),
    invalidators: new Map(),
  };
  const refresh = () => {
    for (const invalidate of lab.invalidators.values()) invalidate();
    context?.ui.setWidget("read-lab", (_tui, theme) => {
      const component = new ResponsiveLinesComponent();
      component.setRenderer(() => [
        theme.fg("accent", `[${lab.variant}] ${LABELS[lab.variant]}`) + theme.fg("dim", ` · ${scene} · color: ${lab.fileColor} · offline fixture`),
        theme.fg("muted", NOTES[lab.variant]!),
        theme.fg("dim", "/read-style 0–6 · Alt+0…6 · Ctrl+O expand · /read-replay"),
        theme.fg("dim", "/read-color cyan|soft|blue · filenames only; baseline unchanged"),
      ]);
      return component;
    });
  };
  pi.registerTool(wrapReadTool(read, lab));
  const setVariant = (variant: Variant) => { lab.variant = variant; refresh(); };
  pi.registerCommand("read-style", {
    description: "Compare Read layouts: 0 baseline, 1–6 alternatives",
    getArgumentCompletions: prefix => LABELS.map((label, i) => ({ value: String(i), label: `${i} ${label}` })).filter(item => item.value.startsWith(prefix)),
    handler: async (args, ctx) => {
      const value = args.trim() === "" ? -1 : Number(args.trim());
      if (Number.isInteger(value) && value >= 0 && value <= 6) setVariant(value as Variant);
      else ctx.ui.notify("/read-style 0|1|2|3|4|5|6", "info");
    },
  });
  for (const variant of [0, 1, 2, 3, 4, 5, 6] as const) pi.registerShortcut(`alt+${variant}`, {
    description: `/read-style ${variant}`, handler: async () => setVariant(variant),
  });
  pi.registerCommand("read-color", {
    description: "Filename color: cyan, soft cyan, or gray blue",
    getArgumentCompletions: prefix => FILE_COLORS.filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      const color = args.trim();
      if (!FILE_COLORS.includes(color as FileColor)) {
        ctx.ui.notify("/read-color cyan|soft|blue", "info");
        return;
      }
      lab.fileColor = color as FileColor;
      refresh();
    },
  });
  pi.registerCommand("read-replay", {
    description: "Simulate reading for three seconds without executing tools",
    handler: async () => {
      if (timer) clearTimeout(timer);
      lab.pending = true;
      refresh();
      timer = setTimeout(() => { timer = undefined; lab.pending = false; refresh(); }, 3000);
    },
  });
  pi.on("input", (_event, ctx) => {
    ctx.ui.notify("Fixture only. Use /read-style 0|1|2|3|4|5|6, /read-color cyan|soft|blue or /read-replay.", "info");
    return { action: "handled" };
  });
  pi.on("tool_call", () => ({ block: true, reason: "Tool execution is disabled in this UI prototype." }));
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this UI prototype.", exitCode: 1, cancelled: false, truncated: false } }));
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    context = ctx;
    refresh();
  });
  pi.on("session_shutdown", () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    lab.invalidators.clear();
    context = undefined;
  });
  return lab;
}
