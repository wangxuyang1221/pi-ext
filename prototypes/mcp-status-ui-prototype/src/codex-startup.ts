import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Server } from "./renderers.js";

// Codex 0.153.4 startup headers and status-row layout, rendered by the real Pi host.
// The gray sweep approximates Codex motion.rs/shimmer.rs without palette probing.
export function renderCodexStartup(servers: readonly Server[], elapsedMs: number, width: number): string[] {
  if (width <= 0) return [];
  const pending = servers.filter((server) => !server.connected && (server.status === "connecting" || server.status === "retrying"))
    .map((server) => server.name).sort();
  if (!pending.length) return [];
  const names = [...pending.slice(0, 3), ...(pending.length > 3 ? ["…"] : [])];
  const header = servers.length === 1 ? `Booting MCP server: ${pending[0]}`
    : `Starting MCP servers (${servers.length - pending.length}/${servers.length}): ${names.join(", ")}`;
  const time = formatElapsed(Math.max(0, Math.floor(elapsedMs / 1000)));
  const bullet = gray("•", 160 + Math.round(70 * (0.5 + 0.5 * Math.sin(elapsedMs / 300))));
  const hint = `\x1b[2m(${time} • \x1b[22m\x1b[1mesc\x1b[22m\x1b[2m to interrupt)\x1b[22m`;
  return [truncateToWidth(`${bullet} ${shimmer(header, elapsedMs)} ${hint}`, width, "…")];
}

function shimmer(text: string, elapsedMs: number): string {
  const chars = Array.from(text);
  const sweep = ((elapsedMs % 2000) / 2000) * (chars.length + 20) - 10;
  return chars.map((char, index) => {
    const intensity = Math.max(0, 1 - Math.abs(index - sweep) / 5);
    return gray(char, Math.round(140 + 100 * intensity));
  }).join("");
}

function gray(text: string, value: number): string {
  return `\x1b[1m\x1b[38;2;${value};${value};${value}m${text}\x1b[39m\x1b[22m`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const tail = `${String(seconds % 60).padStart(2, "0")}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${tail}`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}m ${tail}`;
}
