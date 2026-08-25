/**
 * MCP Extension 类型定义
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
/** MCP 服务器配置 */
export interface McpServerConfig {
    /** 传输类型：stdio（子进程）、sse（兼容旧服务器）或 http（Streamable HTTP） */
    type?: "stdio" | "sse" | "http" | "streamable-http";
    /** stdio 传输：启动命令 */
    command?: string;
    /** stdio 传输：命令参数 */
    args?: string[];
    /** stdio 传输：环境变量 */
    env?: Record<string, string>;
    /** HTTP/SSE 传输：服务器 URL */
    url?: string;
    /** HTTP/SSE 传输：自定义 HTTP headers */
    headers?: Record<string, string>;
    /** 连接超时（毫秒），默认 30000 */
    timeout?: number;
    /** 是否禁用此服务器 */
    disabled?: boolean;
}
/** 完整的 MCP 配置文件 */
export interface McpConfig {
    mcpServers: Record<string, McpServerConfig>;
}
/** JSON Schema primitive 值类型 */
export type JsonPrimitive = string | number | boolean | null;
/** MCP 服务端返回的工具定义（JSON Schema） */
export interface JsonSchema {
    type?: string;
    description?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    items?: JsonSchema;
    enum?: JsonPrimitive[];
    const?: JsonPrimitive;
    oneOf?: JsonSchema[];
    anyOf?: JsonSchema[];
    additionalProperties?: boolean | JsonSchema;
}
/** MCP 工具定义（来自 tools/list） */
export interface McpTool {
    name: string;
    description?: string;
    inputSchema: JsonSchema;
}
/** MCP content block。保留未知字段以兼容 image/resource/audio 等结果类型。 */
export interface McpContentBlock {
    type: string;
    text?: string;
    [key: string]: unknown;
}
/** MCP 工具调用结果 */
export interface McpToolResult {
    content: McpContentBlock[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
}
/** 连接的 MCP 服务器状态 */
export interface McpServerState {
    config: McpServerConfig;
    tools: McpTool[];
    connected: boolean;
    error?: string;
}
/** MCP 客户端连接信息 */
export interface McpConnection {
    client: Client;
    transport: Transport;
    /** 子进程 PID（仅 stdio 传输） */
    pid?: number;
}
//# sourceMappingURL=types.d.ts.map