/**
 * Pi extension 入口生命周期与 TUI 展示测试。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadMcpConfig: vi.fn(() => null as unknown),
  connectServerImpl: vi.fn(async () => ({
    connected: true,
    tools: [{
      name: "large_json",
      description: "返回大 JSON",
      inputSchema: { type: "object", properties: {} },
    }],
  })),
  managerInstances: [] as Array<{
    callTool: ReturnType<typeof vi.fn>;
    connectServer: ReturnType<typeof vi.fn>;
    connectedServers: Set<string>;
    tools: Map<string, { name: string; description?: string; inputSchema: Record<string, unknown> }>;
  }>,
}));

vi.mock("../src/config.js", () => ({
  configTemplatePath: (cwd: string) => `${cwd}/.pi/mcp.json`,
  loadMcpConfig: mocks.loadMcpConfig,
}));

vi.mock("../src/client.js", () => ({
  McpConnectionError: class McpConnectionError extends Error {},
  McpToolError: class McpToolError extends Error {},
  McpClientManager: class McpClientManager {
    connectedServers = new Set<string>();
    tools = new Map<string, {
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
    }>();
    connectServer = vi.fn(async (name: string, config: unknown) => {
      const state = await mocks.connectServerImpl(name, config);
      if (state.connected) {
        this.connectedServers.add(name);
        for (const tool of state.tools) {
          this.tools.set(this.mcpToolName(name, tool.name), tool);
        }
      } else {
        this.connectedServers.delete(name);
      }
      return state;
    });
    callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
      structuredContent: undefined,
      isError: false,
    }));
    constructor() {
      mocks.managerInstances.push(this);
    }
    hasConnections() {
      return this.connectedServers.size > 0;
    }
    mcpToolName(server: string, tool: string) {
      return `mcp__${server}__${tool}`;
    }
    resetSelfHeal() {}
    async selfHeal() {
      return this.connectedServers.size;
    }
    async disconnectAll() {
      this.connectedServers.clear();
      this.tools.clear();
    }
    getAllTools() {
      return new Map(this.tools);
    }
    getConnectionCount() {
      return this.connectedServers.size;
    }
    isServerConnected(name: string) {
      return this.connectedServers.has(name);
    }
  },
}));

import registerMcpExtension from "../src/index.js";

function createPiMock() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
  };
}

function createThemeTracker(withAnsi = false) {
  const colorCalls: string[] = [];
  const style = (code: string, text: string) => withAnsi ? `\x1b[${code}m${text}\x1b[0m` : text;
  return {
    colorCalls,
    theme: {
      fg: (name: string, text: string) => {
        colorCalls.push(name);
        return style("36", text);
      },
      bold: (text: string) => style("1", text),
    },
  };
}

function createContext(theme: ReturnType<typeof createThemeTracker>["theme"]) {
  return {
    cwd: "/tmp/project",
    reload: vi.fn(),
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      theme,
    },
  };
}

function getSessionStart(pi: ReturnType<typeof createPiMock>) {
  const handler = pi.on.mock.calls.find(([event]) => event === "session_start")?.[1];
  expect(handler).toBeTypeOf("function");
  return handler;
}

function getMcpCommand(pi: ReturnType<typeof createPiMock>) {
  const command = pi.registerCommand.mock.calls.find(([name]) => name === "mcp")?.[1];
  expect(command?.handler).toBeTypeOf("function");
  return command;
}

function makeTool(name: string) {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("MCP extension 入口", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.loadMcpConfig.mockReset();
    mocks.loadMcpConfig.mockReturnValue(null);
    mocks.connectServerImpl.mockReset();
    mocks.connectServerImpl.mockResolvedValue({
      connected: true,
      tools: [{
        name: "large_json",
        description: "返回大 JSON",
        inputSchema: { type: "object", properties: {} },
      }],
    });
    mocks.managerInstances.length = 0;
    delete process.env.PI_SUBAGENT;
  });

  it("不应注册 SIGINT/SIGTERM/SIGHUP handler 或接管宿主进程退出", () => {
    const onceSpy = vi.spyOn(process, "once");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit should not be called");
    }) as never);

    registerMcpExtension(createPiMock() as never);

    const signalEvents = onceSpy.mock.calls
      .map(([event]) => event)
      .filter((event) => ["SIGINT", "SIGTERM", "SIGHUP"].includes(String(event)));

    expect(signalEvents).toEqual([]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("子 Pi 模式下任意 MCP 连接不应阻塞 session_start，避免拖死 subagent RPC prompt", async () => {
    process.env.PI_SUBAGENT = "1";
    const pi = createPiMock();
    mocks.loadMcpConfig.mockReturnValue({
      mcpServers: {
        slow_docs: { command: "slow-mcp" },
      },
    });
    mocks.connectServerImpl.mockImplementation(() => new Promise(() => undefined));

    registerMcpExtension(pi as never);

    const sessionStart = getSessionStart(pi);
    const { theme } = createThemeTracker();
    const outcome = await Promise.race([
      sessionStart({}, createContext(theme)).then(() => "returned"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 20)),
    ]);

    expect(outcome).toBe("returned");
    expect(mocks.managerInstances[0].connectServer).toHaveBeenCalledWith("slow_docs", { command: "slow-mcp" });
  });

  it("全部连接成功时应只显示一行 Quiet native 摘要", async () => {
    const pi = createPiMock();
    mocks.loadMcpConfig.mockReturnValue({
      mcpServers: {
        docs: { command: "docs-mcp" },
        search: { command: "search-mcp" },
      },
    });
    mocks.connectServerImpl.mockImplementation(async (name: string) => ({
      connected: true,
      tools: name === "docs"
        ? [makeTool("query")]
        : [makeTool("find"), makeTool("search")],
    }));

    registerMcpExtension(pi as never);
    const { theme } = createThemeTracker();
    const ctx = createContext(theme);
    await getSessionStart(pi)({}, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0]).toEqual([
      "✓ MCP connected · 2 servers · 3 tools",
      "info",
    ]);
    expect(ctx.ui.setStatus.mock.calls.at(-1)?.[1]).toBe("MCP 2/2 · 3 tools");
  });

  it("启动通知应使用 Quiet native 摘要，并按配置顺序展示并发失败", async () => {
    const pi = createPiMock();
    mocks.loadMcpConfig.mockReturnValue({
      mcpServers: {
        alpha: { command: "alpha-mcp" },
        beta: { command: "beta-mcp" },
        gamma: { command: "gamma-mcp" },
      },
    });

    const pending = new Map([
      ["alpha", createDeferred<{ connected: boolean; tools: ReturnType<typeof makeTool>[]; error?: string }>()],
      ["beta", createDeferred<{ connected: boolean; tools: ReturnType<typeof makeTool>[]; error?: string }>()],
      ["gamma", createDeferred<{ connected: boolean; tools: ReturnType<typeof makeTool>[]; error?: string }>()],
    ]);
    mocks.connectServerImpl.mockImplementation((name: string) => pending.get(name)!.promise);

    registerMcpExtension(pi as never);
    const { colorCalls, theme } = createThemeTracker();
    const ctx = createContext(theme);
    const started = getSessionStart(pi)({}, ctx);

    pending.get("gamma")!.resolve({ connected: false, tools: [], error: "gamma failed" });
    pending.get("beta")!.resolve({ connected: true, tools: [makeTool("query")] });
    pending.get("alpha")!.resolve({ connected: false, tools: [], error: "alpha failed" });
    await started;

    const message = stripAnsi(String(ctx.ui.notify.mock.calls.at(-1)?.[0]));
    expect(message.split("\n")[0]).toBe("✓ MCP connected · 1 servers · 1 tools");
    expect(message.indexOf("alpha: alpha failed")).toBeLessThan(message.indexOf("gamma: gamma failed"));
    expect(ctx.ui.setStatus.mock.calls.at(-1)?.[1]).toBe("MCP 1/3 · 1 tools");
    expect(colorCalls).toContain("toolTitle");
    expect(colorCalls).toContain("success");
    expect(colorCalls).toContain("muted");
    expect(colorCalls).not.toContain("mdHeading");
  });

  it("全部连接失败时应保留服务器详情并使用统一 footer", async () => {
    const pi = createPiMock();
    mocks.loadMcpConfig.mockReturnValue({
      mcpServers: {
        docs: { command: "docs-mcp" },
        search: { command: "search-mcp" },
      },
    });
    mocks.connectServerImpl.mockImplementation(async (name: string) => ({
      connected: false,
      tools: [],
      error: `${name} unavailable`,
    }));

    registerMcpExtension(pi as never);
    const { colorCalls, theme } = createThemeTracker();
    const ctx = createContext(theme);
    await getSessionStart(pi)({}, ctx);

    const message = stripAnsi(String(ctx.ui.notify.mock.calls.at(-1)?.[0]));
    expect(message.split("\n")[0]).toBe("✗ MCP unavailable");
    expect(message).toContain("docs: docs unavailable");
    expect(message).toContain("search: search unavailable");
    expect(ctx.ui.setStatus.mock.calls.at(-1)?.[1]).toBe("MCP 0/2 · 0 tools");
    expect(colorCalls).toContain("error");
    expect(colorCalls).not.toContain("mdHeading");
  });

  it("/mcp 应显示紧凑状态点、真实在线状态和折叠工具名", async () => {
    const pi = createPiMock();
    mocks.loadMcpConfig.mockReturnValue({
      mcpServers: {
        context7: { command: "context7-mcp" },
        MultiFetch: { command: "multifetch-mcp" },
        empty: { command: "empty-mcp" },
        broken: { command: "broken-mcp" },
      },
    });
    mocks.connectServerImpl.mockImplementation(async (name: string) => {
      if (name === "context7") {
        return { connected: true, tools: [makeTool("resolve-library-id"), makeTool("query-docs")] };
      }
      if (name === "MultiFetch") {
        return {
          connected: true,
          tools: ["fetch_html", "fetch_json", "fetch_txt", "fetch_markdown", "fetch_plaintext"].map(makeTool),
        };
      }
      if (name === "empty") {
        return { connected: true, tools: [] };
      }
      return { connected: false, tools: [], error: "connection refused" };
    });

    registerMcpExtension(pi as never);
    const { colorCalls, theme } = createThemeTracker();
    const ctx = createContext(theme);
    await getSessionStart(pi)({}, ctx);
    ctx.ui.notify.mockClear();
    ctx.ui.setStatus.mockClear();
    colorCalls.length = 0;

    await getMcpCommand(pi).handler("status", ctx);

    const rendered = stripAnsi(String(ctx.ui.notify.mock.calls[0]?.[0]));
    const lines = rendered.split("\n");
    expect(lines[0]).toContain("MCP  3/4 online · 7 tools");
    expect(lines.find((line) => line.includes("context7"))).toMatch(/^●\s+context7/);
    expect(lines.find((line) => line.includes("MultiFetch"))).toContain("fetch_html fetch_json fetch_txt +2");
    expect(lines.find((line) => line.includes("empty"))).toMatch(/^●\s+empty/);
    expect(lines.find((line) => line.includes("empty"))).not.toContain("offline");
    expect(lines.find((line) => line.includes("broken"))).toMatch(/^○\s+broken.*offline$/);
    expect(lines.slice(1).filter((line) => line.startsWith("●")).every((line) => !line.includes("online"))).toBe(true);
    expect(ctx.ui.setStatus.mock.calls.at(-1)?.[1]).toBe("MCP 3/4 · 7 tools");
    expect(colorCalls).toContain("toolTitle");
    expect(colorCalls).toContain("success");
    expect(colorCalls).toContain("muted");
    expect(colorCalls).toContain("dim");
    expect(colorCalls).not.toContain("mdHeading");
  });

  it("MCP 工具调用应把 Pi 提供的 AbortSignal 继续传给客户端管理器", async () => {
    const pi = createPiMock();
    mocks.loadMcpConfig.mockReturnValue({
      mcpServers: {
        docs: { command: "mock-mcp" },
      },
    });

    registerMcpExtension(pi as never);
    const { theme } = createThemeTracker();
    await getSessionStart(pi)({}, createContext(theme));

    const controller = new AbortController();
    const tool = pi.registerTool.mock.calls[0][0];

    await tool.execute("tool-1", { url: "https://example.com" }, controller.signal, undefined, {
      cwd: "/tmp/project",
    });

    const manager = mocks.managerInstances[0];
    expect(manager.callTool).toHaveBeenCalledWith(
      "mcp__docs__large_json",
      { url: "https://example.com" },
      { signal: controller.signal },
    );
  });

  it("工具卡应隐藏编码名，而模型仍获得完整 MCP 结果", async () => {
    const pi = createPiMock();
    mocks.loadMcpConfig.mockReturnValue({
      mcpServers: {
        MultiFetch: { command: "mock-mcp" },
      },
    });
    mocks.connectServerImpl.mockResolvedValue({
      connected: true,
      tools: [makeTool("fetch_json")],
    });

    registerMcpExtension(pi as never);
    const startupTheme = createThemeTracker().theme;
    await getSessionStart(pi)({}, createContext(startupTheme));

    const manager = mocks.managerInstances[0];
    const hugeText = `标题\n${"very-long-line ".repeat(200)}\nUNIQUE_FULL_MODEL_CONTENT`;
    manager.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: hugeText }],
      structuredContent: { rows: Array.from({ length: 20 }, (_, index) => ({ index, value: hugeText })) },
      isError: false,
    });

    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool.renderShell).toBeUndefined();
    const executed = await tool.execute("tool-1", {}, undefined, undefined, {
      cwd: "/tmp/project",
    });

    expect(executed.content[0].text).toContain("UNIQUE_FULL_MODEL_CONTENT");
    expect(executed.content[0].text).toContain("Structured MCP content");

    const { colorCalls, theme } = createThemeTracker(true);
    const callComponent = tool.renderCall(
      { url: "https://api.example.com/a/very/long/resource" },
      theme,
      {},
    );
    const callLines = callComponent.render(36);
    const plainCall = stripAnsi(callLines.join("\n"));
    expect(plainCall).toContain("MultiFetch / fetch_json");
    expect(plainCall).toContain("https://api.example.com/");
    expect(plainCall).not.toContain("mcp__MultiFetch__fetch_json");
    expect(callLines.every((line: string) => stripAnsi(line).length <= 36)).toBe(true);

    const resultComponent = tool.renderResult(
      executed,
      { expanded: false, isPartial: false },
      theme,
      {},
    );
    const renderedLines = resultComponent.render(48);
    const plainRendered = stripAnsi(renderedLines.join("\n"));

    expect(plainRendered).toMatch(/^✓ completed · \d+(?:\.\d)? (?:KB|MB)/);
    expect(plainRendered).not.toContain("────────────────────────");
    expect(plainRendered).not.toContain("raw");
    expect(plainRendered).not.toContain("view");
    expect(plainRendered).not.toContain("UNIQUE_FULL_MODEL_CONTENT");
    expect(plainRendered).not.toContain("Structured MCP content");
    expect(renderedLines.every((line: string) => stripAnsi(line).length <= 48)).toBe(true);
    expect(colorCalls).toContain("toolTitle");
    expect(colorCalls).toContain("success");
    expect(colorCalls).toContain("muted");
    expect(colorCalls).toContain("dim");
    expect(colorCalls).toContain("toolOutput");
    expect(colorCalls).not.toContain("mdHeading");
    expect(colorCalls).not.toContain("accent");

    colorCalls.length = 0;
    const failedComponent = tool.renderResult(
      {
        content: [{ type: "text", text: "boom" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      theme,
      { isError: true },
    );
    const failedRendered = failedComponent
      .render(48)
      .map((line: string) => stripAnsi(line).trimEnd())
      .join("\n");
    expect(failedRendered).toBe("✗ failed · 4 B\nboom");
    expect(colorCalls).toContain("error");
  });
});
