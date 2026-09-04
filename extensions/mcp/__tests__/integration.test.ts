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
  const api = {
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn((name: string, definition: unknown) => commands.set(name, definition)),
    registerTool: vi.fn((definition: any) => tools.set(definition.name, definition)),
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
    mode: "tui" as const,
    hasUI: true,
    isProjectTrusted: vi.fn(() => true),
    waitForIdle: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    ui: {
      theme,
      notify: vi.fn(),
      setStatus: vi.fn(),
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
