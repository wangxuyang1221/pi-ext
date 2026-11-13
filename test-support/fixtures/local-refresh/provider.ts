import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Image, matchesKey, type TUI } from "@earendil-works/pi-tui";

import type { TextRegionCapability, TextRegionHandle } from "../../host-capabilities.js";

export default function (pi: ExtensionAPI) {
  const root = process.env.LOCAL_REFRESH_EVIDENCE!;
  const record = (type: string, data: unknown) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ type, data }) + "\n");
  let documentVersion = 0;
  let documentTui: TUI | undefined;
  let documentHandle: TextRegionHandle | undefined;
  let documentTimer: ReturnType<typeof setTimeout> | undefined;
  const documentComponent = { invalidate() {}, render: () => [`Local document revision ${documentVersion}`] };
  pi.registerMessageRenderer("local-refresh-document", () => documentComponent);
  pi.registerCommand("fixture-document", { handler: async (args, ctx) => {
    if (args.trim() === "step") {
      documentTimer = setTimeout(() => {
        documentVersion++;
        if (documentHandle) documentHandle.requestRender(); else documentTui?.requestRender();
        record("documentUpdated", documentVersion);
      }, 800);
      return;
    }
    ctx.ui.setWidget("document-region-access", tui => {
      documentHandle?.dispose();
      documentTui = tui;
      documentHandle = (tui as TUI & TextRegionCapability).registerTextRegion?.(documentComponent);
      return { invalidate() {}, render: () => [], dispose() { documentHandle?.dispose(); } };
    });
    pi.sendMessage({ customType: "local-refresh-document", content: "Local document", display: true });
  } });
  pi.on("session_shutdown", () => { if (documentTimer) clearTimeout(documentTimer); documentHandle?.dispose(); });
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
