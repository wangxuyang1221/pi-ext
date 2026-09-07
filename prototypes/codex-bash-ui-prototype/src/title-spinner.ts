// PROTOTYPE: Animate only the terminal title; never request a TUI redraw per frame.
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TerminalTitleSpinner } from "../../../extensions/codex-ui/src/terminal-title.js";

export const TITLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export type TitleMotion = "smooth" | "legacy";
type Schedule = (callback: () => void, delay: number) => () => void;

export class TitleAnimator {
  private cancel: (() => void) | undefined;
  private mode: TitleMotion | undefined;
  private smooth: TerminalTitleSpinner | undefined;
  private frame = 0;
  private previousWrite: number | undefined;
  private lastTitle = "";
  private intervals: number[] = [];
  private writes = 0;

  constructor(private readonly write: (title: string) => void, private baseTitle: string,
    private readonly now = () => performance.now(),
    private readonly schedule: Schedule = (callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    }) {}

  start(mode: TitleMotion): void {
    this.cancel?.();
    this.smooth?.stop();
    this.smooth = undefined;
    this.mode = mode;
    this.frame = 0;
    this.previousWrite = undefined;
    this.lastTitle = "";
    this.intervals = [];
    this.writes = 0;
    if (mode === "smooth") {
      this.smooth = new TerminalTitleSpinner(title => {
        if (title === this.baseTitle) this.paint(title);
        else this.recordFrame(title);
      }, this.baseTitle, this.now, this.schedule);
      this.smooth.start();
    } else this.tick();
  }

  setBaseTitle(title: string): void {
    this.baseTitle = title;
    this.smooth?.setBaseTitle(title);
    if (!this.mode) this.paint(title);
  }

  stop(): void {
    this.cancel?.();
    this.cancel = undefined;
    this.mode = undefined;
    this.smooth?.stop();
    this.smooth = undefined;
    this.paint(this.baseTitle);
  }

  stats(): { mode: string; writes: number; samples: number; medianMs: number; p95Ms: number; maxMs: number } {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const percentile = (fraction: number) => Math.round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0);
    return { mode: this.mode ?? "off", writes: this.writes, samples: sorted.length,
      medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1) };
  }

  private paint(title: string): void {
    if (title === this.lastTitle) return;
    this.lastTitle = title;
    this.write(title);
  }

  private recordFrame(title: string): void {
    const now = this.now();
    if (title !== this.lastTitle) {
      if (this.previousWrite !== undefined) {
        this.intervals.push(now - this.previousWrite);
        if (this.intervals.length > 256) this.intervals.shift();
      }
      this.previousWrite = now;
      this.writes++;
      this.paint(title);
    }
  }

  private tick(): void {
    if (this.mode !== "legacy") return;
    const frame = this.frame++;
    this.recordFrame(`${TITLE_FRAMES[frame % TITLE_FRAMES.length]} π Pi · Thinking${".".repeat(frame % 3 + 1)}`);
    this.cancel = this.schedule(() => this.tick(), 500);
  }
}

export function registerTitleSpinnerLab(pi: ExtensionAPI): void {
  let animator: TitleAnimator | undefined;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    animator?.stop();
    const project = basename(process.env.PI_BASH_LAB_REPOSITORY ?? ctx.cwd);
    const name = pi.getSessionName();
    animator = new TitleAnimator(title => ctx.ui.setTitle(title), `π · ${name ? `${name} · ` : ""}${project}`);
    animator.start("smooth");
    ctx.ui.setWidget("title-spinner-lab", [
      "顶部动画原型 · /title-motion smooth|legacy|off · /title-stats 查看写入间隔",
      "默认 80ms 时间驱动 · legacy 对照旧版 500ms · /title-stall 注入一次 240ms 阻塞",
      "动画为持续运行 fixture，不代表真实模型正在工作；Ctrl+D 退出并恢复静态标题。",
    ]);
  });
  pi.on("session_info_changed", (event, ctx) => {
    const project = basename(process.env.PI_BASH_LAB_REPOSITORY ?? ctx.cwd);
    animator?.setBaseTitle(`π · ${event.name ? `${event.name} · ` : ""}${project}`);
  });
  pi.registerCommand("title-motion", {
    description: "切换顶部动画：smooth、legacy、off",
    handler: async (args, ctx) => {
      const mode = args.trim();
      if (mode === "off") animator?.stop();
      else if (mode === "smooth" || mode === "legacy") animator?.start(mode);
      else ctx.ui.notify("使用 /title-motion smooth|legacy|off", "info");
    },
  });
  pi.registerCommand("title-stats", {
    description: "查看最近 256 次标题写入间隔，不代表窗口实际绘制帧率",
    handler: async (_args, ctx) => {
      const stats = animator?.stats();
      if (stats) ctx.ui.notify(`标题写入 · ${stats.mode} · ${stats.samples} 个间隔 · 中位数 ${stats.medianMs}ms · P95 ${stats.p95Ms}ms · 最大 ${stats.maxMs}ms`, "info");
    },
  });
  pi.registerCommand("title-stall", {
    description: "注入一次 240ms 事件循环阻塞，观察恢复时不补播",
    handler: async () => {
      const end = performance.now() + 240;
      while (performance.now() < end) { /* Deliberate local fixture, not production work. */ }
    },
  });
  pi.on("session_shutdown", () => { animator?.stop(); animator = undefined; });
}
