import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client, ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  McpClientManager,
  McpConnectionError,
  McpToolError,
  type McpClientManagerOptions,
} from "../src/client.js";
import { DEFAULT_FIELD_BYTES, McpDiagnostics } from "../src/diagnostics.js";
import type { McpRetryScheduler } from "../src/retry.js";
import type { McpManagerEvent, McpTool } from "../src/types.js";

interface Scenario {
  connect?: (transport: FakeTransport, options?: Record<string, unknown>) => Promise<void>;
  pages?: Array<{ tools: McpTool[]; nextCursor?: string }>;
  calls?: Array<unknown | Error>;
  call?: (
    transport: FakeTransport,
    request: { name: string; arguments?: Record<string, unknown> },
  ) => Promise<unknown>;
  close?: () => Promise<void>;
  capabilities?: Record<string, unknown>;
  onStart?: (transport: FakeTransport) => void;
  sdkClosesOnConnectFailure?: boolean;
}

class FakeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport["onmessage"];
  readonly stderr = new PassThrough();
  readonly pid: number;
  readonly close = vi.fn(async () => {
    this.onclose?.();
  });
  readonly start = vi.fn(async () => {
    this.scenario.onStart?.(this);
  });
  readonly send = vi.fn(async () => undefined);

  constructor(
    readonly scenario: Scenario,
    pid: number,
    readonly fetch?: FetchLike,
  ) {
    this.pid = pid;
  }
}

class FakeClient {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  readonly handlers = new Map<string, (value: unknown) => void>();
  readonly connect = vi.fn(async (transport: FakeTransport, options?: Record<string, unknown>) => {
    this.transport = transport;
    await transport.start();
    try {
      if (this.scenario.connect) await this.scenario.connect(transport, options);
    } catch (error) {
      if (this.scenario.sdkClosesOnConnectFailure) void this.close();
      throw error;
    }
  });
  readonly listTools = vi.fn(async (params?: { cursor?: string }) => {
    const index = params?.cursor ? Number(params.cursor) : 0;
    const page = this.scenario.pages?.[index] ?? { tools: [tool("query")] };
    return {
      tools: page.tools,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  });
  readonly callTool = vi.fn(async (request: { name: string; arguments?: Record<string, unknown> }) => {
    if (this.scenario.call) return this.scenario.call(this.transport!, request);
    const value = this.scenario.calls?.shift() ?? {
      content: [{ type: "text", text: "ok" }],
      isError: false,
    };
    if (value instanceof Error) throw value;
    return value;
  });
  readonly closeOperation = vi.fn(async () => {
    await this.scenario.close?.();
    await this.transport?.close();
    this.onclose?.();
  });
  close = this.closeOperation;
  readonly setLoggingLevel = vi.fn(async () => ({}));
  readonly getServerCapabilities = vi.fn(() => this.scenario.capabilities ?? {});
  readonly setNotificationHandler = vi.fn((schema: { shape?: { method?: { value?: string } } }, handler: (value: unknown) => void) => {
    const method = schema.shape?.method?.value ?? "notifications/message";
    this.handlers.set(method, handler);
  });
  private transport?: FakeTransport;

  constructor(
    readonly scenario: Scenario,
    readonly options: ClientOptions,
  ) {}

  emitClose(): void {
    this.onclose?.();
  }

  emitError(error: Error): void {
    this.onerror?.(error);
  }

  emitLog(params: Record<string, unknown>): void {
    this.handlers.get("notifications/message")?.({ params });
  }

  emitToolListChanged(error: Error | null, tools: McpTool[] | null): void {
    this.options.listChanged?.tools?.onChanged(error, tools as never);
  }
}

class ImmediateScheduler implements McpRetryScheduler {
  time = 0;
  readonly sleeps: number[] = [];
  now = () => this.time;
  sleep = vi.fn(async (delayMs: number, signal?: AbortSignal) => {
    if (signal?.aborted) throw signal.reason;
    this.sleeps.push(delayMs);
    this.time += delayMs;
  });
}

class ControlledScheduler implements McpRetryScheduler {
  time = 0;
  readonly pending: Array<{
    delayMs: number;
    resolve: () => void;
    reject: (reason: unknown) => void;
    cleanup: () => void;
  }> = [];
  now = () => this.time;
  sleep = vi.fn((delayMs: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal?.reason);
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    this.pending.push({ delayMs, resolve: () => {
      cleanup();
      this.time += delayMs;
      resolve();
    }, reject, cleanup });
  }));

  releaseNext(): void {
    const pending = this.pending.shift();
    pending?.resolve();
  }
}

