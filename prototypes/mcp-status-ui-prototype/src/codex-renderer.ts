import type { Server } from "./renderers.js";

// Visual reference: openai/codex rust-v0.153.4, history_cell/mcp.rs.
// These SGR colors match Codex's dark-terminal ANSI palette, not the Pi theme.
const fg = (code: number, text: string) => `\x1b[${code}m${text}\x1b[39m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;

export function renderCodexInventory(servers: readonly Server[], verbose: boolean): string[] {
  const lines = [fg(35, "/mcp"), "", `🔌  ${bold("MCP Tools")}`, ""];
  if (!servers.length) {
    lines.push("\x1b[3m  • No MCP servers configured.\x1b[23m");
    const docs = "\x1b]8;;https://developers.openai.com/codex/mcp\x1b\\\x1b[4mMCP docs\x1b[24m\x1b]8;;\x1b\\";
    lines.push(dim(`    See the ${docs} to configure them.`));
    return lines;
  }
  const sorted = [...servers].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (verbose && !servers.some((server) => inventoryTools(server).length)) {
    lines.push("\x1b[3m  • No MCP tools available.\x1b[23m", "");
  }
  for (const server of sorted) {
    const names = inventoryTools(server);
    const count = names.length;
    const state = connectionState(server);
    const paint = (text: string) => state.color ? bold(fg(state.color, text)) : dim(text);
    lines.push(`${paint("  • ")}${bold(server.name)}: ${paint(state.label)}${dim(` (${count} ${count === 1 ? "tool" : "tools"})`)}`);
    if (verbose) {
      lines.push(`    • Auth: ${server.codex?.auth ?? "Unsupported"}`);
      lines.push(`    • Tools: ${names.length ? names.join(", ") : "(none)"}`);
      lines.push(`    • Resources: ${resources(server.codex?.resources)}`);
      lines.push(`    • Resource templates: ${resources(server.codex?.resourceTemplates)}`, "");
    }
  }
  if (!verbose) lines.push("", dim("  Use /mcp verbose for tools and resources."));
  return lines;
}

// Pi retrying has no exact Codex counterpart; the reference maps it to starting.
function connectionState(server: Server): { label: string; color?: number } {
  if (server.connected) return { label: "connected", color: 32 };
  if (server.status === "disabled") return { label: "disabled" };
  if (server.lastError?.category === "auth") return { label: "authentication required", color: 33 };
  if (server.lastError?.category === "cancelled") return { label: "cancelled" };
  if (server.status === "connecting" || server.status === "retrying") return { label: "starting", color: 36 };
  return { label: "failed", color: 31 };
}

function inventoryTools(server: Server): string[] {
  return server.connected ? [...new Set(server.tools.map((tool) => tool.name))].sort() : [];
}

function resources(items: Array<{ label: string; uri: string }> | undefined): string {
  return items?.length ? items.map((item) => `${item.label} ${dim(`(${item.uri})`)}`).join(", ") : "(none)";
}
