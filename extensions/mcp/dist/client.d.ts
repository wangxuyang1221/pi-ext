/**
 * MCP 客户端管理模块（生产级：超时控制 / 进程清理 / 断线重连 / 结构化错误）
 *
 * 每个 Extension 实例创建一个 McpClientManager，
 * 工具 execute 函数通过闭包捕获该实例，确保状态一致。
 */
import type { McpServerConfig, McpTool, McpToolResult, McpServerState } from "./types.js";
export declare class McpConnectionError extends Error {
    serverName: string;
    constructor(serverName: string, message: string);
}
export declare class McpTimeoutError extends McpConnectionError {
    constructor(serverName: string, timeoutMs: number);
}
export declare class McpAuthError extends McpConnectionError {
    constructor(serverName: string, detail: string);
}
export declare class McpToolError extends Error {
    serverName: string;
    toolName: string;
    constructor(serverName: string, toolName: string, message: string);
}
export declare class McpClientManager {
    /** 连接池：serverName → { client, transport, pid? } */
    private connections;
    /** 工具名 → 服务器名 */
    private toolToServer;
    /** 工具名 → 工具定义 */
    private toolCache;
    /** SSE 重连退避计数器 */
    private retryCounts;
    /** 自愈标记：已经尝试过全局重连 */
    private selfHealAttempted;
    /** 服务器配置缓存，用于单服务器断线重连 */
    private serverConfigs;
    /** 正在重连中的服务器 Promise（并发去重，避免重复拉起 transport/子进程） */
    private reconnecting;
    /** 关闭中的 generation（disconnectAll 时递增，doConnect 检查防复活） */
    private closingGeneration;
    /** 连接进行中的临时跟踪（transport 已创建，但尚未写入 connections） */
    private pendingConnections;
    /**
     * 连接 MCP 服务器（带超时 + SSE 退避重连）
     */
    connectServer(name: string, config: McpServerConfig): Promise<McpServerState>;
    /**
     * 实际执行连接重试循环（由 connectServer 调用）
     */
    private doConnect;
    /**
     * 执行 MCP 工具调用
     *
     * @param fullToolName - 完整工具名（mcp__server__tool）
     * @param args - 工具参数
     * @param _retryDepth - 内部用：当前重试深度（防止无限递归，最多一次 reconnect + retry）
     */
    callTool(fullToolName: string, args: Record<string, unknown>, options?: {
        signal?: AbortSignal;
    }, _retryDepth?: number): Promise<McpToolResult>;
    /**
     * 断开 MCP 服务器，并由 SDK 跨平台清理对应 transport 与子进程。
     */
    disconnectServer(name: string): Promise<void>;
    /**
     * 断开所有 MCP 服务器并清空全部状态
     *
     * generation 递增防止并发 doConnect 在 disconnectAll 后复活。
     */
    disconnectAll(): Promise<void>;
    /**
     * 自愈：重连所有服务器（从 config 重新加载）
     */
    selfHeal(config: Record<string, McpServerConfig>): Promise<number>;
    getAllTools(): Map<string, McpTool>;
    getConnectionCount(): number;
    /**
     * 判断指定服务器当前是否存在已建立的连接。
     *
     * @param name - MCP 配置中的服务器名。
     * @returns 服务器当前已连接时返回 true。
     */
    isServerConnected(name: string): boolean;
    hasConnections(): boolean;
    isSelfHealAttempted(): boolean;
    resetSelfHeal(): void;
    /**
     * 对单个断线服务器发起重连（使用缓存配置）
     *
     * @returns 重连后的状态；若缓存中无该服务器配置则返回 disconnected
     */
    reconnectServer(name: string): Promise<McpServerState>;
    mcpToolName(server: string, tool: string): string;
    getAllConnectionPids(): number[];
    /**
     * 清理指定服务器的工具映射（exact match，不依赖 startsWith）
     */
    private removeToolsForServer;
    /**
     * 关闭连接资源（client + transport + SDK 管理的子进程）。
     */
    private closeConnection;
    /**
     * 关闭原始连接资源（不依赖 Map 查找，可用于 pending connections）
     */
    private closeRawConnection;
    /**
     * 连接竞速：client.connect() vs timeout
     */
    private connectWithTimeout;
    /**
     * 根据配置创建 Transport
     */
    private createTransport;
}
//# sourceMappingURL=client.d.ts.map