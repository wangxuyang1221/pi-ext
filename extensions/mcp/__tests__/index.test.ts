import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const mocks = vi.hoisted(() => ({
  loadMcpConfigResult: vi.fn(),
  connectServerImpl: vi.fn(),
  reconnectServerImpl: vi.fn(),
  managerInstances: [] as any[],
}));

vi.mock("../src/config.js", () => ({
  configTemplatePath: (cwd: string) => `${cwd}/.pi/mcp.json`,
  loadMcpConfigResult: mocks.loadMcpConfigResult,
}));

vi.mock("../src/client.js", () => {
  class McpConnectionError extends Error {}
  class McpToolError extends Error {}

  class McpClientManager {
    readonly options: unknown;
    readonly listeners = new Set<(event: any) => void>();
    readonly states = new Map<string, any>();
    readonly tools = new Map<string, any>();
    connectServer: ReturnType<typeof vi.fn>;
    reconnectServer: ReturnType<typeof vi.fn>;
    callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    }));
    shutdown = vi.fn(async () => undefined);
    disconnectAll = vi.fn(async () => undefined);
    setUnavailableServer = vi.fn((name: string, status: string, error?: string) => {
      const state = makeMockState(name, { connected: false, status, error, tools: [] });
      this.states.set(name, state);
      this.emit({ type: "state", serverName: name, state, source: "lifecycle" });
      return state;
    });

    constructor(options: unknown) {
      this.options = options;
      this.connectServer = vi.fn(async (name: string, config: unknown, connectOptions: unknown) => {
        const state = await mocks.connectServerImpl(name, config, connectOptions, this);
        this.applyState(name, state);
        this.emit({ type: "state", serverName: name, state, source: "initial" });
        this.emit({ type: "tools", serverName: name, tools: state.tools, source: "initial" });
        return state;
      });
      this.reconnectServer = vi.fn(async (name: string, reconnectOptions: unknown) => {
        const state = await mocks.reconnectServerImpl(name, reconnectOptions, this);
        this.applyState(name, state);
        this.emit({ type: "state", serverName: name, state, source: "manual" });
        this.emit({ type: "tools", serverName: name, tools: state.tools, source: "manual" });
        return state;
      });
      mocks.managerInstances.push(this);
    }

    subscribe(listener: (event: any) => void) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit(event: any) {
      if (event.type === "state") this.states.set(event.serverName, event.state);
      if (event.type === "tools") {
        const previous = this.states.get(event.serverName) ?? makeMockState(event.serverName);
        const state = { ...previous, tools: event.tools };
        this.states.set(event.serverName, state);
        for (const [name] of this.tools) {
          if (name.startsWith(`mcp__${event.serverName}__`)) this.tools.delete(name);
        }
        for (const tool of event.tools) {
          this.tools.set(this.mcpToolName(event.serverName, tool.name), tool);
        }
      }
      for (const listener of [...this.listeners]) listener(event);
    }

    applyState(name: string, state: any) {
      this.states.set(name, state);
      for (const [toolName] of this.tools) {
        if (toolName.startsWith(`mcp__${name}__`)) this.tools.delete(toolName);
      }
      for (const tool of state.tools ?? []) {
        this.tools.set(this.mcpToolName(name, tool.name), tool);
      }
    }

    getServerState(name: string) {
      return this.states.get(name);
    }

    getAllServerStates() {
      return [...this.states.values()];
    }

    getAllTools() {
      return new Map(this.tools);
    }

    getConnectionCount() {
      return [...this.states.values()].filter((state) => state.connected).length;
    }

    isServerConnected(name: string) {
      return this.states.get(name)?.connected === true;
    }

    hasConnections() {
      return this.getConnectionCount() > 0;
    }

    mcpToolName(server: string, tool: string) {
      return `mcp__${server}__${tool}`;
    }
  }

  function makeMockState(name: string, overrides: Record<string, unknown> = {}) {
    return {
      config: { command: `${name}-mcp` },
      connected: true,
      status: "connected",
      tools: [],
      attempt: 1,
      generation: 1,
      ...overrides,
    };
  }

  return { McpClientManager, McpConnectionError, McpToolError };
});

