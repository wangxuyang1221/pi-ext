import { expect, test } from "vitest";
import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import search from "../src/index.ts";

function registeredTools() {
  const tools = new Map<string, ToolDefinition>();
  search({
    registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); },
    registerCommand() {},
    on() {},
  } as unknown as ExtensionAPI);
  return tools;
}

function validate(tool: ToolDefinition, args: ToolCall["arguments"]) {
  return validateToolArguments(tool, { type: "toolCall", id: "schema", name: tool.name, arguments: args });
}

test("preserves string enum schemas and descriptions for both search entry points", () => {
  const tools = registeredTools();
  expect(tools.get("codex_search")!.parameters).toMatchObject({
    properties: {
      search_context_size: { type: "string", enum: ["low", "medium", "high"], description: "Amount of web context to retrieve. Defaults to medium." },
      freshness: { type: "string", enum: ["cached", "indexed", "live"], description: expect.stringContaining("Defaults to live.") },
    },
  });
  expect(tools.get("codex_standalone_web")!.parameters).toMatchObject({
    properties: {
      search_context_size: { type: "string", enum: ["medium", "high"], description: expect.stringContaining('Standalone mode disables "low".') },
      freshness: { type: "string", enum: ["cached", "indexed", "live"], description: expect.stringContaining("Defaults to live.") },
      finance: { items: { properties: { type: { type: "string", enum: ["equity", "fund", "crypto", "index"] } } } },
      sports: { items: { properties: {
        fn: { type: "string", enum: ["schedule", "standings"] },
        league: { type: "string", enum: ["nba", "wnba", "nfl", "nhl", "mlb", "epl", "ncaamb", "ncaawb", "ipl"] },
      } } },
    },
  });
});

test("uses the host validator to accept valid enums and reject unsupported values", () => {
  const tools = registeredTools();
  const responses = tools.get("codex_search")!;
  const standalone = tools.get("codex_standalone_web")!;
  for (const search_context_size of ["low", "medium", "high"]) {
    expect(() => validate(responses, { queries: ["fixture"], search_context_size, freshness: "live" })).not.toThrow();
  }
  expect(() => validate(responses, { queries: ["fixture"], freshness: "future" })).toThrow();
  expect(() => validate(standalone, { urls: ["https://example.com"], search_context_size: "low" })).toThrow();
  expect(() => validate(standalone, { finance: [{ ticker: "ABC", type: "equity" }] })).not.toThrow();
  expect(() => validate(standalone, { finance: [{ ticker: "ABC", type: "bond" }] })).toThrow();
  expect(() => validate(standalone, { sports: [{ fn: "schedule", league: "nba" }] })).not.toThrow();
  expect(() => validate(standalone, { sports: [{ fn: "scores", league: "nba" }] })).toThrow();
  expect(() => validate(standalone, { sports: [{ fn: "standings", league: "unknown" }] })).toThrow();
});
