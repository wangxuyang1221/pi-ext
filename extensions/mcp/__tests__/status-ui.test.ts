import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { inventoryComponent, inventoryServer } from "../src/status-ui.js";
import { McpStartup } from "../src/startup-ui.js";
import type { McpServerState } from "../src/types.js";

const theme = {
  fg: (color: string, text: string) => `\x1b[${color === "dim" ? 90 : 37}m${text}\x1b[39m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as Theme;
const plain = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, "");

function state(overrides: Partial<McpServerState> = {}): McpServerState {
  return { config: { command: "private-command", env: { TOKEN: "private-token" } },
    connected: true, status: "connected", attempt: 1, generation: 1,
    tools: ["query", "query", "find"].map((name) => ({ name, inputSchema: {} })), ...overrides };
}

function startup(names: string[], mode = "tui") {
  let component: { render(width: number): string[] } | undefined;
  const requestRender = vi.fn();
  const setWidget = vi.fn((_key: string, factory: any) => {
    component = factory?.({ requestRender }, theme);
  });
  const ctx = { mode, hasUI: mode === "tui" || mode === "rpc", ui: {
    setWidget, onTerminalInput: vi.fn(() => vi.fn()),
  } };
  const connected = vi.fn(() => false);
  const batch = new McpStartup(names, ctx as unknown as ExtensionContext, connected, vi.fn());
  return { batch, ctx, connected, requestRender, lines: (width: number) => component?.render(width) ?? [] };
}

afterEach(() => vi.useRealTimers());

describe("MCP inventory presentation", () => {
  it("captures only sanitized display fields and excludes stale tools and transport secrets", () => {
    const snapshot = inventoryServer("docs\x1b[2J\nspoof", state());
    expect(snapshot).toEqual({ name: "docs spoof", status: "connected", tools: ["find", "query"] });
    expect(JSON.stringify(snapshot)).not.toContain("private");
    expect(inventoryServer("docs", state({ connected: false, status: "offline" })).tools).toEqual([]);
    expect(inventoryServer("docs", undefined).status).toBe("unknown");
  });

  it.each([
    [{ connected: false, status: "disabled" }, "disabled"],
    [{ connected: false, status: "retrying" }, "starting"],
    [{ connected: false, status: "offline", lastError: { category: "auth" } }, "authentication required"],
    [{ connected: false, status: "offline", lastError: { category: "cancelled" } }, "cancelled"],
    [{ connected: false, status: "offline" }, "failed"],
  ])("maps actual connection state %j without invented metadata", (overrides, expected) => {
    expect(inventoryServer("docs", state(overrides as Partial<McpServerState>)).status).toBe(expected);
  });

  it("wraps long catalogs safely and caches unchanged widths", () => {
    const server = inventoryServer("界".repeat(100), state({ tools: Array.from({ length: 200 }, (_, i) => ({
      name: `tool_${i}_${"界".repeat(40)}`, inputSchema: {},
    })) }));
    const component = inventoryComponent({ servers: [server], verbose: true }, theme);
    expect(component.render(0)).toEqual([]);
    expect(component.render(-1)).toEqual([]);
    for (const width of [1, 24, 40, 80, 120]) {
      const lines = component.render(width);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(component.render(width)).toBe(lines);
    }
    expect(plain(component.render(120).join("\n"))).toContain("tool_199");
    component.invalidate();
    expect(component.render(40).every((line) => visibleWidth(line) <= 40)).toBe(true);
  });

  it("distinguishes an empty configuration from an empty connected tool catalog", () => {
    const empty = inventoryComponent({ servers: [], verbose: false }, theme);
    expect(plain(empty.render(80).join("\n"))).toContain("No MCP servers configured.");
    const noTools = inventoryComponent({ servers: [inventoryServer("docs", state({ tools: [] }))], verbose: true }, theme);
    expect(plain(noTools.render(80).join("\n"))).toContain("Tools: (none)");
  });
});

describe("MCP startup presentation", () => {
  it("bounds pending names and counts every completed task, even when one of four remains", () => {
    vi.useFakeTimers();
    const fixture = startup(["zeta", "beta", "alpha", "gamma"]);
    expect(plain(fixture.lines(160).join("\n"))).toContain("Starting MCP servers (0/4): alpha, beta, gamma, …");
    for (const name of ["alpha", "beta", "gamma"]) fixture.batch.settle(name);
    expect(plain(fixture.lines(160).join("\n"))).toContain("Starting MCP servers (3/4): zeta");
    for (const width of [0, -1, 1, 24, 40, 80, 120]) {
      expect(fixture.lines(width).every((line) => visibleWidth(line) <= Math.max(0, width))).toBe(true);
    }
    fixture.batch.settle("zeta");
    expect(fixture.lines(160)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one redraw timer with no connection reads and stops all redraws after disposal", async () => {
    vi.useFakeTimers();
    const fixture = startup(["mysql"]);
    const signal = fixture.batch.signal("mysql")!;
    expect(plain(fixture.lines(100).join("\n"))).toContain("Booting MCP server: mysql");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.requestRender).toHaveBeenCalledTimes(20);
    expect(fixture.connected).not.toHaveBeenCalled();
    expect(fixture.ctx.ui.setWidget).toHaveBeenCalledTimes(1);
    fixture.batch.dispose();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.requestRender).toHaveBeenCalledTimes(20);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["rpc", "json", "print"])("creates no animation or terminal listeners in %s mode", (mode) => {
    vi.useFakeTimers();
    const fixture = startup(["docs"], mode);
    expect(fixture.ctx.ui.setWidget).not.toHaveBeenCalled();
    expect(fixture.ctx.ui.onTerminalInput).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    fixture.batch.dispose();
  });
});
