import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const FRAME_MS = 80;
type Schedule = (callback: () => void, delay: number) => () => void;

/** Animate OSC title text only, with one timer and no missed-frame backlog. */
export class TerminalTitleSpinner {
  private cancel: (() => void) | undefined;
  private active = false;
  private started = 0;
  private lastTitle = "";

  constructor(private readonly write: (title: string) => void, private baseTitle: string,
    private readonly now = () => performance.now(),
    private readonly schedule: Schedule = (callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    }) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.started = this.now();
    this.tick();
  }

  setBaseTitle(title: string): void {
    this.baseTitle = title;
    this.paint();
  }

  stop(): void {
    this.active = false;
    this.cancel?.();
    this.cancel = undefined;
    this.paint();
  }

  private paint(): void {
    const frame = Math.floor(Math.max(0, this.now() - this.started) / FRAME_MS) % FRAMES.length;
    const title = this.active ? `${FRAMES[frame]} ${this.baseTitle}` : this.baseTitle;
    if (title === this.lastTitle) return;
    this.lastTitle = title;
    this.write(title);
  }

  private tick(): void {
    if (!this.active) return;
    this.paint();
    const elapsed = Math.max(0, this.now() - this.started);
    this.cancel = this.schedule(() => this.tick(), Math.max(1, FRAME_MS - elapsed % FRAME_MS));
  }
}

function baseTitle(cwd: string, name: string | undefined): string {
  const clean = (text: string) => stripTerminalSequences(text).replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
  const session = clean(name ?? "");
  const project = clean(basename(cwd)) || "session";
  return `π · ${session ? `${session} · ` : ""}${project}`;
}

/** Install session-local terminal title feedback without rendering a TUI component. */
export function registerTerminalTitleSpinner(pi: ExtensionAPI): (ctx: ExtensionContext) => void {
  let spinner: TerminalTitleSpinner | undefined;
  let agentActive = false;
  pi.on("agent_start", () => { if (spinner) { agentActive = true; spinner.start(); } });
  // agent_end can precede retries or auto-compaction; only settlement means idle.
  pi.on("agent_settled", () => { agentActive = false; spinner?.stop(); });
  pi.on("session_before_compact", () => spinner?.start());
  const finishCompaction = () => { if (!agentActive) spinner?.stop(); };
  pi.on("session_compact", finishCompaction);
  pi.on("session_compact_failed", finishCompaction);
  pi.on("session_info_changed", (event, ctx) => spinner?.setBaseTitle(baseTitle(ctx.cwd, event.name)));
  pi.on("session_shutdown", () => { spinner?.stop(); spinner = undefined; agentActive = false; });
  return ctx => {
    spinner?.stop(); spinner = undefined; agentActive = false;
    if (ctx.mode !== "tui") return;
    spinner = new TerminalTitleSpinner(title => ctx.ui.setTitle(title), baseTitle(ctx.cwd, pi.getSessionName()));
    agentActive = !ctx.isIdle();
    if (agentActive) spinner.start();
    else spinner.stop();
  };
}