import registerMcpExtension from "../src/index.js";

interface PiMock {
  on: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  handlers: Map<string, Array<(...args: any[]) => unknown>>;
  commands: Map<string, any>;
  tools: Map<string, any>;
  emit(event: string, payload: unknown, ctx?: unknown): Promise<unknown>;
}

function createPiMock(): PiMock {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const pi: PiMock = {
    handlers,
    commands,
    tools,
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      const current = handlers.get(event) ?? [];
      current.push(handler);
      handlers.set(event, current);
    }),
    registerCommand: vi.fn((name: string, command: unknown) => commands.set(name, command)),
    registerTool: vi.fn((tool: any) => tools.set(tool.name, tool)),
    async emit(event: string, payload: unknown, ctx?: unknown) {
      let result: unknown;
      for (const handler of handlers.get(event) ?? []) {
        const next = await handler(payload, ctx);
        if (next !== undefined) result = next;
      }
      return result;
    },
  };
  return pi;
}

function makeTool(
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  };
}

function makeState(
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    config: { command: `${name}-mcp` },
    connected: true,
    status: "connected",
    tools: [makeTool("query")],
    attempt: 1,
    generation: 1,
    ...overrides,
  };
}

function makeConfigResult(
  servers: Record<string, Record<string, unknown>> = {},
  overrides: Record<string, unknown> = {},
) {
  const names = Object.keys(servers);
  return {
    status: names.length > 0 ? "loaded" : "empty",
    config: { mcpServers: servers },
    path: "/tmp/project/.pi/mcp.json",
    searchedPaths: ["/tmp/project/.pi/mcp.json"],
    issues: [],
    invalidServers: {},
    disabledServers: [],
    configuredServerNames: names,
    ...overrides,
  };
}

function createTheme(withAnsi = false) {
  const style = (code: string, text: string) => withAnsi ? `\x1b[${code}m${text}\x1b[0m` : text;
  const colors: Record<string, string> = {
    success: "32",
    warning: "33",
    error: "31",
  };
  return {
    fg: (name: string, text: string) => style(colors[name] ?? "36", text),
    bold: (text: string) => style("1", text),
  };
}

function createContext(
  mode: "tui" | "rpc" | "json" | "print" = "tui",
  options: { trusted?: boolean; hasUI?: boolean } = {},
) {
  let customComponent: any;
  const done = vi.fn();
  const theme = createTheme(true);
  const hasUI = options.hasUI ?? (mode === "tui" || mode === "rpc");
  const ctx = {
    cwd: "/tmp/project",
    mode,
    hasUI,
    isProjectTrusted: vi.fn(() => options.trusted ?? true),
    waitForIdle: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    ui: {
      theme,
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn(async () => false),
      custom: vi.fn(async (factory: (...args: any[]) => unknown) => {
        customComponent = factory({ requestRender: vi.fn() }, theme, {}, done);
        return undefined;
      }),
    },
    get customComponent() {
      return customComponent;
    },
    customDone: done,
  };
  return ctx;
}

function manager() {
  return mocks.managerInstances.at(-1)!;
}

