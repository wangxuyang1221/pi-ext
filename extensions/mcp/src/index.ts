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

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { jsonSchemaToTypeBox } from "./schema.js";
import { loadMcpConfig, configTemplatePath } from "./config.js";
import { McpClientManager, McpConnectionError, McpToolError } from "./client.js";
import { logEvent } from "./logger.js";
import type { McpContentBlock, McpTool } from "./types.js";

export default function (pi: ExtensionAPI) {
  /** MCP 客户端管理器（每个 Extension 实例独立） */
  const manager = new McpClientManager();
  /** 已注册的 Pi 工具名集合（用于跟踪） */
  const registeredToolNames = new Set<string>();
  /** 工具名 → 服务器名映射（避免 split("__")[1] 在 server 名含 __ 时出错） */
  const toolToServerName = new Map<string, string>();

  /**
   * 启动流程：并行连接 MCP 服务器，每个就绪后立即注册工具，互不阻塞。
   */
  pi.on("session_start", async (_event, ctx) => {
    const config = loadMcpConfig(ctx.cwd);
    if (!config) {
      ctx.ui.setStatus("mcp", ctx.ui.theme.fg("warning", "MCP: no config"));
      ctx.ui.notify(
        `MCP: 未找到配置文件。创建 ${configTemplatePath(ctx.cwd)} 来配置 MCP 服务器。`,
        "warning"
      );
      return;
    }

    const connectConfiguredServers = async (
      serverEntries: Array<[string, (typeof config.mcpServers)[string]]>,
      options: { notifyWhenEmpty?: boolean } = {},
    ) => {
      const configuredCount = serverEntries.length;
      if (configuredCount === 0) {
        if (options.notifyWhenEmpty) {
          ctx.ui.setStatus("mcp", ctx.ui.theme.fg("dim", formatMcpFooter(0, 0, 0)));
        }
        return;
      }

      // 重置自愈标记（新一轮连接开始）
      manager.resetSelfHeal();
      ctx.ui.setStatus("mcp", ctx.ui.theme.fg("dim", formatMcpFooter(0, configuredCount, 0)));

      interface ServerConnectionOutcome {
        name: string;
        connected: boolean;
        toolCount: number;
        error?: string;
      }

      const settled = await Promise.allSettled(
        serverEntries.map(async ([name, serverConfig]): Promise<ServerConnectionOutcome> => {
          const state = await manager.connectServer(name, serverConfig);
          if (!state.connected) {
            return {
              name,
              connected: false,
              toolCount: 0,
              error: state.error ?? "连接失败",
            };
          }

          // 各服务器完成连接后立即注册工具，不等待其他服务器。
          for (const tool of state.tools) {
            registerMcpTool(pi, manager, name, tool, registeredToolNames, toolToServerName);
          }
          return { name, connected: true, toolCount: state.tools.length };
        })
      );

      // Promise.allSettled 保留输入顺序，因此失败详情稳定遵循配置顺序。
      const outcomes = settled.map((result, index): ServerConnectionOutcome => {
        if (result.status === "fulfilled") {
          return result.value;
        }
        return {
          name: serverEntries[index][0],
          connected: false,
          toolCount: 0,
          error: formatUnknownError(result.reason),
        };
      });
      const successCount = outcomes.filter((outcome) => outcome.connected).length;
      const totalTools = outcomes.reduce(
        (total, outcome) => total + (outcome.connected ? outcome.toolCount : 0),
        0,
      );
      const failed = outcomes.flatMap((outcome) =>
        outcome.connected
          ? []
          : [{ name: outcome.name, error: outcome.error ?? "连接失败" }]
      );

      const theme = ctx.ui.theme;
      const footer = formatMcpFooter(successCount, configuredCount, totalTools);
      if (successCount > 0) {
        ctx.ui.setStatus("mcp", theme.fg(failed.length > 0 ? "warning" : "dim", footer));
        const summary = [
          theme.fg("success", "✓"),
          theme.fg("toolTitle", theme.bold("MCP connected")),
          theme.fg("dim", "·"),
          theme.fg("muted", `${successCount} servers · ${totalTools} tools`),
        ].join(" ");
        const failedLines = failed.map((item) =>
          theme.fg("warning", `! ${item.name}: ${item.error}`)
        );
        ctx.ui.notify([summary, ...failedLines].join("\n"), failed.length > 0 ? "warning" : "info");
      } else {
        ctx.ui.setStatus("mcp", theme.fg("warning", footer));
        const summary = `${theme.fg("error", "✗")} ${theme.fg("toolTitle", theme.bold("MCP unavailable"))}`;
        const failedLines = failed.map((item) =>
          theme.fg("error", `  ${item.name}: ${item.error}`)
        );
        ctx.ui.notify([summary, ...failedLines].join("\n"), "error");
      }
    };

    if (process.env.PI_SUBAGENT === "1") {
      void connectConfiguredServers(Object.entries(config.mcpServers)).catch((error) => {
        logEvent("error", "Background MCP connection failed in subagent", {}, error);
        ctx.ui.notify(`MCP: 子 Pi 后台连接失败：${String(error)}`, "warning");
      });
      return;
    }

    await connectConfiguredServers(Object.entries(config.mcpServers), { notifyWhenEmpty: true });
  });

  /**
   * 关闭：断开所有连接（/reload 时 session_shutdown 先于 session_start 触发，
   * 因此这里清理旧连接后，session_start 会自动重建，形成自然的 reload 恢复）
   */
  pi.on("session_shutdown", async () => {
    await manager.disconnectAll();
    registeredToolNames.clear();
  });

  /**
   * resources_discover：不在此清理连接。
   * reload 流程为 session_shutdown → session_start → resources_discover，
   * 若在 resources_discover 中 disconnectAll() 会误杀 session_start 刚重建的连接。
   * 连接生命周期统一由 session_shutdown 管理。
   */

  // ============================================================
  // 命令注册
  // ============================================================

  /**
   * /mcp status - 查看 MCP 状态
   */
  pi.registerCommand("mcp", {
    description: "MCP 扩展管理。用法：/mcp status | /mcp reload",
    handler: async (args, ctx) => {
      const subCommand = args?.trim() || "status";

      switch (subCommand) {
        case "status":
        case "": {
          const config = loadMcpConfig(ctx.cwd);
          if (!config) {
            ctx.ui.notify("MCP: 未找到配置文件", "warning");
            ctx.ui.setStatus("mcp", ctx.ui.theme.fg("warning", "MCP: no config"));
            return;
          }

          const configured = Object.keys(config.mcpServers);
          const tools = manager.getAllTools();

          // 只统计在线服务器的工具，断线后为重连保留的旧映射不进入状态 UI。
          const toolMap = new Map<string, McpTool[]>();
          for (const [fullName, tool] of tools) {
            const server = toolToServerName.get(fullName);
            if (!server || !manager.isServerConnected(server)) continue;
            const serverTools = toolMap.get(server) ?? [];
            serverTools.push(tool);
            toolMap.set(server, serverTools);
          }

          const rows = configured.map((server) => ({
            server,
            displayName: truncateToWidth(server, MAX_SERVER_NAME_WIDTH, "…"),
            connected: manager.isServerConnected(server),
            tools: toolMap.get(server) ?? [],
          }));
          const onlineCount = rows.filter((row) => row.connected).length;
          const onlineToolCount = rows.reduce(
            (total, row) => total + (row.connected ? row.tools.length : 0),
            0,
          );
          const serverColumnWidth = Math.max(
            1,
            ...rows.map((row) => visibleWidth(row.displayName)),
          );
          const countColumnWidth = Math.max(
            1,
            ...rows.map((row) => String(row.connected ? row.tools.length : 0).length),
          );

          const theme = ctx.ui.theme;
          const header = `${theme.fg("toolTitle", theme.bold("MCP"))}  ${theme.fg("muted", `${onlineCount}/${configured.length} online · ${onlineToolCount} tools`)}`;
          const lines = [header];
          for (const row of rows) {
            const marker = row.connected
              ? theme.fg("success", "●")
              : theme.fg("warning", "○");
            const server = theme.fg(
              "toolTitle",
              padToVisibleWidth(row.displayName, serverColumnWidth),
            );
            const count = theme.fg(
              "muted",
              String(row.connected ? row.tools.length : 0).padStart(countColumnWidth),
            );
            const detail = row.connected
              ? formatToolNameSummary(row.tools, theme)
              : theme.fg("muted", "offline");
            lines.push(`${marker} ${server} ${count}${detail ? ` ${detail}` : ""}`);
          }
          ctx.ui.notify(lines.join("\n"), "info");
          ctx.ui.setStatus(
            "mcp",
            theme.fg("dim", formatMcpFooter(onlineCount, configured.length, onlineToolCount)),
          );
          return;
        }
        case "reload": {
          await ctx.reload();
          return;
        }
        default: {
          ctx.ui.notify(
            `未知的 MCP 子命令: "${subCommand}"。可用: status, reload`,
            "warning"
          );
          return;
        }
      }
    },
  });

  /**
   * /mcp-init - 生成示例配置文件
   */
  pi.registerCommand("mcp-init", {
    description: "生成 MCP 配置模板文件",
    handler: async (_args, ctx) => {
      const { writeFileSync, existsSync, mkdirSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      const path = configTemplatePath(ctx.cwd);

      if (existsSync(path)) {
        const overwrite = await ctx.ui.confirm(
          "配置文件已存在",
          `${path} 已存在，是否覆盖？`
        );
        if (!overwrite) return;
      }

      const template: import("./types.js").McpConfig = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", ctx.cwd],
            env: {},
          },
        },
      };

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(template, null, 2) + "\n", "utf-8");
      ctx.ui.notify(`已生成配置文件: ${path}`, "info");
    },
  });
}

