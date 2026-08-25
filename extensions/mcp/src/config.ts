/**
 * MCP 配置文件加载模块
 *
 * 按优先级查找配置文件：
 * 1. 环境变量 PI_MCP_CONFIG 指定的路径
 * 2. .pi/mcp.json（项目级）
 * 3. ~/.pi/agent/mcp.json（全局）
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { parse, printParseErrorCode } from "jsonc-parser";
import { logEvent } from "./logger.js";
import type { McpConfig, McpServerConfig } from "./types.js";
import type { ParseError } from "jsonc-parser";

/** 默认配置文件名 */
const CONFIG_FILENAME = "mcp.json";

/**
 * 查找并加载 MCP 配置文件
 *
 * @param cwd - 当前工作目录（项目根）
 * @returns 解析后的配置，或 null（无配置）
 */
export function loadMcpConfig(cwd: string): McpConfig | null {
  // 1. 环境变量指定的路径
  const envPath = process.env.PI_MCP_CONFIG;
  if (envPath) {
    const resolvedEnvPath = resolve(cwd, envPath);
    if (existsSync(resolvedEnvPath)) {
      return readConfigFile(resolvedEnvPath);
    }
  }

  // 2. 项目级配置
  const projectPath = resolve(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);
  if (existsSync(projectPath)) {
    return readConfigFile(projectPath);
  }

  // 3. 全局配置
  const globalPath = resolve(homedir(), CONFIG_DIR_NAME, "agent", CONFIG_FILENAME);
  if (existsSync(globalPath)) {
    return readConfigFile(globalPath);
  }

  return null;
}

/**
 * 读取并解析 JSON 配置文件（使用 jsonc-parser，支持注释 + 尾随逗号）
 */
function readConfigFile(path: string): McpConfig | null {
  try {
    const raw = readFileSync(path, "utf-8");

    const errors: ParseError[] = [];
    const config = parse(raw, errors, {
      allowTrailingComma: true,
    }) as McpConfig;

    if (errors.length > 0) {
      const msg = errors
        .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
        .join(", ");
      logEvent("error", "MCP config JSONC parsing failed", { path, parseErrors: msg });
      return null;
    }

    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      logEvent("warn", "MCP config is missing mcpServers", { path });
      return null;
    }

    // 过滤禁用的服务器并验证配置
    const activeServers: Record<string, McpServerConfig> = {};
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      // 跳过无效配置项（null / 非对象 / 数组）
      if (!serverConfig || typeof serverConfig !== "object" || Array.isArray(serverConfig)) {
        logEvent("warn", "Skipping invalid MCP server config", { path, serverName: name });
        continue;
      }
      if (serverConfig.disabled) {
        logEvent("warn", "Skipping disabled MCP server", { path, serverName: name });
        continue;
      }
      activeServers[name] = serverConfig;
    }

    if (Object.keys(activeServers).length === 0) {
      logEvent("warn", "MCP config has no enabled servers", { path });
      return null;
    }

    // 配置加载成功 — 启动信息由 index.ts 通过 ctx.ui.notify() 统一展示
    return { mcpServers: activeServers };
  } catch (err) {
    logEvent("error", "Failed to read MCP config", { path }, err);
    return null;
  }
}

/**
 * 生成默认配置模板的路径
 */
export function configTemplatePath(cwd: string): string {
  return resolve(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);
}
