import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { HistoryIdentity } from "./history.js";
import { renderMcpToolCall, renderMcpToolResult } from "./renderers.js";

/** Defines display-only history with no manager, schema cache, or execution route. */
export function historyTool(identity: HistoryIdentity): ToolDefinition {
  return {
    name: identity.fullName,
    label: "MCP",
    description: "",
    parameters: Type.Object({}),
    renderShell: "self",
    renderCall(args, theme, context) {
      const names = identity.serverName !== undefined && identity.toolName !== undefined
        ? { serverName: identity.serverName, toolName: identity.toolName } : { fullName: identity.fullName };
      return renderMcpToolCall(args, names, theme, context);
    },
    renderResult: renderMcpToolResult,
    async execute() {
      throw new Error(`MCP tool "${identity.fullName}" is history-only and cannot execute. Reconnect its server to use the current tool.`);
    },
  };
}