// ============================================================
// 工具注册辅助函数
// ============================================================

/**
 * 将单个 MCP 工具注册为 Pi 工具。
 * 通过闭包捕获 manager 实例，确保工具执行时使用正确的连接状态。
 */
function registerMcpTool(
  pi: ExtensionAPI,
  manager: McpClientManager,
  serverName: string,
  tool: McpTool,
  registry: Set<string>,
  nameToServer: Map<string, string>
): void {
  const fullName = manager.mcpToolName(serverName, tool.name);
  // 记录工具名 → 服务器名映射，避免后期靠 split("__")[1] 猜错
  nameToServer.set(fullName, serverName);

  // 转换 JSON Schema 为 TypeBox
  let parameters: ReturnType<typeof jsonSchemaToTypeBox>;
  try {
    parameters = jsonSchemaToTypeBox(tool.inputSchema);
  } catch (err) {
    logEvent(
      "error",
      "MCP tool schema conversion failed; falling back to Any",
      { toolName: fullName },
      err,
    );
    parameters = Type.Any();
  }

  const baseDescription = tool.description ?? `${fullName} (MCP 工具)`;
  const description = `[MCP:${serverName}] ${baseDescription}`;

  // 注册工具 — execute 闭包捕获 manager 实例
  pi.registerTool({
    name: fullName,
    label: `MCP:${serverName}`,
    description,
    promptSnippet: description,
    promptGuidelines: [
      `使用 ${fullName} 来调用 MCP 服务器 "${serverName}" 提供的 "${tool.name}" 工具。`,
    ],
    parameters,

    renderCall(args, theme, context) {
      return renderCompactText(
        formatMcpToolCallSummary(args, { serverName, toolName: tool.name, theme }),
        context?.lastComponent,
      );
    },

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      // 自愈：工具执行时如果服务器未连接，尝试从 config 重连
      if (!manager.hasConnections()) {
        manager.resetSelfHeal();
        const config = loadMcpConfig(_ctx.cwd);
        if (config) {
          await manager.selfHeal(config.mcpServers);
        }
      }

      if (signal?.aborted) {
        return {
          content: [{ type: "text" as const, text: "操作已取消" }],
          details: {},
        };
      }

      try {
        const result = await manager.callTool(
          fullName,
          params as Record<string, unknown>,
          { signal }
        );

        const output = formatMcpToolOutput(result.content, result.structuredContent);

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            server: serverName,
            tool: tool.name,
            isError: result.isError ?? false,
            structuredContent: boundStructuredContent(result.structuredContent),
          },
        };
      } catch (err) {
        logEvent("error", "MCP tool execution failed", {
          serverName,
          toolName: tool.name,
          fullToolName: fullName,
        }, err);

        // 结构化错误传递
        if (err instanceof McpConnectionError) {
          throw new Error(
            `[MCP 连接错误] ${err.message}。建议执行 /reload 重新连接。`
          );
        }
        if (err instanceof McpToolError) {
          throw new Error(
            `[MCP 工具错误] ${err.message}`
          );
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        throw new Error(`MCP 工具 "${fullName}" 执行失败: ${errorMsg}`);
      }
    },

    renderResult(result, options, theme, context) {
      return renderCompactText(
        formatMcpToolResultSummary(result, {
          isError: context?.isError === true,
          isPartial: options.isPartial,
          theme,
        }),
        context?.lastComponent,
      );
    },
  });

  registry.add(fullName);
}

