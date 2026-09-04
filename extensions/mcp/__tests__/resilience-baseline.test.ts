import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockTransport {
  close: ReturnType<typeof vi.fn>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  stderr: null;
  pid: number;
}

interface MockClient {
  connect: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  closeOperation: ReturnType<typeof vi.fn>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
}

const mocks = vi.hoisted(() => ({
  connectResults: [] as Array<Error | "ok">,
  clients: [] as MockClient[],
  transports: [] as MockTransport[],
}));

function createTransport(): MockTransport {
  const transport: MockTransport = {
    close: vi.fn(async () => {
      transport.onclose?.();
    }),
    stderr: null,
    pid: 1000 + mocks.transports.length,
  };
  mocks.transports.push(transport);
  return transport;
}

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(createTransport),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(createTransport),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(createTransport),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(function () {
    const transport = mocks.transports.at(-1)!;
    const connectResult = mocks.connectResults.shift() ?? "ok";
    const closeOperation = vi.fn(async () => {
      await transport.close();
      client.onclose?.();
    });
    const client: MockClient = {
      connect: connectResult === "ok"
        ? vi.fn().mockResolvedValue(undefined)
        : vi.fn().mockRejectedValue(connectResult),
      listTools: vi.fn().mockResolvedValue({
        tools: [{
          name: "query",
          description: "Query",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: false },
        }],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        isError: false,
      }),
      close: closeOperation,
      closeOperation,
    };
    mocks.clients.push(client);
    return client;
  }),
}));

import { McpClientManager } from "../src/client.js";

const noBackground = {
  retry: { background: false, baseDelayMs: 1, maxDelayMs: 1 },
};

describe("MCP resilience baseline", () => {
  beforeEach(() => {
    mocks.connectResults.length = 0;
    mocks.clients.length = 0;
    mocks.transports.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not write diagnostics to stdout or stderr by default", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.connectResults.push(new Error("fetch failed"));

    const manager = new McpClientManager();
    await manager.connectServer("remote", {
      type: "http",
      url: "https://example.invalid/mcp",
      ...noBackground,
    });

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    await manager.disconnectAll();
  });

  it("retries transient Streamable HTTP failures within a bounded attempt count", async () => {
    mocks.connectResults.push(
      Object.assign(new Error("Streamable HTTP error: unavailable"), { code: 503 }),
      Object.assign(new Error("Streamable HTTP error: unavailable"), { code: 503 }),
      "ok",
    );

    const manager = new McpClientManager();
    const state = await manager.connectServer("remote", {
      type: "streamable-http",
      url: "https://example.invalid/mcp",
      connectTimeout: 1_000,
      retry: { background: false, baseDelayMs: 1, maxDelayMs: 1 },
    });

    expect(state.connected).toBe(true);
    expect(mocks.clients).toHaveLength(3);
    await manager.disconnectAll();
  });

  it("does not expose a large HTTP error body in user-facing state", async () => {
    const html = `<html><title>Web server is down</title><body>${"secret-body ".repeat(2000)}</body></html>`;
    mocks.connectResults.push(Object.assign(new Error(`Streamable HTTP error: ${html}`), { code: 520 }));

    const manager = new McpClientManager();
    const state = await manager.connectServer("remote", {
      type: "http",
      url: "https://example.invalid/mcp",
      retry: { background: false, maxAttempts: 1 },
    });

    expect(state.error?.length ?? 0).toBeLessThanOrEqual(300);
    expect(state.error).not.toContain("secret-body secret-body secret-body");
    await manager.disconnectAll();
  });

  it("reconnects a dropped transport without replaying an unsafe tool call", async () => {
    const manager = new McpClientManager();
    await manager.connectServer("writer", {
      command: "mock-server",
      ...noBackground,
    });
    mocks.clients[0].callTool.mockRejectedValueOnce(new Error("transport closed"));

    await expect(manager.callTool("mcp__writer__query", { value: 1 })).rejects.toThrow();
    expect(mocks.clients[0].callTool).toHaveBeenCalledTimes(1);
    expect(mocks.clients.at(-1)?.callTool).not.toHaveBeenCalled();
    await manager.disconnectAll();
  });

  it("lets Client own transport shutdown so each transport closes once", async () => {
    const manager = new McpClientManager();
    await manager.connectServer("local", {
      command: "mock-server",
      ...noBackground,
    });

    await manager.disconnectAll();

    expect(mocks.clients[0].closeOperation).toHaveBeenCalledTimes(1);
    expect(mocks.transports[0].close).toHaveBeenCalledTimes(1);
  });
});