function tool(name: string, readOnlyHint?: boolean): McpTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
    ...(readOnlyHint === undefined ? {} : { annotations: { readOnlyHint } }),
  };
}

function createHarness(
  scenarios: Scenario[],
  overrides: Partial<McpClientManagerOptions> = {},
) {
  const clients: FakeClient[] = [];
  const transports: FakeTransport[] = [];
  let latestTransport: FakeTransport | undefined;
  const manager = new McpClientManager({
    random: () => 1,
    transportFactory: (_config, context) => {
      const scenario = scenarios.shift() ?? {};
      const transport = new FakeTransport(scenario, 1000 + transports.length, context.fetch);
      latestTransport = transport;
      transports.push(transport);
      return transport;
    },
    clientFactory: (options) => {
      const transport = latestTransport!;
      const client = new FakeClient(transport.scenario, options);
      clients.push(client);
      return client as unknown as Client;
    },
    ...overrides,
  });
  return { manager, clients, transports };
}

const noBackground = {
  retry: { maxAttempts: 1, background: false },
} as const;

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("McpClientManager connection lifecycle", () => {
  it("discovers every tools/list page and preserves annotations", async () => {
    const { manager, clients } = createHarness([{
      pages: [
        { tools: [tool("first", true)], nextCursor: "1" },
        { tools: [tool("second", false)] },
      ],
    }]);

    const state = await manager.connectServer("docs", { command: "docs", ...noBackground });

    expect(state.connected).toBe(true);
    expect(state.status).toBe("connected");
    expect(state.tools.map((item) => item.name)).toEqual(["first", "second"]);
    expect(state.tools[0].annotations?.readOnlyHint).toBe(true);
    expect(clients[0].listTools).toHaveBeenNthCalledWith(2, { cursor: "1" }, expect.any(Object));
    await manager.disconnectAll();
  });

  it("retries transient HTTP-style failures within the configured attempt bound", async () => {
    const scheduler = new ImmediateScheduler();
    const unavailable = () => Object.assign(new Error("unavailable"), { code: 503 });
    const { manager, clients } = createHarness([
      { connect: async () => { throw unavailable(); } },
      { connect: async () => { throw unavailable(); } },
      {},
    ], { scheduler });

    const state = await manager.connectServer("remote", {
      type: "http",
      url: "https://example.invalid/mcp",
      connectTimeout: 10_000,
      retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20, background: false },
    });

    expect(state.connected).toBe(true);
    expect(clients).toHaveLength(3);
    expect(scheduler.sleeps).toEqual([10, 20]);
    await manager.disconnectAll();
  });

  it.each([
    new Error("fetch failed"),
    new Error("Connection closed"),
    Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    new Error("Not connected"),
  ])("retries normalized connection failure %#", async (failure) => {
    const scheduler = new ImmediateScheduler();
    const { manager, clients } = createHarness([
      { connect: async () => { throw failure; } },
      {},
    ], { scheduler });

    const state = await manager.connectServer("remote", {
      command: "remote",
      connectTimeout: 10_000,
      retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, background: false },
    });

    expect(state.connected).toBe(true);
    expect(clients).toHaveLength(2);
    await manager.disconnectAll();
  });

  it("does not retry authentication or deterministic protocol failures", async () => {
    for (const failure of [
      Object.assign(new Error("denied"), { code: 401 }),
      new McpError(ErrorCode.InvalidParams, "bad initialize"),
    ]) {
      const { manager, clients } = createHarness([
        { connect: async () => { throw failure; } },
        {},
      ]);
      const state = await manager.connectServer("remote", {
        command: "remote",
        retry: { maxAttempts: 3, background: false },
      });
      expect(state.connected).toBe(false);
      expect(clients).toHaveLength(1);
      await manager.disconnectAll();
    }
  });

  it("does not start background recovery for a non-retryable foreground failure", async () => {
    const scheduler = new ControlledScheduler();
    const { manager, clients } = createHarness([
      { connect: async () => { throw Object.assign(new Error("denied"), { code: 401 }); } },
      {},
    ], { scheduler });

    const state = await manager.connectServer("remote", {
      command: "remote",
      retry: { maxAttempts: 3, background: true },
    });

    expect(state.connected).toBe(false);
    expect(state.status).toBe("offline");
    expect(state.lastError?.category).toBe("auth");
    expect(clients).toHaveLength(1);
    expect(scheduler.pending).toHaveLength(0);
    await manager.disconnectAll();
  });

  it("uses one hard connect deadline and closes a hanging Client", async () => {
    vi.useFakeTimers();
    const { manager, clients, transports } = createHarness([{
      connect: () => new Promise<void>(() => undefined),
    }]);
    const connecting = manager.connectServer("slow", {
      command: "slow",
      connectTimeout: 50,
      ...noBackground,
    });

    await vi.advanceTimersByTimeAsync(50);
    const state = await connecting;

    expect(state.status).toBe("offline");
    expect(state.lastError?.category).toBe("timeout");
    expect(clients[0].closeOperation).toHaveBeenCalledTimes(1);
    expect(transports[0].close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await manager.disconnectAll();
  });

  it("lets Client own transport shutdown exactly once", async () => {
    const { manager, clients, transports } = createHarness([{}]);
    await manager.connectServer("local", { command: "local", ...noBackground });

    await manager.disconnectAll();

    expect(clients[0].closeOperation).toHaveBeenCalledTimes(1);
    expect(transports[0].close).toHaveBeenCalledTimes(1);
  });

  it("coalesces SDK and manager cleanup after initialization fails", async () => {
    const { manager, clients, transports } = createHarness([{
      connect: async () => { throw new Error("invalid initialize result"); },
      sdkClosesOnConnectFailure: true,
    }]);

    const state = await manager.connectServer("local", { command: "local", ...noBackground });

    expect(state.connected).toBe(false);
    expect(clients[0].closeOperation).toHaveBeenCalledTimes(1);
    expect(transports[0].close).toHaveBeenCalledTimes(1);
    await manager.disconnectAll();
  });

  it("falls back to direct transport close only when Client close rejects", async () => {
    const { manager, clients, transports } = createHarness([{}]);
    await manager.connectServer("local", { command: "local", ...noBackground });
    clients[0].closeOperation.mockRejectedValueOnce(new Error("close failed"));

    await manager.disconnectAll();

    expect(clients[0].closeOperation).toHaveBeenCalledTimes(1);
    expect(transports[0].close).toHaveBeenCalledTimes(1);
  });

  it("updates state on unexpected close and ignores callbacks from an old Client", async () => {
    const scheduler = new ControlledScheduler();
    const { manager, clients } = createHarness([{}, {}], { scheduler });
    await manager.connectServer("remote", {
      command: "remote",
      retry: { maxAttempts: 1, background: true, baseDelayMs: 10, maxDelayMs: 10 },
    });
    const oldClient = clients[0];
    await manager.reconnectServer("remote");
    const currentGeneration = manager.getServerState("remote")?.generation;

    oldClient.emitError(new Error("late old error"));
    oldClient.emitClose();

    expect(manager.getServerState("remote")?.generation).toBe(currentGeneration);
    expect(manager.getServerState("remote")?.status).toBe("connected");
    await manager.disconnectAll();
  });

  it("marks a current out-of-band client error degraded without closing it", async () => {
    const { manager, clients } = createHarness([{}]);
    await manager.connectServer("remote", { command: "remote", ...noBackground });

    clients[0].emitError(Object.assign(new Error("socket warning"), { code: "ECONNRESET" }));

    expect(manager.getServerState("remote")?.status).toBe("degraded");
    expect(manager.isServerConnected("remote")).toBe(true);
    await manager.disconnectAll();
  });

  it("hands terminal SDK SSE recovery failure to the background supervisor", async () => {
    const scheduler = new ControlledScheduler();
    const { manager, clients } = createHarness([{}, {}], { scheduler, random: () => 1 });
    await manager.connectServer("remote", {
      type: "streamable-http",
      url: "https://example.invalid/mcp",
      retry: { maxAttempts: 1, background: true, baseDelayMs: 10, maxDelayMs: 10 },
    });

    clients[0].emitError(new Error("Maximum reconnection attempts (2) exceeded."));
    await settle();

    expect(clients[0].closeOperation).toHaveBeenCalledTimes(1);
    expect(manager.isServerConnected("remote")).toBe(false);
    expect(manager.getServerState("remote")?.status).toBe("retrying");
    expect(scheduler.pending).toHaveLength(1);
    await manager.disconnectAll();
  });

  it("does not apply terminal Streamable HTTP recovery handling to stdio errors", async () => {
    const { manager, clients } = createHarness([{}]);
    await manager.connectServer("local", { command: "local", ...noBackground });

    clients[0].emitError(new Error("Maximum reconnection attempts (2) exceeded."));
    await settle();

    expect(manager.getServerState("local")?.status).toBe("degraded");
    expect(manager.isServerConnected("local")).toBe(true);
    expect(clients[0].closeOperation).not.toHaveBeenCalled();
    await manager.disconnectAll();
  });

  it("does not let delayed old-connection cleanup overwrite a completed reconnect", async () => {
    const closeStarted = deferred<void>();
    const closeGate = deferred<void>();
    const { manager, clients } = createHarness([
      {
        close: async () => {
          closeStarted.resolve();
          await closeGate.promise;
        },
      },
      {},
    ]);
    const config = {
      type: "streamable-http" as const,
      url: "https://example.invalid/mcp",
      ...noBackground,
    };
    await manager.connectServer("remote", config);

    clients[0].emitError(new Error("Maximum reconnection attempts (2) exceeded."));
    await closeStarted.promise;
    const reconnected = await manager.reconnectServer("remote");

    expect(reconnected.status).toBe("connected");
    expect(manager.isServerConnected("remote")).toBe(true);
    closeGate.resolve();
    await settle();

    expect(manager.getServerState("remote")?.status).toBe("connected");
    expect(manager.isServerConnected("remote")).toBe(true);
    await manager.disconnectAll();
  });

  it("resolves namespace collisions deterministically instead of using connection order", async () => {
    const { manager, clients } = createHarness([
      { pages: [{ tools: [tool("query")] }] },
      { pages: [{ tools: [tool("b__query")] }] },
    ]);

    await manager.connectServer("a__b", { command: "first", ...noBackground });
    await manager.connectServer("a", { command: "second", ...noBackground });
    await manager.callTool("mcp__a__b__query", {});

    expect([...manager.getAllTools().keys()]).toEqual(["mcp__a__b__query"]);
    expect(clients[0].callTool).not.toHaveBeenCalled();
    expect(clients[1].callTool).toHaveBeenCalledWith(
      { name: "b__query", arguments: {} },
      undefined,
      expect.any(Object),
    );
    expect(JSON.stringify(manager.diagnostics.getEvents())).toContain("Colliding MCP tool name ignored");
    await manager.disconnectAll();
  });

  it("emits immutable state and tool catalog events", async () => {
    const { manager } = createHarness([{}]);
    const events: McpManagerEvent[] = [];
    manager.subscribe((event) => events.push(event));

    await manager.connectServer("docs", { command: "docs", ...noBackground });

    expect(events.some((event) => event.type === "state" && event.state.status === "connected")).toBe(true);
    expect(events.some((event) => event.type === "tools" && event.tools[0]?.name === "query")).toBe(true);
    await manager.disconnectAll();
  });
});

