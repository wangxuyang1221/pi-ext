// PROTOTYPE: Real Pi transcript and Codex UI with fixture-backed playback only.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import { productionTool, styleTool } from "./lab.js";
import { SearchPlayback } from "./controller.js";

export default function composed(pi: ExtensionAPI): void {
  codexUi(pi);
  const playback = new SearchPlayback();
  playback.check = process.env.PI_SEARCH_LAB_CHECK === "gray" ? "gray" : "green";
  playback.style = process.env.PI_SEARCH_LAB_STYLE === "accent" ? "accent" : "minimal";
  playback.scene = process.env.PI_SEARCH_LAB_SCENE === "error" ? "error" : "success";
  const invalidators = new Map<string, () => void>();
  let ui: ExtensionContext | undefined;
  const hint = () => ui?.ui.setWidget("search-lab", (_tui, theme) => new Text(
    theme.fg("muted", `${playback.style === "accent" ? "Accent" : "Minimal"} · ${playback.check} check · offline playback`) + "\n" +
    theme.fg("dim", "/search-style minimal|accent · /search-replay · /search-check green|gray · Ctrl+O expand"), 1, 0));
  const unsubscribe = playback.subscribe(() => {
    for (const invalidate of invalidators.values()) invalidate();
  });
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ui = ctx;
    const tool = styleTool(await productionTool(ctx.cwd), playback);
    pi.registerTool({
      ...tool,
      renderCall(args, theme, context) {
        invalidators.set(context.toolCallId, context.invalidate);
        return tool.renderCall!(args, theme, context);
      },
    });
    pi.setActiveTools([]);
    hint();
    if (process.env.PI_SEARCH_LAB_SETTLED !== "1") playback.replay();
  });
  for (const [name, description, action] of [
    ["replay", "Replay the six-second search animation", () => playback.replay()],
    ["pause", "Pause or resume search playback", () => playback.pause()],
    ["finish", "Show the completed search result", () => playback.finish()],
  ] as const) pi.registerCommand(`search-${name}`, { description, handler: async () => { action(); } });
  pi.registerCommand("search-style", {
    description: "Switch color variants: minimal or accent",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value !== "minimal" && value !== "accent") { ctx.ui.notify("Use /search-style minimal|accent", "warning"); return; }
      playback.setStyle(value);
      hint();
    },
  });
  pi.registerCommand("search-check", {
    description: "Compare completion check colors: green or gray",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value !== "green" && value !== "gray") { ctx.ui.notify("Use /search-check green|gray", "warning"); return; }
      playback.setCheck(value);
      hint();
    },
  });
  pi.registerCommand("search-scene", {
    description: "Replay a success or error fixture",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value !== "success" && value !== "error") { ctx.ui.notify("Use /search-scene success|error", "warning"); return; }
      playback.setScene(value);
    },
  });
  pi.registerShortcut("alt+r", { description: "Replay search", handler: async () => playback.replay() });
  pi.registerShortcut("alt+p", { description: "Pause search", handler: async () => playback.pause() });
  pi.registerShortcut("alt+g", { description: "Toggle green or gray completion check", handler: async () => {
    playback.setCheck(playback.check === "green" ? "gray" : "green");
    hint();
  } });
  pi.on("session_shutdown", () => {
    playback.dispose();
    unsubscribe();
    invalidators.clear();
    ui = undefined;
  });
  pi.on("input", () => ({ action: "handled" }));
  pi.on("tool_call", () => ({ block: true, reason: "Tool execution is disabled in this UI prototype." }));
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this UI prototype.", exitCode: 1, cancelled: false, truncated: false } }));
  pi.registerProvider("search-ui-fixture", {
    api: "openai-responses", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-not-a-secret",
    models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1 }],
    streamSimple() { throw new Error("Model requests are disabled in this UI prototype."); },
  });
}
