import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { McpServerState } from "../../../extensions/mcp/src/types.js";
import { renderCodexInventory } from "./codex-renderer.js";

export type Variant = "minimal" | "table" | "progress" | "codex";
export type Server = Pick<McpServerState, "connected" | "status" | "tools" | "attempt" | "lastError"> & {
  name: string;
  codex?: {
    auth: string;
    resources?: Array<{ label: string; uri: string }>;
    resourceTemplates?: Array<{ label: string; uri: string }>;
  };
};

export function renderPanel(variant: Variant, servers: readonly Server[], details: boolean, theme: Theme, width: number): string[] {
  if (width <= 0) return [];
  const lines = variant === "codex" ? renderCodexInventory(servers, details)
    : servers.length === 0 ? [theme.fg("muted", "No MCP servers configured")]
    : variant === "progress" && details ? renderProgressDetails(servers, theme, Math.min(width, 40))
    : renderLines(variant, servers, details, theme);
  return lines.flatMap((line) => line ? wrapTextWithAnsi(line, width) : [""])
    .map((line) => truncateToWidth(line, width, ""));
}

function renderLines(variant: Variant, servers: readonly Server[], details: boolean, theme: Theme): string[] {
  const online = servers.filter((server) => server.connected);
  const pending = servers.filter((server) => !server.connected);
  const healthy = pending.length === 0;
  const failed = pending.some((server) => server.status !== "connecting" && server.status !== "retrying");
  const tools = online.reduce((sum, server) => sum + toolCount(server), 0);
  const summary = `${online.length}/${servers.length} online · ${tools} tools`;
  const color = healthy ? "success" : failed ? "error" : "warning";
  const icon = theme.fg(color, healthy ? "✓" : failed ? "!" : "◐");
  const muted = (text: string) => theme.fg("muted", text);
  const issue = (server: Server) => server.connected ? [] : [
    muted(`  ${server.lastError?.message ?? "Waiting for server handshake"}${server.status === "retrying" ? ` · attempt ${server.attempt}` : ""}`),
  ];
  const row = (server: Server) => {
    const icon = variant === "progress" && server.connected ? theme.fg("success", "✓") : marker(server, theme);
    const name = variant === "progress" && server.connected ? muted(server.name.padEnd(16)) : server.name.padEnd(16);
    return `${icon} ${name}${muted(server.connected ? `${toolCount(server)} tools` : label(server))}`;
  };

  if (variant === "table") {
    return [theme.bold("MCP") + "                              " + theme.fg(color, healthy ? "READY" : failed ? "DEGRADED" : "CONNECTING"),
      muted(summary), "", theme.fg("dim", "  SERVER          STATUS           TOOLS"),
      ...servers.flatMap((server) => [
        `${marker(server, theme)} ${server.name.padEnd(16)}${label(server).padEnd(16)}${muted(String(server.connected ? toolCount(server) : "—").padStart(5))}`,
        ...issue(server),
      ]),
    ];
  }
  if (variant === "progress") {
    if (healthy && !details) return [
      `${icon} ${theme.bold("MCP connected")}${muted(` · ${tools} tools`)}`, muted(`  ${servers.map((server) => server.name).join(" · ")}`),
    ];
    const title = healthy ? "MCP connected" : failed ? "MCP partially connected" : "Connecting MCP servers";
    const visible = failed && !details ? pending : servers;
    return [`${icon} ${theme.bold(title)}`, muted(`  ${summary}`), "",
      ...visible.flatMap((server) => [row(server), ...issue(server)]),
    ];
  }
  const lines = [healthy ? `${icon} ${theme.bold("MCP ready")}${muted(` · ${online.length} servers · ${tools} tools`)}` : `${icon} ${theme.bold("MCP")} · ${summary}`];
  const visible = details ? servers : pending;
  if (details) lines.push("");
  for (const server of visible) lines.push(row(server), ...issue(server));
  return lines;
}

function renderProgressDetails(servers: readonly Server[], theme: Theme, width: number): string[] {
  const tools = servers.reduce((sum, server) => sum + toolCount(server), 0);
  const online = servers.filter((server) => server.connected);
  const unavailable = servers.filter((server) => !server.connected);
  const pair = (left: string, right: string) => left + " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right))) + right;
  const lines = [pair(theme.bold("MCP servers"), theme.fg("muted", `${tools} tools${unavailable.length ? " available" : ""}`)), ""];
  for (const server of unavailable) {
    const retrying = server.status === "retrying";
    const color = retrying || server.status === "connecting" ? "warning" : "error";
    lines.push(pair(`${marker(server, theme)} ${server.name}`, theme.fg(color, label(server))));
    lines.push(theme.fg("muted", `  ${server.lastError?.message ?? "Waiting for server handshake"}${retrying ? ` · attempt ${server.attempt}` : ""}`));
  }
  if (unavailable.length && online.length) lines.push("");
  lines.push(...online.map((server) => pair(`${theme.fg("success", "✓")} ${server.name}`, theme.fg("muted", String(toolCount(server))))));
  return lines;
}

function toolCount(server: Server): number {
  return server.connected ? new Set(server.tools.map((tool) => tool.name)).size : 0;
}

function label(server: Server): string {
  if (server.connected) return "Connected";
  if (server.status === "offline") return "Offline";
  return server.status[0].toUpperCase() + server.status.slice(1);
}

function marker(server: Server, theme: Theme): string {
  if (server.connected) return theme.fg("success", "●");
  if (server.status === "connecting" || server.status === "retrying") return theme.fg("warning", "◐");
  return theme.fg("error", "×");
}
