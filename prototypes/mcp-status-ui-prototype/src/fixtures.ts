import type { Server, Variant } from "./renderers.js";

export const variants: Variant[] = ["minimal", "table", "progress", "codex"];
export const scenes = ["connecting", "ready", "retrying", "failed"] as const;
export type Scene = typeof scenes[number];
export const variantNames: Record<Variant, string> = {
  minimal: "01 / Minimal status", table: "02 / Compact table", progress: "03 / Connection progress",
  codex: "04 / Codex CLI reference",
};

// Display-only inventory examples, not discovery results from the user's servers.
const inventory = [
  ["context7", ["resolve-library-id", "query-docs"]],
  ["MultiFetch", ["fetch_html", "fetch_json", "fetch_txt", "fetch_markdown", "fetch_plaintext"]],
  ["mysql", ["execute_sql", "get_schema_info", "get_table_sample"]],
  ["exa", ["web_search_exa", "web_search_advanced_exa", "web_fetch_exa"]],
] as const;

// Fixture data replaces the MCP manager; no transport or credentials are created.
export function fixture(scene: Scene, onlineDuringStartup = 3): Server[] {
  return inventory.map(([name, tools], index) => {
    const connected = scene === "ready" || (scene === "connecting"
      ? [0, 1, 3, 2].indexOf(index) < onlineDuringStartup : name !== "mysql");
    const status = connected ? "connected" : scene === "failed" ? "offline" : scene === "retrying" ? "retrying" : "connecting";
    return {
      name, connected, status, attempt: scene === "retrying" || scene === "failed" ? 2 : 1,
      tools: tools.map((name) => ({ name, inputSchema: {} })),
      codex: { auth: "Unsupported", resources: [], resourceTemplates: [] },
      ...(!connected && status !== "connecting" ? { lastError: {
        category: "timeout" as const, message: "Connection timed out", retryable: true,
      } } : {}),
    };
  });
}