/**
 * 将 MCP 富结果转换为 Pi 目前可展示的文本，同时不丢弃非文本块与 structuredContent。
 */
function formatMcpToolOutput(
  content: McpContentBlock[],
  structuredContent?: Record<string, unknown>
): string {
  const parts: string[] = [];
  const textContents = content
    .filter(
      (c): c is McpContentBlock & { type: "text"; text: string } =>
        c.type === "text" && typeof c.text === "string"
    )
    .map((c) => c.text);
  const nonTextContents = content.filter(
    (c) => !(c.type === "text" && typeof c.text === "string")
  );

  if (textContents.length > 0) {
    parts.push(textContents.join("\n"));
  }
  if (nonTextContents.length > 0) {
    parts.push(`Non-text MCP content:\n${JSON.stringify(nonTextContents, null, 2)}`);
  }
  if (structuredContent !== undefined) {
    parts.push(`Structured MCP content:\n${JSON.stringify(structuredContent, null, 2)}`);
  }

  const output = parts.length > 0 ? parts.join("\n\n") : JSON.stringify(content, null, 2);
  const truncation = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncation.truncated) {
    return output;
  }

  return `${truncation.content}\n\n[MCP output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
}

function boundStructuredContent(
  content?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (content === undefined) return undefined;

  const serialized = JSON.stringify(content);
  const totalBytes = Buffer.byteLength(serialized, "utf8");
  return totalBytes <= DEFAULT_MAX_BYTES
    ? content
    : { truncated: true, totalBytes };
}

interface McpTheme {
  fg: (name: ThemeColor, text: string) => string;
  bold: (text: string) => string;
}

const MAX_SERVER_NAME_WIDTH = 24;
const MAX_TOOL_NAME_WIDTH = 24;
const MAX_TOOL_NAMES = 4;
const TOOL_NAME_BUDGET = 40;
const MAX_ARGUMENT_PREVIEW_WIDTH = 240;
const MAX_RESULT_PREVIEW_WIDTH = 240;
const MAX_PREVIEW_SOURCE_CHARS = 2048;
const SENSITIVE_ARGUMENT_KEY = /api[-_]?key|access[-_]?token|authorization|password|passwd|secret|cookie/i;

/** 使用官方 Text 渲染，并在渲染宽度内将每个逻辑行截断为单行。 */
class CompactTextComponent implements Component {
  private readonly text = new Text("", 0, 0);
  private content = "";
  private renderedWidth?: number;

  /** 替换待展示文本，并清除宽度缓存。 */
  setContent(content: string): void {
    if (content === this.content) return;
    this.content = content;
    this.renderedWidth = undefined;
  }

  /** 按 Pi 提供的可用宽度渲染每个逻辑行。 */
  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    if (this.renderedWidth !== safeWidth) {
      const fitted = this.content
        .split("\n")
        .map((line) => truncateToWidth(line, safeWidth, "…"))
        .join("\n");
      this.text.setText(fitted);
      this.renderedWidth = safeWidth;
    }
    return this.text.render(safeWidth);
  }

  /** 清除 Text 与宽度缓存，供主题或布局变化后重绘。 */
  invalidate(): void {
    this.renderedWidth = undefined;
    this.text.invalidate();
  }
}

function renderCompactText(content: string, lastComponent: unknown): Component {
  const component = lastComponent instanceof CompactTextComponent
    ? lastComponent
    : new CompactTextComponent();
  component.setContent(content);
  return component;
}

function formatMcpToolCallSummary(
  args: unknown,
  options: { serverName: string; toolName: string; theme: McpTheme },
): string {
  const title = options.theme.fg(
    "toolTitle",
    options.theme.bold(`${options.serverName} / ${options.toolName}`),
  );
  const argumentSummary = formatMcpToolArguments(args);
  return argumentSummary
    ? `${title}\n${options.theme.fg("dim", argumentSummary)}`
    : title;
}

function formatMcpToolArguments(args: unknown): string {
  if (!isRecord(args)) return "";
  const entries = getOwnEntries(args, 8);
  if (entries.length === 0) return "";

  const preferredString = entries.find(
    ([key, value]) =>
      !SENSITIVE_ARGUMENT_KEY.test(key) &&
      typeof value === "string" &&
      value.trim().length > 0,
  )?.[1];
  if (typeof preferredString === "string") {
    return createInlinePreview(preferredString, MAX_ARGUMENT_PREVIEW_WIDTH);
  }

  const summary = summarizeArgumentValue(args, 0, new WeakSet<object>());
  return createInlinePreview(
    JSON.stringify(summary) ?? "",
    MAX_ARGUMENT_PREVIEW_WIDTH,
  );
}

function summarizeArgumentValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return truncateToWidth(value.slice(0, MAX_PREVIEW_SOURCE_CHARS), 120, "…");
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  if (depth >= 2) {
    return Array.isArray(value) ? `[… +${value.length} items]` : "{…}";
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 3)
      .map((item) => summarizeArgumentValue(item, depth + 1, seen));
    if (value.length > items.length) {
      items.push(`… +${value.length - items.length} items`);
    }
    seen.delete(value);
    return items;
  }

  const entries = getOwnEntries(value as Record<string, unknown>, 5);
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, 4)) {
    result[key] = SENSITIVE_ARGUMENT_KEY.test(key)
      ? "[redacted]"
      : summarizeArgumentValue(item, depth + 1, seen);
  }
  if (entries.length > 4) {
    result["…"] = "more fields";
  }
  seen.delete(value);
  return result;
}

function getOwnEntries(
  value: Record<string, unknown>,
  limit: number,
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    entries.push([key, value[key]]);
    if (entries.length >= limit) break;
  }
  return entries;
}

/**
 * 生成 MCP 工具结果的 TUI 摘要。
 *
 * 注意：这里只影响 Pi TUI 的展示；execute 返回的完整 content/details 仍会进入模型上下文。
 */
function formatMcpToolResultSummary(
  result: unknown,
  options: { isError: boolean; isPartial: boolean; theme: McpTheme },
): string {
  const text = extractToolResultText(result);
  const rawSize = Buffer.byteLength(text, "utf8");
  const isError = options.isError || extractToolResultDetails(result)?.isError === true;
  const marker = options.isPartial ? "…" : isError ? "✗" : "✓";
  const markerColor: ThemeColor = options.isPartial ? "warning" : isError ? "error" : "success";
  const status = options.isPartial ? "running" : isError ? "failed" : "completed";
  const preview = createInlinePreview(text, MAX_RESULT_PREVIEW_WIDTH) || "(empty MCP result)";

  return [
    `${options.theme.fg(markerColor, marker)} ${options.theme.fg("muted", `${status} · ${formatBytes(rawSize)}`)}`,
    options.theme.fg("toolOutput", preview),
  ].join("\n");
}

function extractToolResultText(result: unknown): string {
  if (!isRecord(result)) {
    return "";
  }
  const content = result.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
      return JSON.stringify(item);
    })
    .join("\n");
}

function extractToolResultDetails(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result) || !isRecord(result.details)) {
    return undefined;
  }
  return result.details;
}

function formatMcpFooter(online: number, configured: number, tools: number): string {
  return `MCP ${online}/${configured} · ${tools} tools`;
}

function formatToolNameSummary(tools: McpTool[], theme: McpTheme): string {
  if (tools.length === 0) return "";

  const shown: string[] = [];
  let usedWidth = 0;
  for (const tool of tools) {
    if (shown.length >= MAX_TOOL_NAMES) break;
    const name = truncateToWidth(tool.name, MAX_TOOL_NAME_WIDTH, "…");
    const nextWidth = usedWidth + (shown.length > 0 ? 1 : 0) + visibleWidth(name);
    if (shown.length > 0 && nextWidth > TOOL_NAME_BUDGET) break;
    shown.push(name);
    usedWidth = nextWidth;
  }

  const hiddenCount = tools.length - shown.length;
  const names = theme.fg("dim", shown.join(" "));
  return hiddenCount > 0
    ? `${names} ${theme.fg("muted", `+${hiddenCount}`)}`
    : names;
}

function padToVisibleWidth(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function createInlinePreview(text: string, maxWidth: number): string {
  const boundedSource = text.slice(0, MAX_PREVIEW_SOURCE_CHARS);
  const inline = boundedSource.replace(/\s+/g, " ").trim();
  return truncateToWidth(inline, maxWidth, "…");
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${formatDecimal(kib)} KB`;
  }
  return `${formatDecimal(kib / 1024)} MB`;
}

function formatDecimal(value: number): string {
  return value >= 10 ? `${Math.round(value)}` : value.toFixed(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
