import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { renderCodexStartup } from "./codex-startup.js";
import { fixture, scenes, variantNames, variants, type Scene } from "./fixtures.js";
import { renderPanel, type Server, type Variant } from "./renderers.js";

interface Snapshot {
  variant: Variant;
  servers: Server[];
  details: boolean;
  scene: Scene | "interrupted";
}

function panel(snapshot: Snapshot, theme: Theme): Component {
  return {
    render(width) { return renderPanel(snapshot.variant, snapshot.servers, snapshot.details, theme, width); },
    invalidate() {},
  };
}

export default function mcpUiPrototype(pi: ExtensionAPI): void {
  // A local model fixture avoids login warnings without borrowing user credentials.
  pi.registerProvider("mcp-ui-fixture", {
    name: "MCP UI fixture",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "fixture-not-a-credential",
    api: "mcp-ui-fixture",
    models: [{
      id: "ui-preview", name: "UI preview", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096,
    }],
    streamSimple() { throw new Error("Model calls are disabled in the MCP UI prototype"); },
  });
  let variant: Variant = "minimal";
  let scene: Scene | "interrupted" = "ready";
  let servers = fixture(scene);
  let details = false;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let animation: ReturnType<typeof setInterval> | undefined;
  let codexStartedAt: number | undefined;
  let requestAnimationFrame: (() => void) | undefined;
  let detachInterrupt: (() => void) | undefined;

  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
    clearInterval(animation);
    animation = undefined;
    codexStartedAt = undefined;
    requestAnimationFrame = undefined;
    detachInterrupt?.();
    detachInterrupt = undefined;
  };
  const snapshot = (): Snapshot => ({ variant, scene, details, servers: structuredClone(servers) });
  const draw = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("mcp-prototype-controls", (_tui, theme) => ({
      render: (width) => [
        theme.fg("accent", truncateToWidth(`MCP UI lab · ${variantNames[variant]} · ${scene} · fixture${details ? " · details" : ""}`, width)),
        theme.fg("dim", truncateToWidth("/mcp-ui 1|2|3|4|compare · /mcp-scene · /mcp-play · /mcp-details · /mcp", width)),
        "",
      ],
      invalidate() {},
    }));
    const startedAt = codexStartedAt;
    if (variant === "codex") {
      ctx.ui.setWidget("mcp-prototype-panel", startedAt === undefined ? undefined : (tui) => {
        requestAnimationFrame = () => tui.requestRender?.();
        return {
          render: (width) => renderCodexStartup(servers, Date.now() - startedAt, width),
          invalidate() {},
        };
      });
    } else {
      ctx.ui.setWidget("mcp-prototype-panel", (_tui, theme) => panel(snapshot(), theme));
    }
    ctx.ui.setStatus("mcp-prototype", "Fixture data · no MCP connections");
  };
  const save = (selected: Variant, expanded: boolean) => {
    pi.appendEntry("mcp-ui-prototype", { ...snapshot(), variant: selected, details: expanded });
  };

  const startCodexReplay = (ctx: ExtensionContext, mode: string) => {
    if (ctx.mode !== "tui") return;
    stop();
    scene = "connecting";
    const chooseServers = (next: Scene, online = 3) => fixture(next, online).filter((server) => mode !== "single" || server.name === "mysql");
    servers = chooseServers(scene, 0);
    codexStartedAt = Date.now();
    draw(ctx);
    detachInterrupt = ctx.ui.onTerminalInput((data) => {
      if (!matchesKey(data, "escape")) return;
      const pending = servers.filter((server) => !server.connected).map((server) => server.name).sort();
      stop();
      servers = servers.map((server) => server.connected ? server : {
        ...server, status: "offline", lastError: { category: "cancelled", message: "Startup interrupted", retryable: false },
      });
      scene = "interrupted";
      draw(ctx);
      ctx.ui.notify(`MCP startup interrupted. The following servers were not initialized: ${pending.join(", ")}`, "warning");
      return { consume: true };
    });
    animation = setInterval(() => requestAnimationFrame?.(), 50);
    const frames: Array<[number, Scene, number]> = mode === "single" ? [[4800, "ready", 4]] : [
      [1200, "connecting", 1], [2400, "connecting", 2], [3600, "connecting", 3],
      [4800, mode === "failed" ? "failed" : "ready", 4],
    ];
    timers = frames.map(([delay, next, online], index) => setTimeout(() => {
      scene = next;
      servers = chooseServers(next, online);
      if (index === frames.length - 1) stop();
      draw(ctx);
      if (next === "failed") ctx.ui.notify("MCP startup incomplete (failed: mysql)", "warning");
    }, delay));
  };

  pi.registerEntryRenderer("mcp-ui-prototype", (entry, _options, theme) => {
    const saved = entry.data as Snapshot;
    return {
      render(width) {
        return ["", theme.fg("dim", truncateToWidth(`${variantNames[saved.variant]} · ${saved.scene} · fixture snapshot`, width)), "",
          ...renderPanel(saved.variant, saved.servers, saved.details, theme, width), ""];
      },
      invalidate() {},
    };
  });

  pi.on("session_start", (_event, ctx) => {
    stop();
    pi.setActiveTools([]);
    draw(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    stop();
    ctx.ui.setWidget("mcp-prototype-controls", undefined);
    ctx.ui.setWidget("mcp-prototype-panel", undefined);
    ctx.ui.setStatus("mcp-prototype", undefined);
  });
  pi.on("input", (_event, ctx) => {
    ctx.ui.notify("UI prototype only. Use /mcp-ui, /mcp-scene, /mcp-play or /mcp-quit.", "info");
    return { action: "handled" };
  });
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this prototype.", exitCode: 0, cancelled: false, truncated: false } }));

  pi.registerCommand("mcp-ui", {
    description: "Choose 1 minimal, 2 table, 3 progress, 4 Codex reference, or compare",
    getArgumentCompletions: (prefix) => ["1", "2", "3", "4", "codex", "compare"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    async handler(args, ctx) {
      let choice = args.trim();
      if (!choice) {
        const selected = await ctx.ui.select("MCP UI variant", variants.map((value) => variantNames[value]));
        if (!selected) return;
        choice = String(variants.findIndex((value) => variantNames[value] === selected) + 1);
      }
      if (choice === "compare") {
        for (const selected of variants) save(selected, details);
        return;
      }
      const selected = choice === "codex" ? "codex" : variants[Number(choice) - 1];
      if (!selected) { ctx.ui.notify("Usage: /mcp-ui 1|2|3|4|codex|compare", "warning"); return; }
      if (variant === "codex" || selected === "codex") stop();
      variant = selected;
      draw(ctx);
      if (variant === "codex") save(variant, false);
    },
  });
  pi.registerCommand("mcp-scene", {
    description: "Choose connecting, ready, retrying or failed fixture data",
    getArgumentCompletions: (prefix) => scenes.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    async handler(args, ctx) {
      const selected = args.trim() || await ctx.ui.select("MCP fixture scene", [...scenes]);
      if (!selected) return;
      if (!scenes.includes(selected as Scene)) { ctx.ui.notify("Usage: /mcp-scene connecting|ready|retrying|failed", "warning"); return; }
      stop();
      scene = selected as Scene;
      servers = fixture(scene);
      draw(ctx);
      if (variant === "codex") save(variant, false);
    },
  });
  pi.registerCommand("mcp-details", {
    description: "Toggle service details in the live preview",
    async handler(_args, ctx) {
      if (variant === "codex") { save(variant, true); return; }
      details = !details;
      draw(ctx);
    },
  });
  pi.registerCommand("mcp", {
    description: "Print MCP status; use verbose for the full Codex reference inventory",
    getArgumentCompletions: (prefix) => "verbose".startsWith(prefix) ? [{ value: "verbose", label: "verbose" }] : null,
    async handler(args, ctx) {
      const argument = args.trim().toLowerCase();
      if (variant === "codex" && argument && argument !== "verbose") {
        ctx.ui.notify("Usage: /mcp [verbose]", "warning");
        return;
      }
      save(variant, variant !== "codex" || argument === "verbose");
    },
  });
  pi.registerCommand("mcp-play", {
    description: "Replay startup; Codex also supports single and failed scenarios",
    getArgumentCompletions: (prefix) => ["single", "failed"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    async handler(args, ctx) {
      if (variant === "codex") {
        const mode = args.trim().toLowerCase();
        if (mode && mode !== "single" && mode !== "failed") {
          ctx.ui.notify("Usage: /mcp-play [single|failed]", "warning");
          return;
        }
        startCodexReplay(ctx, mode);
        return;
      }
      stop();
      scene = "connecting";
      servers = fixture(scene, 0);
      draw(ctx);
      const frames: Array<[Scene, number]> = [["connecting", 1], ["connecting", 3], ["retrying", 3], ["ready", 4]];
      timers = frames.map(([next, online], index) => setTimeout(() => {
        scene = next;
        servers = fixture(next, online);
        draw(ctx);
        if (index === frames.length - 1) timers = [];
      }, (index + 1) * 1200));
    },
  });
  pi.registerCommand("mcp-quit", {
    description: "Close the disposable prototype session",
    async handler(_args, ctx) { ctx.shutdown(); },
  });
}
