import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { sanitizeDiagnosticText } from "./diagnostics.js";

/** Owns one initial startup batch and its optional interactive status row. */
export class McpStartup {
  private readonly pending: Map<string, AbortController>;
  private readonly total: number;
  private readonly startedAt = performance.now();
  private header = "";
  private timer?: ReturnType<typeof setInterval>;
  private detachInput?: () => void;
  private requestRender?: () => void;
  private stopped = false;
  private mounted = false;

  constructor(
    names: string[],
    private readonly ctx: ExtensionContext,
    private readonly isConnected: (name: string) => boolean,
    private readonly onInterrupt: (names: string[]) => void,
  ) {
    this.pending = new Map(names.sort().map((name) => [name, new AbortController()]));
    this.total = this.pending.size;
    this.updateHeader();
    if (!this.total || !ctx.hasUI || ctx.mode !== "tui") return;
    this.mounted = true;
    ctx.ui.setWidget("mcp-startup", (tui, theme) => {
      this.requestRender = () => tui.requestRender();
      return {
        render: (width) => this.stopped ? [] : renderStartup(this.header, performance.now() - this.startedAt, width, theme),
        invalidate() {},
      };
    });
    this.detachInput = ctx.ui.onTerminalInput((data) => {
      if (this.stopped || !matchesKey(data, "escape")) return;
      const interrupted: string[] = [];
      for (const [name, controller] of this.pending) {
        if (this.isConnected(name)) continue;
        interrupted.push(name);
        controller.abort(new DOMException("MCP startup interrupted", "AbortError"));
      }
      this.stop();
      if (interrupted.length) this.onInterrupt(interrupted);
      return { consume: true };
    });
    this.timer = setInterval(() => this.requestRender?.(), 50);
    this.timer.unref();
  }

  signal(name: string): AbortSignal | undefined {
    return this.pending.get(name)?.signal;
  }

  settle(name: string): void {
    this.pending.delete(name);
    if (!this.pending.size) this.stop();
    else if (!this.stopped) {
      this.updateHeader();
      this.requestRender?.();
    }
  }

  /** Cancels unfinished work when its owning session is replaced or closed. */
  dispose(): void {
    this.stop();
    for (const controller of this.pending.values()) {
      controller.abort(new DOMException("MCP session ended", "AbortError"));
    }
    this.pending.clear();
  }

  private stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.detachInput?.();
    this.detachInput = undefined;
    this.requestRender = undefined;
    if (this.mounted) this.ctx.ui.setWidget("mcp-startup", undefined);
  }

  private updateHeader(): void {
    const names = [...this.pending.keys()].slice(0, 3)
      .map((name) => sanitizeDiagnosticText(name, 512).replace(/\s+/g, " "));
    if (this.pending.size > 3) names.push("…");
    this.header = this.total === 1 ? `Booting MCP server: ${names[0]}`
      : `Starting MCP servers (${this.total - this.pending.size}/${this.total}): ${names.join(", ")}`;
  }
}

function renderStartup(header: string, elapsedMs: number, width: number, theme: Theme): string[] {
  if (width <= 0) return [];
  // Bound the animated work to the viewport, even for very long server names.
  const chars = Array.from(truncateToWidth(header, width, "…"));
  const sweep = ((elapsedMs % 2000) / 2000) * (chars.length + 20) - 10;
  const shimmer = chars.map((char, index) => {
    const distance = Math.abs(index - sweep);
    return theme.bold(theme.fg(distance < 2 ? "text" : distance < 5 ? "muted" : "dim", char));
  }).join("");
  const bullet = theme.fg(Math.floor(elapsedMs / 300) % 2 ? "muted" : "dim", "•");
  const time = formatElapsed(Math.max(0, Math.floor(elapsedMs / 1000)));
  const hint = theme.fg("dim", `(${time} • ${theme.bold("esc")} to interrupt)`);
  return [truncateToWidth(`${bullet} ${shimmer} ${hint}`, width, "…")];
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const tail = `${String(seconds % 60).padStart(2, "0")}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${tail}`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}m ${tail}`;
}
