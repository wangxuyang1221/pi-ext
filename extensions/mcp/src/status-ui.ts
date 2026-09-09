import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { sanitizeDiagnosticText } from "./diagnostics.js";
import type { McpServerState } from "./types.js";

export interface McpInventoryServer {
  name: string;
  status: string;
  tools: string[];
}

export interface McpInventory {
  servers: McpInventoryServer[];
  verbose: boolean;
  notice?: string;
}

/** Captures display-only fields, never transport configuration or credentials. */
export function inventoryServer(name: string, state: McpServerState | undefined): McpInventoryServer {
  const status = state?.connected ? "connected"
    : state?.status === "disabled" ? "disabled"
    : state?.lastError?.category === "cancelled" ? "cancelled"
    : state?.lastError?.category === "auth" ? "authentication required"
    : state?.status === "connecting" || state?.status === "retrying" ? "starting"
    : state ? "failed" : "unknown";
  return {
    name: safeLabel(name),
    status,
    tools: state?.connected ? [...new Set(state.tools.map((tool) => safeLabel(tool.name)))].sort() : [],
  };
}

/** Renders a durable inventory outside model context. */
export function inventoryComponent(inventory: McpInventory, theme: Pick<Theme, "fg" | "bold">): Component {
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  return {
    render(width) {
      if (width <= 0) return [];
      if (cachedWidth === width && cachedLines) return cachedLines;
      const lines = [theme.fg("accent", inventory.verbose ? "/mcp verbose" : "/mcp"), "", `🔌  ${theme.bold("MCP Tools")}`, ""];
      if (inventory.notice) lines.push(theme.fg("warning", `  • ${safeLabel(inventory.notice)}`), "");
      if (!inventory.servers.length && !inventory.notice) lines.push("  • No MCP servers configured.");
      for (const server of inventory.servers) {
        const color: ThemeColor = server.status === "connected" ? "success"
          : server.status === "failed" ? "error"
          : server.status === "authentication required" ? "warning"
          : server.status === "starting" ? "accent" : "dim";
        const paint = (text: string) => theme.fg(color, theme.bold(text));
        lines.push(`${paint("  • ")}${theme.bold(safeLabel(server.name))}: ${paint(safeLabel(server.status))}${theme.fg("dim", ` (${server.tools.length} ${server.tools.length === 1 ? "tool" : "tools"})`)}`);
        if (inventory.verbose) lines.push(`    • Tools: ${server.tools.length ? server.tools.map(safeLabel).join(", ") : "(none)"}`, "");
      }
      if (!inventory.verbose && inventory.servers.length) lines.push("", theme.fg("dim", "  Use /mcp verbose for tool details."));
      cachedWidth = width;
      cachedLines = lines.flatMap((line) => wrapTextWithAnsi(line, width).map((part) => truncateToWidth(part, width, "…")));
      return cachedLines;
    },
    invalidate() {
      cachedWidth = undefined;
      cachedLines = undefined;
    },
  };
}

function safeLabel(text: string): string {
  return sanitizeDiagnosticText(text, 512).replace(/\s+/g, " ");
}
