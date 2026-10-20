import { expect, test } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { toolStatusMarker, type ToolStatus } from "../src/tool-status.js";
import { renderMcpToolCall, renderMcpToolResult } from "../../mcp/src/renderers.js";

const theme = { fg: (tone: string, text: string) => `<${tone}>${text}</${tone}>`, bold: (text: string) => text } as Theme;

test("uses category glyphs with muted success and unchanged warning or error states", () => {
  for (const glyph of ["$", "@", "~"]) {
    for (const [status, tone] of Object.entries({ pending: "warning", running: "warning", completed: "muted", failed: "error", interrupted: "warning", timed_out: "warning" })) {
      expect(toolStatusMarker(theme, status as ToolStatus, glyph)).toBe(`<${tone}>${glyph}</${tone}>`);
    }
  }
});

test("uses the same MCP prefix and muted success for every live or historical identity", () => {
  for (const names of [
    { serverName: "exa", toolName: "web_search_exa" },
    { serverName: "fixture", toolName: "search" },
    { serverName: "search", toolName: "fetch_json" },
    { serverName: "fixture", toolName: "research" },
    { fullName: "mcp__exa__web_search_exa" },
    { fullName: "mcp__search__fetch_json" },
    { fullName: "unrecognized_search" },
    { fullName: "mcp__server__ambiguous__search" },
  ] as const) {
    const state = {};
    const context = { state, lastComponent: undefined, isPartial: false, isError: false };
    const call = renderMcpToolCall({}, names, theme, context);
    expect(call.render(120)[0]).toMatch(/^<warning>⌁<\/warning> <toolTitle>Calling<\/toolTitle> /);
    renderMcpToolResult({ content: [{ type: "text", text: "Found results" }] }, { isPartial: false, expanded: false }, theme, context);
    expect(call.render(120)[0]).toMatch(/^<muted>⌁<\/muted> <toolTitle>Called<\/toolTitle> /);
    renderMcpToolResult({ content: [{ type: "text", text: "Permission denied" }] }, { isPartial: false, expanded: false }, theme, { ...context, isError: true });
    expect(call.render(120)[0]).toMatch(/^<error>⌁<\/error> <toolTitle>Call failed for<\/toolTitle> /);
  }
});
