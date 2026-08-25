/**
 * MCP 配置文件加载模块
 *
 * 按优先级查找配置文件：
 * 1. 环境变量 PI_MCP_CONFIG 指定的路径
 * 2. .pi/mcp.json（项目级）
 * 3. ~/.pi/agent/mcp.json（全局）
 */
import type { McpConfig } from "./types.js";
/**
 * 查找并加载 MCP 配置文件
 *
 * @param cwd - 当前工作目录（项目根）
 * @returns 解析后的配置，或 null（无配置）
 */
export declare function loadMcpConfig(cwd: string): McpConfig | null;
/**
 * 生成默认配置模板的路径
 */
export declare function configTemplatePath(cwd: string): string;
//# sourceMappingURL=config.d.ts.map