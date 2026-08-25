/**
 * Pi MCP Extension - 主入口（实例化版本）
 *
 * 为 Pi Coding Agent 提供 MCP (Model Context Protocol) 支持。
 * 使用 McpClientManager 实例管理连接状态，避免 jiti 模块缓存问题。
 *
 * 使用方式：
 * 1. 创建 .pi/mcp.json 配置文件
 * 2. 启动 Pi（扩展自动加载）
 * 3. LLM 可直接调用 mcp__<server>__<tool> 格式的工具
 *
 * 命令：
 * - /mcp status  查看 MCP 服务器状态
 * - /mcp reload  重新加载配置并重连
 */
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI): void;
//# sourceMappingURL=index.d.ts.map