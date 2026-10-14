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

test("only classifies explicit search tool names, never server names or arbitrary substrings", () => {
  for (const [names, search] of [
    [{ serverName: "exa", toolName: "web_search_exa" }, true],
    [{ serverName: "fixture", toolName: "search" }, true],
    [{ serverName: "search", toolName: "fetch_json" }, false],
    [{ serverName: "fixture", toolName: "research" }, false],
    [{ fullName: "mcp__exa__web_search_exa" }, true],
    [{ fullName: "mcp__search__fetch_json" }, false],
    [{ fullName: "unrecognized_search" }, false],
    [{ fullName: "mcp__server__ambiguous__search" }, false],
  ] as const) {
    const state = {};
    const context = { state, lastComponent: undefined, isPartial: false, isError: false };
    const call = renderMcpToolCall({}, names, theme, context);
    expect(call.render(120)[0]).toContain(`<warning>${search ? "⌕" : "⏺"}</warning>`);
    renderMcpToolResult({ content: [{ type: "text", text: "Found results" }] }, { isPartial: false, expanded: false }, theme, context);
    expect(call.render(120)[0]).toContain(search ? "<muted>⌕</muted>" : "<success>⏺</success>");
    renderMcpToolResult({ content: [{ type: "text", text: "Permission denied" }] }, { isPartial: false, expanded: false }, theme, { ...context, isError: true });
    expect(call.render(120)[0]).toContain(`<error>${search ? "⌕" : "⏺"}</error>`);
  }
});
