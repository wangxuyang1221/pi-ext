/**
 * MCP 客户端管理模块（生产级：超时控制 / 进程清理 / 断线重连 / 结构化错误）
 *
 * 每个 Extension 实例创建一个 McpClientManager，
 * 工具 execute 函数通过闭包捕获该实例，确保状态一致。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { logEvent } from "./logger.js";
import type {
  McpServerConfig,
  McpTool,
  McpToolResult,
  McpServerState,
  McpConnection,
} from "./types.js";

// ============================================================
// 结构化错误
// ============================================================

export class McpConnectionError extends Error {
  constructor(
    public serverName: string,
    message: string
  ) {
    super(`[MCP:${serverName}] ${message}`);
    this.name = "McpConnectionError";
  }
}

export class McpTimeoutError extends McpConnectionError {
  constructor(serverName: string, timeoutMs: number) {
    super(serverName, `连接超时（${timeoutMs / 1000}s）`);
    this.name = "McpTimeoutError";
  }
}

export class McpAuthError extends McpConnectionError {
  constructor(serverName: string, detail: string) {
    super(serverName, `认证失败: ${detail}`);
    this.name = "McpAuthError";
  }
}

export class McpToolError extends Error {
  constructor(
    public serverName: string,
    public toolName: string,
    message: string
  ) {
    super(`[MCP:${serverName}/${toolName}] ${message}`);
    this.name = "McpToolError";
  }
}

// ============================================================
// 错误分类
// ============================================================

function classifyError(
  name: string,
  err: Error,
  timeoutMs: number,
): McpConnectionError {
  const msg = err.message ?? "";
  if (msg.includes("timed out") || msg.includes("timeout")) {
    return new McpTimeoutError(name, timeoutMs);
  }
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("Unauthorized") ||
    msg.includes("Forbidden") ||
    msg.includes("auth")
  ) {
    return new McpAuthError(name, msg);
  }
  return new McpConnectionError(name, msg);
}

// ============================================================
// McpClientManager
// ============================================================

export class McpClientManager {
  /** 连接池：serverName → { client, transport, pid? } */
  private connections = new Map<string, McpConnection>();
  /** 工具名 → 服务器名 */
  private toolToServer = new Map<string, string>();
  /** 工具名 → 工具定义 */
  private toolCache = new Map<string, McpTool>();
  /** SSE 重连退避计数器 */
  private retryCounts = new Map<string, number>();
  /** 自愈标记：已经尝试过全局重连 */
  private selfHealAttempted = false;
  /** 服务器配置缓存，用于单服务器断线重连 */
  private serverConfigs = new Map<string, McpServerConfig>();
  /** 正在重连中的服务器 Promise（并发去重，避免重复拉起 transport/子进程） */
  private reconnecting = new Map<string, Promise<McpServerState>>();
  /** 关闭中的 generation（disconnectAll 时递增，doConnect 检查防复活） */
  private closingGeneration = 0;
  /** 连接进行中的临时跟踪（transport 已创建，但尚未写入 connections） */
  private pendingConnections = new Map<string, McpConnection>();

  // ============================================================
  // Public API
  // ============================================================

  /**
   * 连接 MCP 服务器（带超时 + SSE 退避重连）
   */
  async connectServer(
    name: string,
    config: McpServerConfig
  ): Promise<McpServerState> {
    // 并发去重：同一 server 已有进行中的连接，直接复用 Promise
    const inflight = this.reconnecting.get(name);
    if (inflight) return inflight;

    // 先断开旧连接
    if (this.connections.has(name)) {
      await this.disconnectServer(name);
    }

    // 缓存配置供后续自动重连（连接前设置，失败后仍可复用）
    this.serverConfigs.set(name, config);

    const timeoutMs = config.timeout ?? 30_000;
    const promise = this.doConnect(name, config, timeoutMs);
    this.reconnecting.set(name, promise);
    try {
      return await promise;
    } finally {
      this.reconnecting.delete(name);
    }
  }

  /**
   * 实际执行连接重试循环（由 connectServer 调用）
   */
  private async doConnect(
    name: string,
    config: McpServerConfig,
    timeoutMs: number
  ): Promise<McpServerState> {
    const maxRetries = config.type === "sse" ? 3 : 0;
    const connectGeneration = this.closingGeneration;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (connectGeneration !== this.closingGeneration) {
        return { config, tools: [], connected: false, error: "连接在关闭过程中被取消" };
      }

      let transport: Transport | undefined;
      let client: Client | undefined;
      let pid: number | undefined;
      try {
        transport = this.createTransport(config);

        client = new Client(
          { name: "pi-mcp", version: "1.0.0" },
          { capabilities: {} }
        );

        // 登记 pending，确保信号清理能覆盖此连接
        this.pendingConnections.set(name, { client, transport, pid });

        // 连接（带超时竞速）
        await this.connectWithTimeout(client, transport, timeoutMs);
        pid = getTransportPid(transport);
        this.pendingConnections.set(name, { client, transport, pid });

        // 发现工具，并沿用连接超时上限，避免启动被无响应服务器无限阻塞。
        const response = await client.listTools(undefined, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        const tools: McpTool[] = response.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as McpTool["inputSchema"],
        }));

        // disconnectAll 期间完成的连接不写入状态，避免 shutdown/reload 后复活。
        if (connectGeneration !== this.closingGeneration) {
          this.pendingConnections.delete(name);
          await this.closeRawConnection({ client, transport, pid });
          return { config, tools: [], connected: false, error: "连接在关闭过程中被取消" };
        }

        // 成功后原子切换：先清理该服务器的旧工具映射，再写入最新列表
        this.removeToolsForServer(name);

        // 注册到映射表
        for (const tool of tools) {
          const fullName = this.mcpToolName(name, tool.name);
          this.toolToServer.set(fullName, name);
          this.toolCache.set(fullName, tool);
        }

        this.pendingConnections.delete(name);
        this.connections.set(name, { client, transport, pid });
        this.retryCounts.delete(name); // 成功后清零退避

        // 连接成功 — 启动信息由 index.ts 通过 ctx.ui.notify() 统一展示
        return { config, tools, connected: true };
      } catch (err) {
        // 清理 pending 跟踪
        this.pendingConnections.delete(name);

        // 清理本轮 transport/client 资源，防止超时和重试路径泄漏子进程。
        if (client && transport) {
          await this.closeRawConnection({ client, transport, pid });
        } else if (transport) {
          try {
            await transport.close();
          } catch (closeError) {
            logEvent("error", "Failed to close MCP transport after connection error", { serverName: name }, closeError);
          }
        }

        const error =
          err instanceof McpConnectionError
            ? err
            : classifyError(name, err instanceof Error ? err : new Error(String(err)), timeoutMs);

        // SSE 退避重连
        if (attempt < maxRetries && error instanceof McpTimeoutError) {
          const count = this.retryCounts.get(name) ?? 0;
          const delay = Math.min(1000 * Math.pow(2, count), 30_000);
          this.retryCounts.set(name, count + 1);
          logEvent("warn", "MCP connection timed out; retrying", {
            serverName: name,
            delayMs: delay,
            attempt: attempt + 1,
            maxRetries,
          });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // 保留 serverConfigs 缓存，不因一次失败就丢弃
        // （后续 callTool 自动重连仍依赖此缓存；显式 disconnectAll 时才清理）
        logEvent("error", "MCP connection failed", { serverName: name }, error);
        return { config, tools: [], connected: false, error: error.message };
      }
    }

    return { config, tools: [], connected: false, error: "超过最大重试次数" };
  }

  /**
   * 执行 MCP 工具调用
   *
   * @param fullToolName - 完整工具名（mcp__server__tool）
   * @param args - 工具参数
   * @param _retryDepth - 内部用：当前重试深度（防止无限递归，最多一次 reconnect + retry）
   */
  async callTool(
    fullToolName: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
    _retryDepth = 0
  ): Promise<McpToolResult> {
    const serverName = this.toolToServer.get(fullToolName);
    if (!serverName) {
      throw new McpToolError(
        "unknown",
        fullToolName,
        `未找到对应的 MCP 服务器（工具映射表中不存在）`
      );
    }

    let conn = this.connections.get(serverName);
    if (!conn) {
      // 连接池中不存在，可能是断线后被清理。尝试从缓存配置自动重连
      const cachedConfig = this.serverConfigs.get(serverName);
      if (cachedConfig) {
        logEvent("warn", "MCP connection missing; reconnecting from cached config", {
          serverName,
        });
        try {
          const state = await this.connectServer(serverName, cachedConfig);
          if (state.connected) {
            conn = this.connections.get(serverName)!;
          }
        } catch (error) {
          logEvent("error", "Cached MCP reconnection failed", { serverName }, error);
        }
      }
      if (!conn) {
        throw new McpConnectionError(
          serverName,
          `服务器未连接（重连失败）。请 /reload 手动重连。`
        );
      }
    }

    const originalToolName = fullToolName.slice(`mcp__${serverName}__`.length);

    try {
      const result = await conn.client.callTool(
        {
          name: originalToolName,
          arguments: args,
        },
        undefined,
        { signal: options.signal }
      );

      return {
        content: result.content as McpToolResult["content"],
        structuredContent: result.structuredContent as
          | Record<string, unknown>
          | undefined,
        isError: typeof result.isError === "boolean" ? result.isError : undefined,
      };
    } catch (err) {
      logEvent("error", "MCP tool request failed", {
        serverName,
        toolName: originalToolName,
        retryDepth: _retryDepth,
      }, err);
      const msg = err instanceof Error ? err.message : String(err);

      // 断线检测 + 单服务器自动重连
      if (
        msg.includes("not connected") ||
        msg.includes("transport closed") ||
        msg.includes("Broken pipe") ||
        msg.includes("EPIPE")
      ) {
        logEvent("warn", "MCP connection dropped; reconnecting", { serverName });
        // 关闭旧连接资源（保留 toolToServer 映射，以便后续调用能找回所属 server）
        await this.closeConnection(serverName);

        // P2 修复：尝试单服务器重连（如有缓存配置，最多重试一次）
        if (_retryDepth > 0) {
          // 已经重试过，不再递归，直接抛错
          throw new McpConnectionError(
            serverName,
            `连接已断开（${msg}），重连后仍然失败。请 /reload 手动重连。`
          );
        }

        const cachedConfig = this.serverConfigs.get(serverName);
        if (cachedConfig) {
          try {
            logEvent("warn", "Reconnecting MCP server", { serverName });
            const state = await this.connectServer(serverName, cachedConfig);
            if (state.connected) {
              logEvent("info", "MCP server reconnected; retrying tool call", {
                serverName,
                toolName: originalToolName,
              });
              // 重连成功后自动重试原始调用（_retryDepth+1 防止继续递归）
              return this.callTool(fullToolName, args, options, _retryDepth + 1);
            }
          } catch (reconnectErr) {
            logEvent("error", "MCP server reconnection failed", { serverName }, reconnectErr);
          }
        }

        throw new McpConnectionError(
          serverName,
          `连接已断开（${msg}），自动重连失败。请 /reload 手动重连。`
        );
      }

      throw new McpToolError(serverName, originalToolName, msg);
    }
  }

  /**
   * 断开 MCP 服务器，并由 SDK 跨平台清理对应 transport 与子进程。
   */
  async disconnectServer(name: string): Promise<void> {
    if (!this.connections.has(name)) return;

    // 1. 清理工具映射
    this.removeToolsForServer(name);

    // 2. 关闭资源（client + transport + 子进程）
    await this.closeConnection(name);

    // 3. 清理退避计数
    this.retryCounts.delete(name);
  }

  /**
   * 断开所有 MCP 服务器并清空全部状态
   *
   * generation 递增防止并发 doConnect 在 disconnectAll 后复活。
   */
  async disconnectAll(): Promise<void> {
    this.closingGeneration++;

    // 先关闭握手中的连接，避免 shutdown/reload 被 connect timeout 或 SSE 重试拖住。
    const pendingNames = Array.from(this.pendingConnections.keys());
    await Promise.allSettled(
      pendingNames.map(async (name) => {
        const conn = this.pendingConnections.get(name);
        if (conn) await this.closeRawConnection(conn);
        this.pendingConnections.delete(name);
      })
    );

    // 断开所有已知连接
    const names = Array.from(this.connections.keys());
    await Promise.allSettled(names.map((name) => this.disconnectServer(name)));

    // 不等待 reconnecting 自然结束；doConnect 会通过 generation 检查阻止旧连接复活。
    const remaining = Array.from(this.connections.keys());
    await Promise.allSettled(remaining.map((name) => this.disconnectServer(name)));

    // 最终清空全部状态（包括断线后保留的工具映射）
    this.connections.clear();
    this.toolToServer.clear();
    this.toolCache.clear();
    this.retryCounts.clear();
    this.serverConfigs.clear();
    this.reconnecting.clear();
    this.pendingConnections.clear();
  }

  /**
   * 自愈：重连所有服务器（从 config 重新加载）
   */
  async selfHeal(
    config: Record<string, McpServerConfig>
  ): Promise<number> {
    // 只执行一次全局自愈，但确保遍历所有服务器
    if (this.selfHealAttempted) {
      return this.connections.size;
    }
    this.selfHealAttempted = true;

    let reconnected = 0;

    for (const [name, serverConfig] of Object.entries(config)) {
      if (!this.connections.has(name)) {
        try {
          const state = await this.connectServer(name, serverConfig);
          if (state.connected) reconnected++;
        } catch (error) {
          logEvent("error", "MCP self-heal failed for server", { serverName: name }, error);
        }
      } else {
        reconnected++; // 已连接的也算
      }
    }

    // 自愈重连完成 — 启动信息由 index.ts 通过 ctx.ui.notify() 统一展示
    return reconnected;
  }

  // ============================================================
  // Getters
  // ============================================================

  getAllTools(): Map<string, McpTool> {
    return new Map(this.toolCache);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * 判断指定服务器当前是否存在已建立的连接。
   *
   * @param name - MCP 配置中的服务器名。
   * @returns 服务器当前已连接时返回 true。
   */
  isServerConnected(name: string): boolean {
    return this.connections.has(name);
  }

  hasConnections(): boolean {
    return this.connections.size > 0;
  }

  isSelfHealAttempted(): boolean {
    return this.selfHealAttempted;
  }

  resetSelfHeal(): void {
    this.selfHealAttempted = false;
  }

  /**
   * 对单个断线服务器发起重连（使用缓存配置）
   *
   * @returns 重连后的状态；若缓存中无该服务器配置则返回 disconnected
   */
  async reconnectServer(name: string): Promise<McpServerState> {
    const config = this.serverConfigs.get(name);
    if (!config) {
      return {
        config: {} as McpServerConfig,
        tools: [],
        connected: false,
        error: `无 "${name}" 的缓存配置，无法重连`,
      };
    }
    return this.connectServer(name, config);
  }

  mcpToolName(server: string, tool: string): string {
    return `mcp__${server}__${tool}`;
  }

  getAllConnectionPids(): number[] {
    const pids = new Set<number>();
    for (const conn of this.connections.values()) {
      if (conn.pid) pids.add(conn.pid);
    }
    for (const conn of this.pendingConnections.values()) {
      if (conn.pid) pids.add(conn.pid);
    }
    return [...pids];
  }

  // ============================================================
  // Private
  // ============================================================

  /**
   * 清理指定服务器的工具映射（exact match，不依赖 startsWith）
   */
  private removeToolsForServer(name: string): void {
    for (const [toolName, server] of this.toolToServer) {
      if (server === name) {
        this.toolToServer.delete(toolName);
        this.toolCache.delete(toolName);
      }
    }
  }

  /**
   * 关闭连接资源（client + transport + SDK 管理的子进程）。
   */
  private async closeConnection(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;
    this.connections.delete(name);
    await this.closeRawConnection(conn);
  }

  /**
   * 关闭原始连接资源（不依赖 Map 查找，可用于 pending connections）
   */
  private async closeRawConnection(conn: McpConnection): Promise<void> {
    try {
      await conn.client.close();
    } catch (error) {
      logEvent("error", "Failed to close MCP client", { pid: conn.pid }, error);
    }

    try {
      await conn.transport.close();
    } catch (error) {
      logEvent("error", "Failed to close MCP transport", { pid: conn.pid }, error);
    }
  }

  /**
   * 连接竞速：client.connect() vs timeout
   */
  private async connectWithTimeout(
    client: Client,
    transport: Transport,
    timeoutMs: number
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<void>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Connection timed out after ${timeoutMs}ms`)),
            timeoutMs
          );
          if (timer.unref) timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 根据配置创建 Transport
   */
  private createTransport(config: McpServerConfig): Transport {
    const type = config.type ?? "stdio";

    if ((type === "http" || type === "streamable-http") && config.url) {
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        config.headers
          ? { requestInit: { headers: config.headers } }
          : undefined
      );
    }

    if (type === "sse" && config.url) {
      return new SSEClientTransport(
        new URL(config.url),
        config.headers
          ? { requestInit: { headers: config.headers } }
          : undefined
      );
    }

    if (type === "stdio" && config.command) {
      return new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env as Record<string, string> | undefined,
        stderr: "ignore", // 抑制子进程 stderr 输出，避免干扰 Pi TUI 界面风格
      });
    }

    throw new Error(
      `无效的 MCP 服务器配置：type=${type}，请提供 command（stdio）或 url（http/sse）`
    );
  }
}

/** Reads the public stdio transport PID without relying on SDK internals. */
function getTransportPid(transport: Transport): number | undefined {
  const pid = (transport as Transport & { readonly pid?: number | null }).pid;
  return typeof pid === "number" ? pid : undefined;
}
