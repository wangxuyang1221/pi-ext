import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { sanitizeDiagnosticText } from "./diagnostics.js";
/** Captures display-only fields, never transport configuration or credentials. */
export function inventoryServer(name, state) {
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
export function inventoryComponent(inventory, theme) {
    let cachedWidth;
    let cachedLines;
    return {
        render(width) {
            if (width <= 0)
                return [];
            if (cachedWidth === width && cachedLines)
                return cachedLines;
            const lines = [theme.fg("accent", inventory.verbose ? "/mcp verbose" : "/mcp"), "", `🔌  ${theme.bold("MCP Tools")}`, ""];
            if (inventory.notice)
                lines.push(theme.fg("warning", `  • ${safeLabel(inventory.notice)}`), "");
            if (!inventory.servers.length && !inventory.notice)
                lines.push("  • No MCP servers configured.");
            for (const server of inventory.servers) {
                const color = server.status === "connected" ? "success"
                    : server.status === "failed" ? "error"
                        : server.status === "authentication required" ? "warning"
                            : server.status === "starting" ? "accent" : "dim";
                const paint = (text) => theme.fg(color, theme.bold(text));
                lines.push(`${paint("  • ")}${theme.bold(safeLabel(server.name))}: ${paint(safeLabel(server.status))}${theme.fg("dim", ` (${server.tools.length} ${server.tools.length === 1 ? "tool" : "tools"})`)}`);
                if (inventory.verbose)
                    lines.push(`    • Tools: ${server.tools.length ? server.tools.map(safeLabel).join(", ") : "(none)"}`, "");
            }
            if (!inventory.verbose && inventory.servers.length)
                lines.push("", theme.fg("dim", "  Use /mcp verbose for tool details."));
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
function safeLabel(text) {
    return sanitizeDiagnosticText(text, 512).replace(/\s+/g, " ");
}
//# sourceMappingURL=status-ui.js.map