describe("HTTP response safety", () => {
  it.each([429, 503, 520])("retries HTTP %i through the bounded fetch wrapper", async (status) => {
    const scheduler = new ImmediateScheduler();
    const body = status === 520
      ? `<html><title>Web server is down</title><body>${"private-body ".repeat(2000)}</body></html>`
      : "temporarily unavailable";
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(body, {
        status,
        headers: status === 429 ? { "Retry-After": "2", "Content-Length": String(Buffer.byteLength(body)) } : {},
      }))
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const connectViaFetch = async (transport: FakeTransport) => {
      const response = await transport.fetch!("https://example.invalid/mcp", { method: "POST" });
      if (!response.ok) throw Object.assign(new Error(await response.text()), { code: response.status });
    };
    const { manager } = createHarness([
      { connect: connectViaFetch },
      { connect: connectViaFetch },
    ], { fetch, scheduler });

    const state = await manager.connectServer("remote", {
      type: "streamable-http",
      url: "https://example.invalid/mcp",
      connectTimeout: 10_000,
      retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, background: false },
    });

    expect(state.connected).toBe(true);
    if (status === 429) expect(scheduler.sleeps).toEqual([2_000]);
    const details = JSON.stringify(manager.diagnostics.getEvents("remote"));
    expect(Buffer.byteLength(details, "utf8")).toBeLessThan(16_000);
    expect(details).not.toContain("private-body private-body private-body");
    if (status === 520) expect(details).toContain("Web server is down");
    await manager.disconnectAll();
  });

  it("does not retain a successful HTTP status when a later fetch fails", async () => {
    const networkError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    });
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockRejectedValueOnce(networkError);
    const connectViaFetch = async (transport: FakeTransport) => {
      await transport.fetch!("https://example.invalid/initialize", { method: "POST" });
      await transport.fetch!("https://example.invalid/tools", { method: "POST" });
    };
    const { manager } = createHarness([{ connect: connectViaFetch }], { fetch });

    const state = await manager.connectServer("remote", {
      type: "streamable-http",
      url: "https://example.invalid/mcp",
      retry: { maxAttempts: 1, background: false },
    });

    expect(state.lastError).toMatchObject({
      category: "connection",
      code: "ECONNRESET",
    });
    expect(state.lastError?.httpStatus).toBeUndefined();
    await manager.disconnectAll();
  });

  it("stops reading an unterminated HTTP error body at the exact byte limit", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(DEFAULT_FIELD_BYTES)));
      },
      cancel,
    });
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(body, { status: 503 }));
    const connectViaFetch = async (transport: FakeTransport) => {
      const response = await transport.fetch!("https://example.invalid/mcp", { method: "POST" });
      throw Object.assign(new Error(await response.text()), { code: response.status });
    };
    const { manager } = createHarness([{ connect: connectViaFetch }], { fetch });

    const state = await manager.connectServer("remote", {
      type: "streamable-http",
      url: "https://example.invalid/mcp",
      retry: { maxAttempts: 1, background: false },
    });

    expect(state.lastError?.category).toBe("http-transient");
    expect(state.lastError?.truncated).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    await manager.disconnectAll();
  });

  it("does not attach an unrelated concurrent HTTP response to a network failure", async () => {
    const networkError = Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET" });
    const fetch = vi.fn<FetchLike>(async (url) => {
      if (String(url).endsWith("optional-stream")) {
        await Promise.resolve();
        return new Response("Method not allowed", { status: 405 });
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      throw networkError;
    });
    const connectViaFetch = async (transport: FakeTransport) => {
      await Promise.all([
        transport.fetch!("https://example.invalid/optional-stream"),
        transport.fetch!("https://example.invalid/initialize", { method: "POST" }),
      ]);
    };
    const { manager } = createHarness([{ connect: connectViaFetch }], { fetch });

    const state = await manager.connectServer("remote", {
      type: "streamable-http",
      url: "https://example.invalid/mcp",
      retry: { maxAttempts: 1, background: false },
    });

    expect(state.lastError?.category).toBe("connection");
    expect(state.lastError?.httpStatus).toBeUndefined();
    await manager.disconnectAll();
  });

  it("associates concurrent same-status HTTP failures with their originating requests", async () => {
    const bothResponsesObserved = deferred<void>();
    let observedResponses = 0;
    const fetch = vi.fn<FetchLike>(async (url) => {
      const first = String(url).endsWith("/first");
      return new Response(first ? "first response" : "second response", {
        status: 429,
        headers: { "Retry-After": first ? "1" : "9" },
      });
    });
    const scenario: Scenario = {
      call: async (transport, request) => {
        const requestId = String(request.arguments?.requestId);
        const response = await transport.fetch!(`https://example.invalid/${requestId}`, {
          method: "POST",
        });
        observedResponses += 1;
        if (observedResponses === 2) bothResponsesObserved.resolve();
        await bothResponsesObserved.promise;
        throw Object.assign(
          new Error(`Streamable HTTP error: ${await response.text()}`),
          { code: response.status },
        );
      },
    };
    const { manager } = createHarness([scenario], { fetch });
    await manager.connectServer("remote", {
      type: "streamable-http",
      url: "https://example.invalid/mcp",
      ...noBackground,
    });

    const results = await Promise.allSettled([
      manager.callTool("mcp__remote__query", { requestId: "first" }),
      manager.callTool("mcp__remote__query", { requestId: "second" }),
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    const firstError = (results[0] as PromiseRejectedResult).reason as McpToolError;
    const secondError = (results[1] as PromiseRejectedResult).reason as McpToolError;
    expect(firstError.normalizedError).toMatchObject({
      category: "rate-limit",
      httpStatus: 429,
      retryAfterMs: 1_000,
      detail: "first response",
    });
    expect(secondError.normalizedError).toMatchObject({
      category: "rate-limit",
      httpStatus: 429,
      retryAfterMs: 9_000,
      detail: "second response",
    });
    expect(JSON.stringify([firstError, secondError, manager.diagnostics.getEvents()]))
      .not.toContain("__PI_MCP_HTTP_OBSERVATION_");
    await manager.disconnectAll();
  });
});

describe("stdio and server diagnostics", () => {
  it("captures early chunked stderr without writing to process streams", async () => {
    const diagnostics = new McpDiagnostics();
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { manager } = createHarness([{
      onStart: (transport) => {
        transport.stderr.write(Buffer.from("early Bearer sec"));
        transport.stderr.write(Buffer.from("ret\nsecond line\n"));
      },
    }], { diagnostics });

    await manager.connectServer("local", { command: "local", ...noBackground });

    expect(diagnostics.getStderr("local")).toEqual([
      "early Bearer [redacted]",
      "second line",
    ]);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    await manager.disconnectAll();
  });

  it("captures MCP logging notifications and applies configured level", async () => {
    const diagnostics = new McpDiagnostics();
    const { manager, clients } = createHarness([{
      capabilities: { logging: {} },
    }], { diagnostics });

    await manager.connectServer("local", {
      command: "local",
      loggingLevel: "warning",
      ...noBackground,
    });
    clients[0].emitLog({
      level: "warning",
      logger: "fixture",
      data: { Authorization: "Bearer secret-value", message: "notice" },
    });

    expect(clients[0].setLoggingLevel).toHaveBeenCalledWith("warning", expect.any(Object));
    const serialized = JSON.stringify(diagnostics.getEvents("local"));
    expect(serialized).toContain("MCP server log notification");
    expect(serialized).not.toContain("secret-value");
    await manager.disconnectAll();
  });
});

describe("background recovery", () => {
  it("recovers after the foreground attempt and emits a background tool event", async () => {
    const scheduler = new ControlledScheduler();
    const { manager } = createHarness([
      { connect: async () => { throw new Error("fetch failed"); } },
      { pages: [{ tools: [tool("recovered")] }] },
    ], { scheduler, random: () => 1 });
    const events: McpManagerEvent[] = [];
    manager.subscribe((event) => events.push(event));

    const initial = await manager.connectServer("remote", {
      command: "remote",
      connectTimeout: 1_000,
      retry: { maxAttempts: 1, background: true, baseDelayMs: 10, maxDelayMs: 10 },
    });
    expect(initial.connected).toBe(false);
    expect(manager.getServerState("remote")?.status).toBe("retrying");
    expect(scheduler.pending).toHaveLength(1);

    scheduler.releaseNext();
    await settle();

    expect(manager.isServerConnected("remote")).toBe(true);
    expect(events.some((event) => event.type === "tools" && event.source === "background" && event.tools[0]?.name === "recovered")).toBe(true);
    await manager.disconnectAll();
  });

  it("manual reconnect cancels the pending supervisor and starts a new generation", async () => {
    const scheduler = new ControlledScheduler();
    const { manager, clients } = createHarness([
      { connect: async () => { throw new Error("fetch failed"); } },
      {},
    ], { scheduler, random: () => 1 });
    await manager.connectServer("remote", {
      command: "remote",
      retry: { maxAttempts: 1, background: true, baseDelayMs: 100, maxDelayMs: 100 },
    });
    const failedGeneration = manager.getServerState("remote")?.generation;

    const state = await manager.reconnectServer("remote");

    expect(state.connected).toBe(true);
    expect(state.generation).toBeGreaterThan(failedGeneration ?? -1);
    expect(clients).toHaveLength(2);
    await manager.disconnectAll();
  });

  it("shutdown cancels retry sleep and prevents connection resurrection", async () => {
    const scheduler = new ControlledScheduler();
    const { manager, clients } = createHarness([
      { connect: async () => { throw new Error("fetch failed"); } },
      {},
    ], { scheduler, random: () => 1 });
    await manager.connectServer("remote", {
      command: "remote",
      retry: { maxAttempts: 1, background: true, baseDelayMs: 100, maxDelayMs: 100 },
    });

    await manager.shutdown();
    scheduler.releaseNext();
    await settle();

    expect(manager.getConnectionCount()).toBe(0);
    expect(clients).toHaveLength(1);
  });
});

describe("safe tool calls", () => {
  it("passes request timeouts and a cancellable signal to the SDK", async () => {
    const { manager, clients } = createHarness([{}]);
    await manager.connectServer("tools", {
      command: "tools",
      requestTimeout: 123,
      maxRequestTimeout: 456,
      ...noBackground,
    });
    const controller = new AbortController();

    await manager.callTool("mcp__tools__query", { value: 1 }, { signal: controller.signal });

    expect(clients[0].callTool).toHaveBeenCalledWith(
      { name: "query", arguments: { value: 1 } },
      undefined,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeout: 123,
        maxTotalTimeout: 456,
        resetTimeoutOnProgress: true,
      }),
    );
    await manager.disconnectAll();
  });

  it("returns rich content and business isError without reconnecting", async () => {
    const result = {
      content: [
        { type: "text", text: "bad input" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
      structuredContent: { field: "value" },
      isError: true,
    };
    const { manager, clients } = createHarness([{ calls: [result] }, {}]);
    await manager.connectServer("tools", { command: "tools", ...noBackground });

    await expect(manager.callTool("mcp__tools__query", {})).resolves.toEqual(result);
    expect(clients).toHaveLength(1);
    await manager.disconnectAll();
  });

  it("rebuilds a dropped connection but does not replay an unsafe tool", async () => {
    const dropped = new McpError(ErrorCode.ConnectionClosed, "response lost");
    const { manager, clients } = createHarness([
      { calls: [dropped], pages: [{ tools: [tool("write", false)] }] },
      { pages: [{ tools: [tool("write", false)] }] },
    ]);
    await manager.connectServer("tools", { command: "tools", ...noBackground });

    await expect(manager.callTool("mcp__tools__write", {})).rejects.toMatchObject({
      outcomeUnknown: true,
    });

    expect(clients[0].callTool).toHaveBeenCalledTimes(1);
    expect(clients[1].callTool).not.toHaveBeenCalled();
    expect(manager.isServerConnected("tools")).toBe(true);
    await manager.disconnectAll();
  });

  it("replays an explicitly read-only tool at most once", async () => {
    const dropped = new McpError(ErrorCode.ConnectionClosed, "response lost");
    const { manager, clients } = createHarness([
      { calls: [dropped], pages: [{ tools: [tool("read", true)] }] },
      { calls: [{ content: [{ type: "text", text: "recovered" }] }], pages: [{ tools: [tool("read", true)] }] },
    ]);
    await manager.connectServer("tools", {
      command: "tools",
      toolReplay: "read-only",
      ...noBackground,
    });

    const result = await manager.callTool("mcp__tools__read", {});

    expect(result.content[0].text).toBe("recovered");
    expect(clients[0].callTool).toHaveBeenCalledTimes(1);
    expect(clients[1].callTool).toHaveBeenCalledTimes(1);
    await manager.disconnectAll();
  });

  it("preserves cancellation semantics when reconnect is cancelled after an unknown outcome", async () => {
    const dropped = new McpError(ErrorCode.ConnectionClosed, "response lost");
    const reconnectStarted = deferred<void>();
    const { manager, clients } = createHarness([
      { calls: [dropped], pages: [{ tools: [tool("read", true)] }] },
      {
        pages: [{ tools: [tool("read", true)] }],
        connect: async (_transport, options) => {
          reconnectStarted.resolve();
          const signal = options?.signal as AbortSignal;
          await new Promise<void>((_resolve, reject) => {
            const onAbort = () => reject(signal.reason);
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
          });
        },
      },
    ]);
    await manager.connectServer("tools", {
      command: "tools",
      toolReplay: "read-only",
      ...noBackground,
    });
    const controller = new AbortController();

    const call = manager.callTool("mcp__tools__read", {}, { signal: controller.signal });
    await reconnectStarted.promise;
    controller.abort(new DOMException("user stopped", "AbortError"));

    await expect(call).rejects.toMatchObject({
      name: "McpConnectionError",
      outcomeUnknown: true,
      normalizedError: { category: "cancelled" },
    });
    expect(clients).toHaveLength(2);
    expect(clients[1].callTool).not.toHaveBeenCalled();
    await manager.disconnectAll();
  });

  it("rechecks read-only annotations after reconnect before replaying", async () => {
    const dropped = new McpError(ErrorCode.ConnectionClosed, "response lost");
    const { manager, clients } = createHarness([
      { calls: [dropped], pages: [{ tools: [tool("read", true)] }] },
      { pages: [{ tools: [tool("read", false)] }] },
    ]);
    await manager.connectServer("tools", {
      command: "tools",
      toolReplay: "read-only",
      ...noBackground,
    });

    await expect(manager.callTool("mcp__tools__read", {})).rejects.toMatchObject({
      outcomeUnknown: true,
    });

    expect(clients[0].callTool).toHaveBeenCalledTimes(1);
    expect(clients[1].callTool).not.toHaveBeenCalled();
    expect(manager.isServerConnected("tools")).toBe(true);
    await manager.disconnectAll();
  });

  it("never replays a read-only tool more than once when the replay also loses its response", async () => {
    const dropped = new McpError(ErrorCode.ConnectionClosed, "response lost");
    const { manager, clients } = createHarness([
      { calls: [dropped], pages: [{ tools: [tool("read", true)] }] },
      { calls: [dropped], pages: [{ tools: [tool("read", true)] }] },
    ]);
    await manager.connectServer("tools", {
      command: "tools",
      toolReplay: "read-only",
      ...noBackground,
    });

    await expect(manager.callTool("mcp__tools__read", {})).rejects.toMatchObject({
      outcomeUnknown: true,
    });

    expect(clients).toHaveLength(2);
    expect(clients[0].callTool).toHaveBeenCalledTimes(1);
    expect(clients[1].callTool).toHaveBeenCalledTimes(1);
    expect(manager.getServerState("tools")?.status).toBe("offline");
    await manager.disconnectAll();
  });

  it("closes the active transport without replay after caller cancellation or request timeout", async () => {
    for (const failure of [
      new DOMException("cancelled", "AbortError"),
      new McpError(ErrorCode.RequestTimeout, "slow tool"),
    ]) {
      const { manager, clients } = createHarness([{ calls: [failure] }, {}]);
      await manager.connectServer("tools", { command: "tools", ...noBackground });
      await expect(manager.callTool("mcp__tools__query", {})).rejects.toBeInstanceOf(McpToolError);
      expect(clients).toHaveLength(1);
      expect(clients[0].closeOperation).toHaveBeenCalledTimes(1);
      expect(manager.getServerState("tools")?.status).toBe("offline");
      await manager.disconnectAll();
    }
  });

  it("keeps retired routes and reports a deleted tool explicitly", async () => {
    const { manager } = createHarness([
      { pages: [{ tools: [tool("removed")] }] },
      { pages: [{ tools: [] }] },
    ]);
    await manager.connectServer("tools", { command: "tools", ...noBackground });
    await manager.reconnectServer("tools");

    await expect(manager.callTool("mcp__tools__removed", {})).rejects.toThrow(/no longer available/i);
    await manager.disconnectAll();
  });

  it("applies live tool catalog changes without duplicating a route", async () => {
    const { manager, clients } = createHarness([{
      pages: [{ tools: [tool("old")] }],
    }]);
    await manager.connectServer("tools", { command: "tools", ...noBackground });

    clients[0].emitToolListChanged(null, [tool("new", true)]);

    expect([...manager.getAllTools().keys()]).toEqual(["mcp__tools__new"]);
    await expect(manager.callTool("mcp__tools__old", {})).rejects.toThrow(/no longer available/i);
    await manager.disconnectAll();
  });
});
