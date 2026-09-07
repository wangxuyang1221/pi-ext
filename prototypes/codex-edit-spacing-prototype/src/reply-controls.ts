// PROTOTYPE: Public Markdown alternatives run without any host component patch.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { ResponsiveLinesComponent } from "../../../extensions/codex-ui/src/responsive-lines.js";
import type { installReplyLayout } from "./reply-layout.js";

export type ReplyPreviewStyle = "current" | "list" | "quote" | "indented";
type LegacyInstaller = typeof installReplyLayout;

export function registerReplyLab(pi: ExtensionAPI, initial: ReplyPreviewStyle = "list", legacyInstaller?: LegacyInstaller): void {
  const host = globalThis as unknown as Record<symbol, LegacyInstaller | undefined>;
  const install = legacyInstaller ?? host[Symbol.for("pi.edit-spacing-lab.installReplyLayout")];
  const styles: ReplyPreviewStyle[] = install ? ["current", "indented", "list", "quote"] : ["current", "list", "quote"];
  let style = styles.includes(initial) ? initial : "list";
  let context: ExtensionContext | undefined;
  let tui: TUI | undefined;
  let adapter: ReturnType<LegacyInstaller> | undefined;
  const hint = `/reply-style ${styles.join("|")}`;
  const refresh = () => {
    adapter?.refresh();
    // Markdown caches by source and width. Invalidate only on manual style changes,
    // not on streaming frames, so restored rows are rendered with the new transform.
    tui?.invalidate();
    context?.ui.setWidget("reply-layout-lab", (hostTui, theme) => {
      tui = hostTui;
      const component = new ResponsiveLinesComponent();
      component.setRenderer(() => [
        theme.fg("accent", `Reply: ${style}`) + theme.fg("dim", ` · ${install ? "Legacy lab host" : "Public API"} · Alt+R cycle`),
        theme.fg("dim", hint),
      ]);
      return component;
    });
    tui?.requestRender();
  };
  pi.registerMarkdownTransformer((markdown, ctx) => {
    if (ctx.messageType !== "assistant" || !markdown.trim()) return markdown;
    if (style === "list") return "- " + markdown.split(/\r?\n/u).join("\n  ");
    if (style === "quote") return markdown.split(/\r?\n/u).map(line => `> ${line}`).join("\n");
    return markdown;
  });
  pi.registerCommand("reply-style", {
    description: "Compare assistant reply layouts",
    getArgumentCompletions: prefix => styles.filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      const value = args.trim() as ReplyPreviewStyle;
      if (!styles.includes(value)) { ctx.ui.notify(`Use ${hint}`, "info"); return; }
      style = value;
      refresh();
    },
  });
  pi.registerShortcut("alt+r", {
    description: "Cycle assistant reply layouts",
    handler: async () => { style = styles[(styles.indexOf(style) + 1) % styles.length]!; refresh(); },
  });
  pi.on("session_start", (_event, ctx) => {
    adapter?.dispose();
    adapter = undefined;
    if (ctx.mode !== "tui") return;
    context = ctx;
    adapter = install?.(() => style === "indented" ? "indented" : "current", () => ctx.ui.theme);
    refresh();
  });
  pi.on("session_shutdown", () => {
    adapter?.dispose();
    adapter = undefined;
    context?.ui.setWidget("reply-layout-lab", undefined);
    context = undefined;
    tui = undefined;
  });
}
