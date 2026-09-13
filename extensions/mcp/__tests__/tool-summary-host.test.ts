import { afterEach, describe, expect, it } from "vitest";
import { initTheme, ToolExecutionComponent, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderMcpToolCall, renderMcpToolResult } from "../src/renderers.js";

const themeModule = await import(new URL("../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js", import.meta.url).href);
const { setTheme } = themeModule;
const theme = themeModule.theme;

const tool = {
  name: "mcp_fixture", label: "MCP", description: "", parameters: {}, renderShell: "self",
  renderCall: (args, theme, context) => renderMcpToolCall(args, { serverName: "fixture", toolName: "preview" }, theme, context),
  renderResult: renderMcpToolResult,
} as ToolDefinition;
function createRow(id = "fixture") {
  return new ToolExecutionComponent("mcp_fixture", id, { query: "中文🙂" }, { showImages: false }, tool,
    { requestRender() {} }, "/repo");
}
const plain = (row: ToolExecutionComponent, width = 120) => row.render(width).map(stripTerminalSequences).filter(Boolean);
afterEach(() => setTheme("dark", false));

describe("MCP production host composition", () => {
  it("separates pending, partial, final success and both error flags without recursive invalidation", () => {
    initTheme("dark", false);
    const successful = createRow("success");
    expect(plain(successful).join("\n")).toContain("Calling");
    expect(successful.render(120).join("\n")).not.toContain(theme.fg("success", "⏺"));
    successful.markExecutionStarted();
    successful.updateResult({ content: [{ type: "text", text: "partial" }], isError: false }, true);
    expect(plain(successful).join("\n")).toContain("Running");
    successful.updateResult({ content: [{ type: "text", text: "one\ntwo" }], isError: false });
    expect(plain(successful)).toEqual(["⏺ Called fixture / preview (中文🙂)", "  └ one", "    two"]);
    expect(successful.render(120)[1]).toContain(theme.fg("success", "⏺"));
    for (const detailsError of [false, true]) {
      const failed = createRow(`failure-${detailsError}`);
      failed.updateResult({ content: [{ type: "text", text: "Cancelled: denied" }], isError: !detailsError,
        details: { isError: detailsError } });
      expect(plain(failed).join("\n")).toContain("Failed");
      expect(plain(failed).join("\n")).toContain("Cancelled: denied");
      expect(failed.render(120)[1]).toContain(theme.fg("error", "⏺"));
      expect(failed.render(120)[1]).not.toContain(theme.fg("success", "⏺"));
    }
    expect(plain(successful)[0]).toContain("Called");
  });

  it("bounds multi-block previews, preserves expanded limits and repaints theme colors", () => {
    initTheme("dark", false);
    const row = createRow();
    row.updateResult({ content: Array.from({ length: 20 }, (_, index) => ({ type: "text", text: `row-${index}: 中文🙂\x1b[31m` })), isError: false });
    for (const width of [0, 1, 2, 24, 60, 120]) {
      const lines = row.render(width);
      expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
      expect(lines.length).toBeLessThanOrEqual(7);
    }
    expect(plain(row).at(-1)).toMatch(/\.\.\.$/u);
    row.setExpanded(true);
    expect(plain(row).join("\n")).toContain("row-19");
    const dark = row.render(120).join("\n");
    setTheme("light", false); row.invalidate();
    expect(row.render(120).join("\n")).not.toBe(dark);
    row.setExpanded(false);
    expect(plain(row).at(-1)).toMatch(/\.\.\.$/u);
    row.updateResult({ content: [{ type: "text", text: "x\n".repeat(10000) }], isError: false });
    row.setExpanded(true);
    expect(plain(row).join("\n")).toContain("display truncated");
    expect(row.render(120).length).toBeLessThanOrEqual(2003);
  });
});
