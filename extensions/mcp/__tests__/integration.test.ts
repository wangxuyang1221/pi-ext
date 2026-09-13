import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import registerMcpExtension from "../src/index.js";
import { LocalHttpMcpFixture } from "./fixtures/http-mcp-fixture.js";

let tempDirectory = "";
let fixture: LocalHttpMcpFixture | undefined;
let inheritedPiSubagent: string | undefined;

beforeEach(() => {
  inheritedPiSubagent = process.env.PI_SUBAGENT;
  delete process.env.PI_SUBAGENT;
});

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
  tempDirectory = "";
  if (inheritedPiSubagent === undefined) delete process.env.PI_SUBAGENT;
  else process.env.PI_SUBAGENT = inheritedPiSubagent;
  vi.restoreAllMocks();
});

describe("MCP Pi API and renderer integration", () => {
  it.each(["cancelled", "timeout"])("renders a real HTTP %s diagnostic as warning after history serialization", async (outcome) => {
    fixture = await LocalHttpMcpFixture.start({ toolCallFailures: [{ kind: "timeout" }] });
    tempDirectory = mkdtempSync(join(process.cwd(), ".tmp-mcp-status-"));
    mkdirSync(join(tempDirectory, ".pi"), { recursive: true });
    writeFileSync(join(tempDirectory, ".pi", "mcp.json"), JSON.stringify({ mcpServers: {
      remote: { type: "streamable-http", url: fixture.url, connectTimeout: 2000,
        requestTimeout: outcome === "timeout" ? 50 : 2000, maxRequestTimeout: outcome === "timeout" ? 100 : 2000,
        retry: { maxAttempts: 1, background: false } },
    } }));
    const pi = createPiHarness();
    const ctx = createTuiContext(tempDirectory);
    registerMcpExtension(pi.api as never);
    try {
      await pi.emit("session_start", {}, ctx);
      const tool = pi.tools.get("mcp__remote__echo");
      expect(tool).toBeDefined();
      const controller = new AbortController();
      const execution = tool.execute("call", { text: "hello" }, controller.signal).catch((error: Error) => error);
      if (outcome === "cancelled") {
        await vi.waitFor(() => expect(fixture!.count("tools/call")).toBe(1), { interval: 5 });
        controller.abort();
      }
      const error = await execution;
      expect(error).toBeInstanceOf(Error);
      const result = JSON.parse(JSON.stringify({ content: [{ type: "text", text: error.message }], details: {} }));
      const theme = { ...ctx.ui.theme, fg: (color: string, text: string) => color === "warning" ? `\x1b[33m${text}\x1b[39m` : text };
      const renderContext = { state: {}, isError: true, isPartial: false, executionStarted: true, lastComponent: undefined };
      const call = tool.renderCall({ text: "hello" }, theme, renderContext);
      const body = tool.renderResult(result, { isPartial: false, expanded: true }, theme, renderContext);
      expect(call.render(120)[0]).toContain("\x1b[33m⏺\x1b[39m");
      expect(body.render(120).join("\n")).toContain(`\x1b[33m${outcome === "cancelled" ? "Interrupted" : "Timed out"}\x1b[39m`);
      expect(fixture.count("tools/call")).toBe(1);
    } finally {
      await pi.emit("session_shutdown", {}, ctx);
      await fixture.close();
      expect(fixture.server.listening).toBe(false);
      await vi.waitFor(() => expect(fixture!.sockets.size).toBe(0), { interval: 5 });
    }
  });

  it("keeps a local HTTP 520 failure bounded in TUI renderers and out of process logs", async () => {
    const privateBody = "private-cloudflare-body ".repeat(10_000);
    fixture = await LocalHttpMcpFixture.start({
      failures: [{
        kind: "status",
        status: 520,
        contentType: "text/html",
        body: `<!doctype html><html><head><title>Unknown Error</title></head><body>${privateBody}Cloudflare Ray ID:<strong>abc123def456</strong></body></html>`,
      }],
    });
    tempDirectory = mkdtempSync(join(process.cwd(), ".tmp-mcp-pi-smoke-"));
    mkdirSync(join(tempDirectory, ".pi"), { recursive: true });
    writeFileSync(join(tempDirectory, ".pi", "mcp.json"), JSON.stringify({
      mcpServers: {
        remote: {
          type: "streamable-http",
          url: fixture.url,
          connectTimeout: 2_000,
          retry: { maxAttempts: 1, background: false },
        },
      },
    }), "utf8");

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pi = createPiHarness();
    const ctx = createTuiContext(tempDirectory);
    registerMcpExtension(pi.api as never);

    await pi.emit("session_start", {}, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    const notification = String(ctx.ui.notify.mock.calls[0][0]);
    expect(visibleWidth(notification)).toBeLessThanOrEqual(300);
    expect(notification).not.toContain("<html>");
    expect(notification).not.toContain("private-cloudflare-body");
    expect(notification).not.toContain("\n    at ");

    await pi.commands.get("mcp").handler("logs remote", ctx);
    const lines = ctx.component.render(80) as string[];
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
    const rendered = lines.join("\n");
    expect(rendered).toContain("520");
    expect(rendered).not.toContain("<html>");
    expect(rendered).not.toContain("private-cloudflare-body");
    expect(rendered).not.toContain("\n    at ");
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    await pi.emit("session_shutdown", {}, ctx);
  });
});

function createPiHarness() {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  let active: string[] = [];
  const api = {
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => { active = names; },
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn((name: string, definition: unknown) => commands.set(name, definition)),
    registerTool: vi.fn((definition: any) => tools.set(definition.name, definition)),
    registerEntryRenderer: vi.fn(),
    appendEntry: vi.fn(),
  };
  return {
    api,
    commands,
    tools,
    async emit(event: string, payload: unknown, ctx: unknown): Promise<void> {
      for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
    },
  };
}

function createTuiContext(cwd: string) {
  let component: any;
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  return {
    cwd,
    sessionManager: { getEntries: () => [] },
    mode: "tui" as const,
    hasUI: true,
    isProjectTrusted: vi.fn(() => true),
    waitForIdle: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    ui: {
      theme,
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      onTerminalInput: vi.fn(() => vi.fn()),
      confirm: vi.fn(async () => false),
      custom: vi.fn(async (factory: (...args: any[]) => unknown) => {
        component = factory({ requestRender: vi.fn() }, theme, {}, vi.fn());
      }),
    },
    get component() {
      return component;
    },
  };
}