function command(pi: PiMock, name = "mcp") {
  const registered = pi.commands.get(name);
  expect(registered?.handler).toBeTypeOf("function");
  return registered;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

let inheritedPiSubagent: string | undefined;

describe("MCP Pi integration", () => {
  beforeEach(() => {
    inheritedPiSubagent = process.env.PI_SUBAGENT;
    delete process.env.PI_SUBAGENT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.loadMcpConfigResult.mockReset();
    mocks.connectServerImpl.mockReset();
    mocks.reconnectServerImpl.mockReset();
    mocks.managerInstances.length = 0;
    if (inheritedPiSubagent === undefined) delete process.env.PI_SUBAGENT;
    else process.env.PI_SUBAGENT = inheritedPiSubagent;
  });

  it("shares one diagnostics service with the config loader and manager", async () => {
    const configResult = makeConfigResult(
      { docs: { command: "docs-mcp" } },
      {
        invalidServers: { broken: "command is required" },
        disabledServers: ["disabled"],
        configuredServerNames: ["docs", "broken", "disabled"],
      },
    );
    mocks.loadMcpConfigResult.mockReturnValue(configResult);
    mocks.connectServerImpl.mockResolvedValue(makeState("docs"));
    const pi = createPiMock();
    const ctx = createContext("tui", { trusted: false });

    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);

    const diagnostics = manager().options.diagnostics;
    expect(mocks.loadMcpConfigResult).toHaveBeenCalledWith(
      "/tmp/project",
      diagnostics,
      { allowProjectConfig: false },
    );
    expect(manager().setUnavailableServer).toHaveBeenCalledWith("broken", "offline", "command is required");
    expect(manager().setUnavailableServer).toHaveBeenCalledWith("disabled", "disabled");
  });

  it("starts configured servers in parallel and emits one aggregate notification", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({
      alpha: { command: "alpha-mcp" },
      beta: { command: "beta-mcp" },
    }));
    const alpha = deferred<any>();
    const beta = deferred<any>();
    mocks.connectServerImpl.mockImplementation((name: string) => name === "alpha" ? alpha.promise : beta.promise);
    const pi = createPiMock();
    const ctx = createContext();
    registerMcpExtension(pi as never);

    const starting = pi.emit("session_start", {}, ctx);
    await flushPromises();
    expect(manager().connectServer).toHaveBeenCalledTimes(2);
    expect(manager().connectServer).toHaveBeenNthCalledWith(
      1,
      "alpha",
      { command: "alpha-mcp" },
      { source: "initial" },
    );

    beta.resolve(makeState("beta", { tools: [makeTool("find")] }));
    alpha.resolve(makeState("alpha", { tools: [makeTool("query")] }));
    await starting;

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(stripAnsi(ctx.ui.notify.mock.calls[0][0])).toBe(
      "MCP startup: 2/2 online, 2 tools, 0 retrying.",
    );
    expect(stripAnsi(ctx.ui.setStatus.mock.calls.at(-1)![1])).toBe(
      "MCP 2/2 online · 2 tools · 0 retrying",
    );
    expect(pi.registerTool).toHaveBeenCalledTimes(2);
  });

  it("registers tools after background recovery and deduplicates recovery events and notices", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({ docs: { command: "docs-mcp" } }));
    mocks.connectServerImpl.mockResolvedValue(makeState("docs", {
      connected: false,
      status: "retrying",
      tools: [],
      nextRetryAt: Date.now() + 1000,
    }));
    const pi = createPiMock();
    const ctx = createContext();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);
    ctx.ui.notify.mockClear();

    const recovered = makeState("docs", { tools: [makeTool("query")] });
    manager().emit({ type: "state", serverName: "docs", state: recovered, source: "background" });
    manager().emit({ type: "tools", serverName: "docs", tools: recovered.tools, source: "background" });
    manager().emit({ type: "tools", serverName: "docs", tools: recovered.tools, source: "background" });

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(stripAnsi(ctx.ui.notify.mock.calls[0][0])).toBe("MCP server recovered: docs");
  });

  it("synchronizes added, removed, duplicate, schema-changed, and description-changed tools", async () => {
    const first = makeTool("query");
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({ docs: { command: "docs-mcp" } }));
    mocks.connectServerImpl.mockResolvedValue(makeState("docs", { tools: [first, first] }));
    const pi = createPiMock();
    const ctx = createContext();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    manager().emit({ type: "tools", serverName: "docs", tools: [first], source: "manual" });
    expect(pi.registerTool).toHaveBeenCalledTimes(1);

    const added = makeTool("search");
    manager().emit({ type: "tools", serverName: "docs", tools: [first, added], source: "manual" });
    expect(pi.registerTool).toHaveBeenCalledTimes(2);

    const schemaChanged = makeTool("query", {
      inputSchema: { type: "object", properties: { term: { type: "string" } } },
    });
    manager().emit({ type: "tools", serverName: "docs", tools: [schemaChanged, added], source: "manual" });
    expect(pi.registerTool).toHaveBeenCalledTimes(3);

    const descriptionChanged = makeTool("query", {
      description: "A new description",
      inputSchema: schemaChanged.inputSchema,
    });
    manager().emit({ type: "tools", serverName: "docs", tools: [descriptionChanged, added], source: "manual" });
    expect(pi.registerTool).toHaveBeenCalledTimes(4);

    const queryWrapper = pi.tools.get("mcp__docs__query");
    expect(queryWrapper.description).toContain("Request narrower results or use server pagination");
    expect(queryWrapper.promptGuidelines).toContainEqual(
      expect.stringContaining("Full truncated output is not persisted"),
    );
    manager().emit({ type: "tools", serverName: "docs", tools: [added], source: "manual" });
    await expect(queryWrapper.execute("call-1", {}, undefined)).rejects.toThrow(
      "is no longer available",
    );
    expect(manager().callTool).not.toHaveBeenCalled();
  });

  it("preserves MCP text and images while bounding other blocks and structured details", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({ docs: { command: "docs-mcp" } }));
    mocks.connectServerImpl.mockResolvedValue(makeState("docs"));
    const pi = createPiMock();
    const ctx = createContext();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);

    const text = "Exact text returned by the MCP server";
    const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
    manager().callTool.mockResolvedValueOnce({
      content: [
        { type: "text", text },
        image,
        { type: "resource", uri: "file:///tmp/result", payload: "x".repeat(20_000) },
      ],
      structuredContent: { rows: [{ value: `\\\"quoted\n${"y".repeat(20)}`.repeat(8_000) }] },
      isError: true,
    });

    const tool = pi.tools.get("mcp__docs__query");
    const result = await tool.execute("call-1", {}, undefined);

    expect(result.content[0]).toEqual({ type: "text", text });
    expect(result.content[1]).toEqual(image);
    expect(result.content[2].type).toBe("text");
    expect(Buffer.byteLength(result.content[2].text, "utf8")).toBeLessThanOrEqual(4200);
    expect(result.details).toMatchObject({
      mcp: true,
      server: "docs",
      tool: "query",
      isError: true,
      structuredContent: { truncated: true },
    });
    expect(Buffer.byteLength(JSON.stringify(result.details), "utf8")).toBeLessThanOrEqual(
      DEFAULT_MAX_BYTES,
    );
    expect(manager().reconnectServer).not.toHaveBeenCalled();
  });

  it("bounds aggregate MCP text without dropping image blocks", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({ docs: { command: "docs-mcp" } }));
    mocks.connectServerImpl.mockResolvedValue(makeState("docs"));
    const pi = createPiMock();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, createContext());

    const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
    const hugeText = Array.from(
      { length: 3000 },
      (_, index) => `line ${index}: ${"x".repeat(40)}`,
    ).join("\n");
    manager().callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: hugeText }, image],
      isError: false,
    });

    const result = await pi.tools.get("mcp__docs__query").execute("call-1", {}, undefined);
    const textBlocks = result.content.filter((block: any) => block.type === "text");
    const outputBytes = textBlocks.reduce(
      (total: number, block: any) => total + Buffer.byteLength(block.text, "utf8"),
      0,
    );
    const outputLines = textBlocks.reduce(
      (total: number, block: any) => total + block.text.split("\n").length,
      0,
    );

    expect(outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
    expect(outputLines).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(textBlocks.at(-1)?.text).toContain("MCP output truncated");
    expect(result.content).toContainEqual(image);
  });

  it("maps MCP business errors to top-level tool_result isError only for registered MCP tools", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({ docs: { command: "docs-mcp" } }));
    mocks.connectServerImpl.mockResolvedValue(makeState("docs"));
    const pi = createPiMock();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, createContext());

    await expect(pi.emit("tool_result", {
      toolName: "mcp__docs__query",
      toolCallId: "call-1",
      input: {},
      content: [{ type: "text", text: "Business validation failed" }],
      details: { isError: true },
      isError: false,
    }, createContext())).resolves.toEqual({ isError: true });

    await expect(pi.emit("tool_result", {
      toolName: "other-tool",
      toolCallId: "call-2",
      input: {},
      content: [],
      details: { mcp: true, isError: true },
      isError: false,
    }, createContext())).resolves.toBeUndefined();

    await expect(pi.emit("tool_result", {
      toolName: "mcp__docs__query",
      toolCallId: "call-3",
      input: {},
      content: [],
      details: { mcp: true, isError: false },
      isError: false,
    }, createContext())).resolves.toBeUndefined();
  });

  it("waits for idle before reload and validates command arguments", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult());
    mocks.connectServerImpl.mockResolvedValue(makeState("unused"));
    const pi = createPiMock();
    const ctx = createContext();
    const order: string[] = [];
    ctx.waitForIdle.mockImplementation(async () => { order.push("idle"); });
    ctx.reload.mockImplementation(async () => { order.push("reload"); });
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);
    ctx.ui.notify.mockClear();

    await command(pi).handler("reload", ctx);
    expect(order).toEqual(["idle", "reload"]);

    await command(pi).handler("reconnect docs extra", ctx);
    expect(manager().reconnectServer).not.toHaveBeenCalled();
    expect(stripAnsi(ctx.ui.notify.mock.calls.at(-1)![0])).toContain("Usage: /mcp status");
  });

  it("handles targeted reconnect states and synchronizes the returned catalog", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({ docs: { command: "docs-mcp" } }));
    mocks.connectServerImpl.mockResolvedValue(makeState("docs", { connected: false, status: "offline", tools: [] }));
    mocks.reconnectServerImpl.mockResolvedValue(makeState("docs", { tools: [makeTool("new-query")] }));
    const pi = createPiMock();
    const ctx = createContext();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);
    ctx.ui.notify.mockClear();

    await command(pi).handler("reconnect unknown", ctx);
    expect(manager().reconnectServer).not.toHaveBeenCalled();
    expect(stripAnsi(ctx.ui.notify.mock.calls.at(-1)![0])).toContain("Unknown or disabled");

    manager().states.set("docs", makeState("docs", { connected: false, status: "retrying" }));
    await command(pi).handler("reconnect docs", ctx);
    expect(manager().reconnectServer).toHaveBeenCalledWith("docs", { source: "manual" });
    expect(stripAnsi(ctx.ui.notify.mock.calls.at(-1)![0])).toBe("MCP server reconnected: docs");

    manager().states.set("docs", makeState("docs", { connected: true, status: "connected" }));
    await command(pi).handler("reconnect docs", ctx);
    expect(manager().reconnectServer).toHaveBeenCalledTimes(2);
    expect(pi.tools.has("mcp__docs__new-query")).toBe(true);
    expect(stripAnsi(ctx.ui.notify.mock.calls.at(-1)![0])).toBe("MCP server reconnected: docs");
  });

  it("suppresses a manual reconnect result after its session shuts down", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({ docs: { command: "docs-mcp" } }));
    mocks.connectServerImpl.mockResolvedValue(makeState("docs", {
      connected: false,
      status: "offline",
      tools: [],
    }));
    const pending = deferred<any>();
    mocks.reconnectServerImpl.mockReturnValue(pending.promise);
    const pi = createPiMock();
    const ctx = createContext("rpc");
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);
    ctx.ui.notify.mockClear();
    ctx.ui.setStatus.mockClear();

    const reconnecting = command(pi).handler("reconnect docs", ctx);
    await flushPromises();
    await pi.emit("session_shutdown", {}, ctx);
    const notifyCount = ctx.ui.notify.mock.calls.length;
    const statusCount = ctx.ui.setStatus.mock.calls.length;

    pending.resolve(makeState("docs", { tools: [makeTool("late-tool")] }));
    await reconnecting;

    expect(ctx.ui.notify).toHaveBeenCalledTimes(notifyCount);
    expect(ctx.ui.setStatus).toHaveBeenCalledTimes(statusCount);
    expect(pi.tools.has("mcp__docs__late-tool")).toBe(false);
  });

  it("shows state metadata and the complete footer in status", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({
      docs: { command: "docs-mcp" },
      search: { command: "search-mcp" },
    }));
    mocks.connectServerImpl.mockImplementation(async (name: string) => name === "docs"
      ? makeState("docs", { tools: [makeTool("one"), makeTool("two")] })
      : makeState("search", {
          connected: false,
          status: "retrying",
          tools: [],
          attempt: 3,
          nextRetryAt: Date.now() + 2000,
          lastError: { category: "connection", message: "Connection failed", retryable: true },
        }));
    const pi = createPiMock();
    const ctx = createContext();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);
    ctx.ui.notify.mockClear();

    await command(pi).handler("status", ctx);
    const rawOutput = ctx.ui.notify.mock.calls[0][0] as string;
    const output = stripAnsi(rawOutput);
    expect(rawOutput).toContain("\x1b[32m●\x1b[0m");
    expect(rawOutput).toContain("\x1b[33m◌\x1b[0m");
    expect(output).toContain("MCP 1/2 online · 2 tools · 1 retrying");
    expect(output).toContain("search retrying · 0 tools · attempt 3 · error connection · retry in");
    expect(stripAnsi(ctx.ui.setStatus.mock.calls.at(-1)![1])).toBe(
      "MCP 1/2 online · 2 tools · 1 retrying",
    );
  });

  it("uses a width-safe TUI logs component that closes on Escape and Enter", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult());
    const pi = createPiMock();
    const ctx = createContext("tui");
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);
    manager().options.diagnostics.record({
      level: "error",
      message: `Connection failed ${"界".repeat(200)}`,
      serverName: "docs",
      context: { attempt: 3 },
      error: new Error("socket closed"),
    });
    manager().options.diagnostics.recordStderr(
      "docs",
      "Authorization: Bearer private-token child failed",
    );

    await command(pi).handler("logs docs", ctx);
    const component = ctx.customComponent;
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    expect(component.render(0)).toEqual([]);
    expect(component.render(-1)).toEqual([]);
    expect(component.render(24).every((line: string) => visibleWidth(line) <= 24)).toBe(true);
    const detailedOutput = stripAnsi(component.render(800).join("\n"));
    expect(detailedOutput).toContain("context={\"attempt\":3}");
    expect(detailedOutput).toContain("[stderr] docs: Authorization: [redacted]");
    expect(detailedOutput).not.toContain("private-token");

    component.handleInput("\x1b");
    component.handleInput("\r");
    expect(ctx.customDone).toHaveBeenCalledTimes(1);
  });

  it("uses bounded RPC notifications and stays silent in JSON and print modes", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult());
    const pi = createPiMock();
    const tuiCtx = createContext("tui");
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, tuiCtx);
    manager().options.diagnostics.record({
      level: "error",
      message: "x".repeat(2000),
      serverName: "docs",
    });

    const rpcCtx = createContext("rpc");
    await command(pi).handler("logs", rpcCtx);
    expect(rpcCtx.ui.custom).not.toHaveBeenCalled();
    expect(visibleWidth(stripAnsi(rpcCtx.ui.notify.mock.calls[0][0]))).toBeLessThanOrEqual(300);

    await command(pi).handler("status", rpcCtx);
    expect(String(rpcCtx.ui.notify.mock.calls.at(-1)![0])).not.toContain("\x1b");

    for (const mode of ["json", "print"] as const) {
      const ctx = createContext(mode);
      await command(pi).handler("logs", ctx);
      await command(pi).handler("status", ctx);
      expect(ctx.ui.custom).not.toHaveBeenCalled();
      expect(ctx.ui.notify).not.toHaveBeenCalled();
      expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    }
  });

  it("guards project configuration access and mcp-init with project trust", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult());
    const pi = createPiMock();
    const ctx = createContext("tui", { trusted: false });
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, ctx);
    ctx.ui.notify.mockClear();

    await command(pi, "mcp-init").handler("", ctx);

    expect(ctx.isProjectTrusted).toHaveBeenCalled();
    expect(stripAnsi(ctx.ui.notify.mock.calls[0][0])).toContain("project is not trusted");
  });

  it("sanitizes untrusted server, tool, argument, and result text before TUI rendering", async () => {
    const serverName = "docs\x1b]0;server-owned\x07";
    const toolName = "query\x1b[2J";
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({
      [serverName]: { command: "docs-mcp" },
    }));
    mocks.connectServerImpl.mockResolvedValue(makeState(serverName, {
      tools: [makeTool(toolName)],
    }));
    const pi = createPiMock();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, createContext());

    const fullName = `mcp__${serverName}__${toolName}`;
    const tool = pi.tools.get(fullName);
    const metadata = [tool.label, tool.description, ...tool.promptGuidelines].join("\n");
    expect(metadata).not.toMatch(/[\x00\x1b\x7f-\x9f]/);

    const callComponent = tool.renderCall(
      { query: "before\x1b]0;argument-owned\x07\x00after" },
      createTheme(false),
      { lastComponent: undefined },
    );
    expect(callComponent.render(500).join("\n")).not.toMatch(/[\x00\x1b\x7f-\x9f]/);

    manager().callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "before\x1b]0;result-owned\x07\x00after" }],
      isError: false,
    });
    const result = await tool.execute("call-1", {}, undefined);
    const resultComponent = tool.renderResult(
      result,
      { isPartial: false },
      createTheme(false),
      { isError: false, lastComponent: undefined },
    );
    expect(resultComponent.render(500).join("\n")).not.toMatch(/[\x00\x1b\x7f-\x9f]/);

    manager().callTool.mockRejectedValueOnce(new Error("bad\x1b]0;error-owned\x07\x00result"));
    const failure = await tool.execute("call-2", {}, undefined).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toMatch(/[\x00\x1b\x7f-\x9f]/);
  });

  it("keeps compact tool rendering within width and handles non-positive widths", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({ docs: { command: "docs-mcp" } }));
    mocks.connectServerImpl.mockResolvedValue(makeState("docs"));
    const pi = createPiMock();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, createContext());
    const tool = pi.tools.get("mcp__docs__query");
    const component = tool.renderCall(
      { query: "宽字符".repeat(100) },
      createTheme(true),
      { lastComponent: undefined },
    );

    expect(component.render(0)).toEqual([]);
    expect(component.render(-10)).toEqual([]);
    expect(component.render(18).every((line: string) => visibleWidth(line) <= 18)).toBe(true);
  });

  it("invalidates stale manager and startup callbacks before shutdown completes", async () => {
    process.env.PI_SUBAGENT = "1";
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult({ docs: { command: "docs-mcp" } }));
    const pending = deferred<any>();
    mocks.connectServerImpl.mockReturnValue(pending.promise);
    const pi = createPiMock();
    const ctx = createContext("rpc");
    registerMcpExtension(pi as never);

    await pi.emit("session_start", {}, ctx);
    expect(manager().connectServer).toHaveBeenCalledTimes(1);
    const notifyCount = ctx.ui.notify.mock.calls.length;
    const statusCount = ctx.ui.setStatus.mock.calls.length;

    await pi.emit("session_shutdown", {}, ctx);
    expect(manager().shutdown).toHaveBeenCalledTimes(1);
    expect(manager().listeners.size).toBe(0);

    pending.resolve(makeState("docs", { tools: [makeTool("late-tool")] }));
    await flushPromises();
    manager().emit({
      type: "tools",
      serverName: "docs",
      tools: [makeTool("later-tool")],
      source: "background",
    });

    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledTimes(notifyCount);
    expect(ctx.ui.setStatus).toHaveBeenCalledTimes(statusCount);
  });

  it("does not install process signal handlers or write through console", async () => {
    mocks.loadMcpConfigResult.mockReturnValue(makeConfigResult());
    const onceSpy = vi.spyOn(process, "once");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pi = createPiMock();
    registerMcpExtension(pi as never);
    await pi.emit("session_start", {}, createContext("json"));

    const signals = onceSpy.mock.calls
      .map(([event]) => String(event))
      .filter((event) => ["SIGINT", "SIGTERM", "SIGHUP"].includes(event));
    expect(signals).toEqual([]);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
