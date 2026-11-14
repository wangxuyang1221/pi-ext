import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { HistoryIdentity } from "./history.js";
import { renderMcpToolCall, renderMcpToolResult } from "./renderers.js";

/** Renders historical calls without registering executable tools. */
export function historyRenderers(identity: HistoryIdentity): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      const names = identity.serverName !== undefined && identity.toolName !== undefined
        ? { serverName: identity.serverName, toolName: identity.toolName } : { fullName: identity.fullName };
      return renderMcpToolCall(args, names, theme, context);
    },
    renderResult: renderMcpToolResult,
  };
}
