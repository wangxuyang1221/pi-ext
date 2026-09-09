import { describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { renderCodexStartup } from "../../../prototypes/mcp-status-ui-prototype/src/codex-startup.js";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import prototype from "../../../prototypes/mcp-status-ui-prototype/src/index.js";
import { fixture } from "../../../prototypes/mcp-status-ui-prototype/src/fixtures.js";
import { renderPanel, type Server } from "../../../prototypes/mcp-status-ui-prototype/src/renderers.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
const servers: Server[] = [["context7", 2], ["MultiFetch", 5], ["mysql", 3], ["exa", 3]].map(([name, count]) => ({
  name: String(name), connected: true, status: "connected", attempt: 1,
  tools: Array.from({ length: Number(count) }, (_, i) => ({ name: `tool-${i}`, inputSchema: {} })),
}));

describe("MCP status UI prototype", () => {
  it("keeps healthy minimal status to one line without retry noise", () => {
    expect(renderPanel("minimal", servers, false, theme, 80)).toEqual([
      "✓ MCP ready · 4 servers · 13 tools",
    ]);
  });

  it("offers aligned table details and a collapsed progress result", () => {
    const table = renderPanel("table", servers, false, theme, 80).join("\n");
    expect(table).toContain("SERVER");
    expect(table).toContain("TOOLS");
    expect(table).toContain("Connected");
    expect(table).not.toContain("attempt");
    const rows = table.split("\n").filter((line) => line.startsWith("●"));
    expect(new Set(rows.map((row) => row.indexOf("Connected"))).size).toBe(1);
    expect(rows).toHaveLength(4);
    const progress = renderPanel("progress", servers, false, theme, 80);
    expect(progress).toHaveLength(2);
    expect(progress[0]).toContain("MCP connected");
    expect(progress[1]).toContain("context7 · MultiFetch · mysql · exa");
    expect(renderPanel("minimal", servers, true, theme, 80).join("\n")).toContain("mysql");
  });
  it("shows only actionable failures and excludes unavailable tools from totals", () => {
    for (const status of ["connecting", "retrying", "offline"] as const) {
      const fixture = servers.map((server) => server.name === "mysql" ? {
        ...server, connected: false, status, attempt: status === "connecting" ? 1 : 2,
        lastError: status === "connecting" ? undefined : {
          category: "timeout" as const, message: "Connection timed out", retryable: true,
        },
      } : server);
      for (const variant of ["minimal", "table", "progress"] as const) {
        const output = renderPanel(variant, fixture, false, theme, 80).join("\n");
        expect(output).toContain("3/4");
        expect(output).toContain("10 tools");
        expect(output).toContain("mysql");
        expect(output).not.toContain("READY");
        expect(output).not.toContain("attempt 1");
        if (status === "retrying") expect(output).toContain("attempt 2");
        if (status === "offline") expect(output).toContain("Connection timed out");
      }
    }
  });
  it("fits narrow terminals and handles an empty server list honestly", () => {
    const ansiTheme = { ...theme, fg: (_color: string, text: string) => `\x1b[32m${text}\x1b[39m` } as Theme;
    for (const width of [1, 24, 40, 80, 120]) {
      for (const variant of ["minimal", "table", "progress"] as const) {
        const lines = renderPanel(variant, servers, true, ansiTheme, width);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      }
    }
    expect(renderPanel("minimal", [], false, theme, 80).join("\n")).toContain("No MCP servers configured");
    expect(renderPanel("table", servers, false, theme, 0)).toEqual([]);
  });
  it("switches variants and scenes in the host and cancels replay timers on shutdown", async () => {
    vi.useFakeTimers();
    try {
      const events = new Map<string, Function>();
      const commands = new Map<string, { handler: Function }>();
      const widgets = new Map<string, any>();
      let terminalInput: ((data: string) => unknown) | undefined;
      const unsubscribe = vi.fn(() => { terminalInput = undefined; });
      const ctx = { mode: "tui", hasUI: true, ui: {
        theme, setWidget: (id: string, value: any) => widgets.set(id, value),
        setStatus: vi.fn(), notify: vi.fn(), select: vi.fn(),
        onTerminalInput: (handler: (data: string) => unknown) => { terminalInput = handler; return unsubscribe; },
      } };
      const api = {
        on: (name: string, handler: Function) => events.set(name, handler),
        registerCommand: (name: string, command: { handler: Function }) => commands.set(name, command),
        registerEntryRenderer: vi.fn(), appendEntry: vi.fn(), setActiveTools: vi.fn(), registerProvider: vi.fn(),
      };
      prototype(api as unknown as ExtensionAPI);
      expect(events.has("session_start")).toBe(true);
      await events.get("session_start")!({}, ctx);
      const output = () => widgets.get("mcp-prototype-panel")({}, theme).render(80).join("\n");
      expect(output()).toContain("MCP ready");
      await commands.get("mcp-ui")!.handler("2", ctx);
      expect(output()).toContain("SERVER");
      await commands.get("mcp-scene")!.handler("failed", ctx);
      expect(output()).toContain("Connection timed out");
      await commands.get("mcp-ui")!.handler("compare", ctx);
      expect(api.appendEntry).toHaveBeenCalledTimes(4);
      await commands.get("mcp-play")!.handler("", ctx);
      expect(output()).toContain("0/4");
      await vi.advanceTimersByTimeAsync(6000);
      expect(output()).toContain("13 tools");
      expect(vi.getTimerCount()).toBe(0);
      await commands.get("mcp-play")!.handler("", ctx);
      await commands.get("mcp-scene")!.handler("retrying", ctx);
      expect(vi.getTimerCount()).toBe(0);
      expect(output()).toContain("attempt 2");
      await commands.get("mcp-ui")!.handler("codex", ctx);
      expect(api.appendEntry).toHaveBeenLastCalledWith("mcp-ui-prototype", expect.objectContaining({ variant: "codex", details: false }));
      expect(widgets.get("mcp-prototype-panel")).toBeUndefined();
      await commands.get("mcp")!.handler("", ctx);
      expect(api.appendEntry).toHaveBeenLastCalledWith("mcp-ui-prototype", expect.objectContaining({ variant: "codex", details: false }));
      await commands.get("mcp")!.handler("VERBOSE", ctx);
      expect(api.appendEntry).toHaveBeenLastCalledWith("mcp-ui-prototype", expect.objectContaining({ variant: "codex", details: true }));
      await commands.get("mcp-play")!.handler("", ctx);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      expect(stripVTControlCharacters(output())).toContain("Starting MCP servers (0/4)");
      const firstFrame = output();
      await vi.advanceTimersByTimeAsync(450);
      expect(output()).not.toEqual(firstFrame);
      await vi.advanceTimersByTimeAsync(5000);
      expect(vi.getTimerCount()).toBe(0);
      expect(widgets.get("mcp-prototype-panel")).toBeUndefined();
      expect(unsubscribe).toHaveBeenCalled();
      await commands.get("mcp-play")!.handler("single", ctx);
      expect(stripVTControlCharacters(output())).toContain("Booting MCP server: mysql");
      await commands.get("mcp-play")!.handler("failed", ctx);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ctx.ui.notify).toHaveBeenCalledWith("MCP startup incomplete (failed: mysql)", "warning");
      expect(vi.getTimerCount()).toBe(0);
      await commands.get("mcp-play")!.handler("", ctx);
      expect(terminalInput?.("x")).toBeUndefined();
      expect(terminalInput?.("\x1b")).toEqual({ consume: true });
      expect(vi.getTimerCount()).toBe(0);
      expect(terminalInput).toBeUndefined();
      expect(widgets.get("mcp-prototype-panel")).toBeUndefined();
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("MCP startup interrupted."), "warning");
      await commands.get("mcp")!.handler("", ctx);
      expect(api.appendEntry).toHaveBeenLastCalledWith("mcp-ui-prototype", expect.objectContaining({ scene: "interrupted" }));
      await commands.get("mcp-play")!.handler("", ctx);
      await commands.get("mcp-ui")!.handler("3", ctx);
      expect(vi.getTimerCount()).toBe(0);
      expect(output()).toContain("Connecting MCP servers");
      await commands.get("mcp-play")!.handler("", ctx);
      await commands.get("mcp-ui")!.handler("codex", ctx);
      await commands.get("mcp-play")!.handler("", ctx);
      await commands.get("mcp-scene")!.handler("ready", ctx);
      expect(vi.getTimerCount()).toBe(0);
      expect(terminalInput).toBeUndefined();
      await commands.get("mcp-play")!.handler("", ctx);
      await events.get("session_shutdown")!({}, ctx);
      expect(vi.getTimerCount()).toBe(0);
      expect(widgets.get("mcp-prototype-panel")).toBeUndefined();
      expect(await events.get("input")!({ text: "hello" }, ctx)).toEqual({ action: "handled" });
      expect(fixture("ready").reduce((sum, server) => sum + server.tools.length, 0)).toBe(13);
    } finally {
      vi.useRealTimers();
    }
  });
  it("renders progress details as a service inventory without completion fractions", () => {
    const lines = renderPanel("progress", servers, true, theme, 80);
    expect(lines[0]).toMatch(/^MCP servers\s+13 tools$/);
    expect(lines.slice(2).map((line) => line.trimEnd())).toEqual([
      "✓ context7" + " ".repeat(29) + "2",
      "✓ MultiFetch" + " ".repeat(27) + "5",
      "✓ mysql" + " ".repeat(32) + "3",
      "✓ exa" + " ".repeat(34) + "3",
    ]);
    expect(lines.join("\n")).not.toMatch(/4\/4|Connected|attempt/);
    expect(renderPanel("progress", servers, false, theme, 80)).toEqual([
      "✓ MCP connected · 13 tools", "  context7 · MultiFetch · mysql · exa",
    ]);
  });

  it("puts unavailable services first in progress details with an adjacent diagnostic", () => {
    for (const scene of ["failed", "retrying", "connecting"] as const) {
      const lines = renderPanel("progress", fixture(scene), true, theme, 80);
      expect(lines[0]).toMatch(/^MCP servers\s+10 tools available$/);
      expect(lines[2]).toMatch(scene === "failed" ? /^× mysql\s+Offline$/ : /^◐ mysql\s+(Retrying|Connecting)$/);
      expect(lines[3]).toContain(scene === "connecting" ? "Waiting for server handshake" : "Connection timed out");
      if (scene === "retrying") expect(lines[3]).toContain("attempt 2");
      else expect(lines.join("\n")).not.toContain("attempt");
      expect(lines[4]).toBe("");
      expect(lines[5]).toMatch(/^✓ context7\s+2$/);
      expect(lines.join("\n")).not.toContain("3/4");
      const startup = renderPanel("progress", fixture(scene), false, theme, 80).join("\n");
      expect(startup).toContain("3/4 online · 10 tools");
      expect(startup).toContain(scene === "failed" ? "MCP partially connected" : "Connecting MCP servers");
    }
  });

  it("matches the Codex 0.153.4 compact inventory layout and case-sensitive ordering", () => {
    const lines = renderPanel("codex", servers, false, theme, 80).map(stripVTControlCharacters);
    expect(lines).toEqual([
      "/mcp", "", "🔌  MCP Tools", "",
      "  • MultiFetch: connected (5 tools)",
      "  • context7: connected (2 tools)",
      "  • exa: connected (3 tools)",
      "  • mysql: connected (3 tools)",
      "", "  Use /mcp verbose for tools and resources.",
    ]);
    const styled = renderPanel("codex", servers, false, theme, 80);
    expect(styled[0]).toContain("\x1b[35m");
    expect(styled[4]).toContain("\x1b[1m\x1b[32mconnected\x1b[39m\x1b[22m");
    expect(lines.join("\n")).not.toContain("4/4");
  });

  it("matches Codex verbose fields without the obsolete local-config inventory", () => {
    const sample = {
      ...servers[0], tools: [{ name: "z_tool", inputSchema: {} }, { name: "a_tool", inputSchema: {} }],
      codex: {
        auth: "OAuth", resources: [{ label: "Guide", uri: "fixture://guide" }],
        resourceTemplates: [{ label: "Document", uri: "fixture://docs/{id}" }],
      },
    };
    const lines = renderPanel("codex", [sample], true, theme, 80).map(stripVTControlCharacters);
    expect(lines).toEqual([
      "/mcp", "", "🔌  MCP Tools", "", "  • context7: connected (2 tools)",
      "    • Auth: OAuth", "    • Tools: a_tool, z_tool",
      "    • Resources: Guide (fixture://guide)",
      "    • Resource templates: Document (fixture://docs/{id})", "",
    ]);
    expect(lines.join("\n")).not.toMatch(/Command:|URL:|Status:|Use \/mcp verbose/);
    const emptyInventory = renderPanel("codex", [servers[0]], true, theme, 80).map(stripVTControlCharacters).join("\n");
    expect(emptyInventory).toContain("Auth: Unsupported");
    expect(emptyInventory).toContain("Resources: (none)");
    expect(emptyInventory).toContain("Resource templates: (none)");
  });

  it("maps fixture availability to Codex states without inventing error-detail rows", () => {
    for (const scene of ["failed", "connecting", "retrying"] as const) {
      const output = renderPanel("codex", fixture(scene), false, theme, 80).map(stripVTControlCharacters).join("\n");
      expect(output).toContain(`mysql: ${scene === "failed" ? "failed" : "starting"} (0 tools)`);
      expect(output).not.toMatch(/attempt|Connection timed out|3\/4/);
    }
    const disabled: Server = { ...servers[0], connected: false, status: "disabled" };
    const output = renderPanel("codex", [disabled], true, theme, 80).map(stripVTControlCharacters).join("\n");
    expect(output).toContain("No MCP tools available.");
    expect(output).toContain("context7: disabled (0 tools)");
    expect(output).toContain("Tools: (none)");
    const auth: Server = { ...disabled, status: "offline", lastError: { category: "auth", message: "Authentication failed", retryable: false } };
    expect(renderPanel("codex", [auth], false, theme, 80).map(stripVTControlCharacters).join("\n")).toContain("authentication required (0 tools)");
    const cancelled: Server = { ...auth, lastError: { category: "cancelled", message: "Startup interrupted", retryable: false } };
    expect(renderPanel("codex", [cancelled], false, theme, 80).map(stripVTControlCharacters).join("\n")).toContain("cancelled (0 tools)");
    expect(renderPanel("codex", [{ ...servers[0], tools: servers[0].tools.slice(0, 1) }], false, theme, 80).map(stripVTControlCharacters).join("\n")).toContain("(1 tool)");
    expect(renderPanel("codex", [], false, theme, 80).map(stripVTControlCharacters).join("\n")).toContain("See the MCP docs to configure them.");
    for (const width of [1, 24, 40, 80, 120]) {
      for (const verbose of [true, false]) {
        expect(renderPanel("codex", fixture("failed"), verbose, theme, width).every((line) => visibleWidth(line) <= width)).toBe(true);
      }
    }
  });

  it("renders Codex startup progress with pending names and time-varying emphasis", () => {
    const initial = renderCodexStartup(fixture("connecting", 0), 0, 120);
    expect(initial.map(stripVTControlCharacters)).toEqual([
      "• Starting MCP servers (0/4): MultiFetch, context7, exa, … (0s • esc to interrupt)",
    ]);
    const later = renderCodexStartup(fixture("connecting", 0), 450, 120);
    expect(later).not.toEqual(initial);
    expect(later.map(stripVTControlCharacters)).toEqual(initial.map(stripVTControlCharacters));
    expect(renderCodexStartup(fixture("connecting", 3), 3000, 120).map(stripVTControlCharacters)[0]).toContain("Starting MCP servers (3/4): mysql (3s • esc to interrupt)");
    expect(renderCodexStartup(fixture("connecting", 0).filter((server) => server.name === "mysql"), 0, 120).map(stripVTControlCharacters)[0]).toContain("Booting MCP server: mysql");
    expect(renderCodexStartup(fixture("ready"), 5000, 120)).toEqual([]);
    expect(renderCodexStartup(fixture("failed"), 5000, 120)).toEqual([]);
    expect(renderCodexStartup([], 0, 120)).toEqual([]);
    for (const width of [0, 1, 24, 40, 80, 120]) {
      expect(renderCodexStartup(fixture("connecting", 0), 1000, width).every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("provides a named offline model fixture that cannot make model requests", () => {
    const api = { on: vi.fn(), registerCommand: vi.fn(), registerEntryRenderer: vi.fn(), registerProvider: vi.fn() };
    prototype(api as unknown as ExtensionAPI);
    expect(api.registerProvider).toHaveBeenCalledWith("mcp-ui-fixture", expect.any(Object));
    const config = api.registerProvider.mock.calls[0][1];
    expect(config.models[0].id).toBe("ui-preview");
    expect(() => config.streamSimple()).toThrow("Model calls are disabled");
  });
});
