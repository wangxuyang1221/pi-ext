import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Image, matchesKey } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  const root = process.env.LOCAL_REFRESH_EVIDENCE!;
  const record = (type: string, data: unknown) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ type, data }) + "\n");
  const faux = fauxProvider({ tokensPerSecond: 4000 });
  faux.setResponses(Array.from({ length: 100 }, (_, index) => async context => {
    record("request", context.messages.at(-1));
    return fauxAssistantMessage(`Response ${index}: ` + "Production message history. ".repeat(12));
  }));
  pi.registerProvider(faux.provider);
  pi.on("session_start", (event, ctx) => record("start", { reason: event.reason, pid: process.pid, tty: process.stdin.isTTY, session: ctx.sessionManager.getSessionFile() }));
  pi.on("session_shutdown", event => record("shutdown", event.reason));
  pi.on("agent_settled", () => record("settled", true));
  pi.registerShortcut("f6", { handler: async ctx => record("editor", ctx.ui.getEditorText()) });
  pi.registerShortcut("f7", { handler: async ctx => {
    await ctx.ui.custom<void>((_tui, _theme, _keys, done) => ({
      render: () => ["REGION OVERLAY", "Type q to close"], invalidate() {},
      handleInput(data: string) { if (data === "q" || matchesKey(data, "escape")) done(); },
    }), { overlay: true, overlayOptions: { width: 32 } });
    record("overlayClosed", true);
  } });
  pi.registerCommand("fixture-image", { handler: async (args, ctx) => {
    if (args.trim() === "off") ctx.ui.setWidget("region-image", undefined);
    else ctx.ui.setWidget("region-image", (_tui, theme) => new Image(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "image/png", { fallbackColor: text => theme.fg("dim", text) }, { maxWidthCells: 2, maxHeightCells: 1 }));
    record("image", args.trim() === "off" ? "off" : "on");
  } });
  pi.registerCommand("fixture-reload", { handler: async (_args, ctx) => { await ctx.reload(); } });
  pi.registerCommand("fixture-theme", { handler: async (_args, ctx) => { const result = ctx.ui.setTheme("light"); record("theme", result); } });
}
