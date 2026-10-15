import { beforeEach, expect, test, vi } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ToolExecutionComponent, type ExtensionAPI, type ToolDefinition, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import search from "../src/index.ts";
import { loadConfig } from "../src/config.ts";

vi.mock("../src/config.ts", async original => ({
  ...await original<typeof import("../src/config.ts")>(), loadConfig: vi.fn(),
}));
const themes = await import(pathToFileURL(join(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")).href);
const theme: Theme = themes.loadThemeFromPath(join(process.cwd(), "themes/codex-pi.json"), "truecolor");
const config = { enabled: true, toolName: "codex_search", searchApi: "responses" as const, standaloneEnabled: false,
  defaultFreshness: "live" as const, defaultSearchContextSize: "medium" as const, batchSize: 5, sources: {} };
const args = { queries: ["fixture query"], freshness: "live", search_context_size: "low" };
const result = { content: [{ type: "text" as const, text: "Fixture result" }], isError: false,
  details: { model: "fixture", api: "responses", freshness: "live", searchContextSize: "low", queryCount: 1, failedQueryCount: 0,
    queries: args.queries, successes: [{ query: args.queries[0], text: "Fixture result", citations: [{ url: "https://example.com" }], searchCalls: [] }], failures: [], elapsedMs: 13000 } };
function harness() {
  const tools = new Map<string, ToolDefinition>();
  const events = new Map<string, Function>();
  // Model older hosts that activate all registered tools, ignoring exposure.
  let activeTools = ["read"];
  search({ registerCommand() {},
    getActiveTools() { return activeTools; },
    setActiveTools(names: string[]) { activeTools = names; },
    registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); activeTools = [...new Set([...activeTools, tool.name])]; },
    on(name: string, handler: Function) { events.set(name, handler); } } as unknown as ExtensionAPI);
  const start = () => events.get("session_start")!({ reason: "resume" }, { cwd: process.cwd(), isProjectTrusted: () => false });
  return { tools, start, active: () => activeTools };
}
beforeEach(() => { vi.mocked(loadConfig).mockReset().mockResolvedValue(config); themes.setThemeInstance(theme); });

test("renders historical search before session_start, matching interactive resume ordering", async () => {
  const h = harness();
  expect(loadConfig).not.toHaveBeenCalled();
  const definition = h.tools.get("codex_search");
  expect(definition?.renderShell).toBe("self");
  const row = new ToolExecutionComponent("codex_search", "history", args, { showImages: false }, definition,
    { requestRender: vi.fn() } as unknown as TUI, process.cwd());
  row.updateResult(JSON.parse(JSON.stringify(result)));
  const lines = () => row.render(120).map(stripTerminalSequences).join("\n");
  expect(lines()).toContain("⌕ Searched web (fixture query)");
  expect(lines()).toContain("1 source · 1 query · 13s");
  await h.start();
  expect(h.tools.get("codex_search")?.exposure).not.toBe("hidden");
  expect(h.active()).toEqual(["read", "codex_search"]);
  expect(lines()).toContain("⌕ Searched web (fixture query)");
  row.setExpanded(true);
  expect(lines()).toContain("responses · low · live");
});

test("keeps display-only definitions hidden and rejects execution when disabled", async () => {
  vi.mocked(loadConfig).mockResolvedValue({ ...config, enabled: false });
  const h = harness();
  await h.start();
  expect(h.active()).toEqual(["read"]);
  for (const name of ["codex_search", "codex_standalone_web"]) {
    const tool = h.tools.get(name);
    expect(tool?.exposure).toBe("hidden");
    expect(tool?.renderCall).toBeTypeOf("function");
    expect(tool?.renderResult).toBeTypeOf("function");
    await expect(tool!.execute("history", {}, undefined, undefined, {} as never)).rejects.toThrow(/display-only/i);
  }
});

test("only enables standalone execution when explicitly configured", async () => {
  const h = harness();
  await h.start();
  expect(h.tools.get("codex_standalone_web")?.exposure).toBe("hidden");
  vi.mocked(loadConfig).mockResolvedValue({ ...config, standaloneEnabled: true });
  const enabled = harness();
  await enabled.start();
  expect(enabled.tools.get("codex_standalone_web")?.exposure).not.toBe("hidden");
  expect(enabled.active()).toEqual(["read", "codex_search", "codex_standalone_web"]);
});
