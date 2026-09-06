import { describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  renderMcpToolCall,
  renderMcpToolResult,
} from "../src/renderers.js";

const { wrapSpy } = vi.hoisted(() => ({ wrapSpy: vi.fn() }));
vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return { ...actual, wrapTextWithAnsi: (...args: Parameters<typeof actual.wrapTextWithAnsi>) => {
    wrapSpy(...args); return actual.wrapTextWithAnsi(...args);
  } };
});

const TOOL_NAMES = {
  serverName: "MultiFetch",
  toolName: "fetch_json",
};

function createTheme(): Theme {
  return {
    fg: (_name: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/gu, "");
}

describe("MCP tool renderers", () => {
  it("keeps JSON punctuation, escaped quotes, backslashes and Unicode inside strings intact", () => {
    const value = { a: '中文, : "quoted, :" \\ path', b: [true, null] };
    const component = renderMcpToolResult({ content: [{ type: "text", text: JSON.stringify(value) }] },
      { expanded: false, isPartial: false }, createTheme(), { isError: false, isPartial: false, lastComponent: undefined });
    const preview = stripAnsi(component.render(128).join("\n")).slice(4);
    expect(JSON.parse(preview)).toEqual(value);
    expect(preview).toContain(', "b": [true, null]');
  });

  it("falls back to bounded original JSON when pretty printing exceeds the stack", () => {
    const source = "[".repeat(10000) + "0" + "]".repeat(10000);
    const component = renderMcpToolResult({ content: [{ type: "text", text: source }] },
      { expanded: false, isPartial: false }, createTheme(), { isError: false, isPartial: false, lastComponent: undefined });
    expect(component.render(120).join("\n")).toContain("[[[");
  });

  it("bounds formatted JSON and retains the truncation notice", () => {
    const source = "[".repeat(1000) + "0" + "]".repeat(1000);
    const component = renderMcpToolResult({ content: [{ type: "text", text: source }] },
      { expanded: true, isPartial: false }, createTheme(), { isError: false, isPartial: false, lastComponent: undefined });
    const output = component.render(128).map(stripAnsi).join("\n");
    expect(output).toContain("truncated");
    expect(output.length).toBeLessThan(65000);
  });

  it("does not add a blank result row for empty content in either view", () => {
    for (const expanded of [false, true]) {
      const component = renderMcpToolResult({ content: [] }, { expanded, isPartial: false }, createTheme(),
        { isError: false, isPartial: false, lastComponent: undefined });
      expect(component.render(120)).toEqual([]);
    }
  });

  it("stops preview layout at five visual lines and marks overflow", () => {
    wrapSpy.mockClear();
    const component = renderMcpToolResult({ content: [{ type: "text", text: "中🙂x".repeat(6000) }] },
      { expanded: false, isPartial: false }, createTheme(), { isError: false, isPartial: false, lastComponent: undefined });
    const lines = component.render(24).map(stripAnsi);
    expect(lines).toHaveLength(5);
    expect(lines[4]).toMatch(/\.\.\.$/u);
    expect(lines.every(line => visibleWidth(line) <= 24)).toBe(true);
    expect(wrapSpy.mock.calls.every(([text]) => text.length <= 24 * 6)).toBe(true);
  });

  it("keeps success detail dim and preserves image hints without exposing data", () => {
    const color = vi.fn((_name: string, text: string) => text);
    const theme = { ...createTheme(), fg: color } as Theme;
    for (const expanded of [false, true]) for (const mixed of [false, true]) {
      const component = renderMcpToolResult({ content: [
        { type: "image", data: "private-base64", mimeType: "image/png" },
        ...(mixed ? [{ type: "text", text: "hello" }] : []),
      ] }, { expanded, isPartial: false }, theme, { isError: false, isPartial: false, lastComponent: undefined });
      color.mockClear();
      const output = component.render(120).join("\n");
      expect(output).not.toContain("private-base64");
      expect(output).toContain(mixed ? "hello" : "Image");
      expect(color.mock.calls.every(([name]) => name === "dim")).toBe(true);
    }
  });

  it("prepares JSON once across paints, expansion, resize and host wrapper replacement", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      const content = [{ type: "text", text: '{"rows":[1,2,3]}' }];
      const details = {};
      const state = {};
      let component;
      for (const expanded of [false, true, false, true]) {
        component = renderMcpToolResult({ content, details }, { expanded, isPartial: false }, createTheme(),
          { state, isError: false, isPartial: false, lastComponent: component });
        for (const width of [120, 24, 120]) component.render(width);
        component.invalidate();
      }
      expect(parse).toHaveBeenCalledTimes(1);
    } finally { parse.mockRestore(); }
  });

  it("does not settle a row when the result is absent", () => {
    const state = {};
    const context = { state, isError: false, isPartial: false, lastComponent: undefined };
    const call = renderMcpToolCall({}, TOOL_NAMES, createTheme(), context);
    renderMcpToolResult(undefined, { expanded: false, isPartial: false }, createTheme(), context);
    expect(call.render(120).join("\n")).toContain("Calling");
  });

  it("shares explicit result status with the title before its first paint", () => {
    const theme = { ...createTheme(), fg: (name: string, text: string) => `<${name}>${text}</${name}>` } as Theme;
    for (const isError of [false, true]) {
      const state = {};
      const context = { state, isError: false, isPartial: false, lastComponent: undefined };
      const call = renderMcpToolCall({}, TOOL_NAMES, theme, context);
      expect(call.render(128).join("\n")).toContain("Calling");
      renderMcpToolResult({ content: [{ type: "text", text: isError ? "denied" : "ok" }], details: { isError } },
        { isPartial: false, expanded: false }, theme, context);
      const title = call.render(128).join("\n");
      expect(title).toContain(isError ? "<error>•</error>" : "<success>•</success>");
      expect(title).toContain(isError ? "Call failed for" : "Called");
    }
  });
  it("shows a dim compact JSON preview without a success summary", () => {
    const theme = createTheme();
    const url = "https://example.test/api/telemetry?page=1&pageSize=20";
    const state = {};
    const call = renderMcpToolCall(
      { url },
      TOOL_NAMES,
      theme,
      { state, isError: false, isPartial: false, lastComponent: undefined },
    );
    const resultText = '{"items":[1,2]}';
    const result = renderMcpToolResult(
      {
        content: [{ type: "text", text: resultText }],
        details: { mcp: true, isError: false },
      },
      { expanded: false, isPartial: false },
      theme,
      { state, isError: false, isPartial: false, lastComponent: undefined },
    );

    expect(stripAnsi(call.render(128).join("\n"))).toBe(
      `• Called MultiFetch / fetch_json (${url})`,
    );
    const collapsed = stripAnsi(result.render(128).join("\n"));
    expect(collapsed).toBe('  └ {"items": [1, 2]}');
    expect(collapsed).not.toMatch(/Completed|JSON|15 B|expand/u);
  });

  it("pretty-prints bounded JSON only when tool output is expanded", () => {
    const theme = createTheme();
    const component = renderMcpToolResult(
      {
        content: [{ type: "text", text: '{"items":[1,2],"page":1}' }],
        details: { mcp: true, isError: false },
      },
      { expanded: true, isPartial: false },
      theme,
      { isError: false, isPartial: false, lastComponent: undefined },
    );
    const lines = component.render(128).map(stripAnsi);

    expect(lines[0]).toBe("    {");
    expect(lines.join("\n")).not.toMatch(/Completed|collapse/u);
    expect(lines).toContain('      "items": [');
    expect(lines).toContain("        1,");
    expect(lines).toContain('      "page": 1');
    expect(lines.every((line) => visibleWidth(line) <= 110)).toBe(true);
  });

  it("renders running and failed calls without the default status shell", () => {
    const theme = createTheme();
    const runningCall = renderMcpToolCall(
      { query: "telemetry" },
      TOOL_NAMES,
      theme,
      { isError: false, isPartial: true, lastComponent: undefined },
    );
    const runningResult = renderMcpToolResult(
      { content: [] },
      { expanded: false, isPartial: true },
      theme,
      { isError: false, isPartial: true, lastComponent: undefined },
    );
    const failedCall = renderMcpToolCall(
      { query: "telemetry" },
      TOOL_NAMES,
      theme,
      { isError: true, isPartial: false, lastComponent: undefined },
    );
    const failedResult = renderMcpToolResult(
      {
        content: [{ type: "text", text: "request timed out after 30s" }],
        details: { mcp: true, isError: true },
      },
      { expanded: false, isPartial: false },
      theme,
      { isError: true, isPartial: false, lastComponent: undefined },
    );

    expect(stripAnsi(runningCall.render(128)[0] ?? "")).toContain("• Calling MultiFetch / fetch_json");
    expect(stripAnsi(runningResult.render(128)[0] ?? "")).toBe(
      "  └ Running · waiting for response",
    );
    expect(stripAnsi(failedCall.render(128)[0] ?? "")).toContain(
      "• Call failed for MultiFetch / fetch_json",
    );
    expect(stripAnsi(failedResult.render(128)[0] ?? "")).toContain(
      "  └ Failed · request timed out after 30s · ctrl+o expand",
    );
  });

  it("caps summaries at 110 cells and preserves a clean ASCII truncation marker", () => {
    const theme = createTheme();
    const component = renderMcpToolCall(
      { url: `https://example.test/${"telemetry/".repeat(40)}` },
      TOOL_NAMES,
      theme,
      { isError: false, isPartial: false, lastComponent: undefined },
    );
    const wideLine = stripAnsi(component.render(160)[0] ?? "");

    expect(visibleWidth(wideLine)).toBe(110);
    expect(wideLine.endsWith("...)")).toBe(true);
    expect(wideLine).not.toContain("…");
    expect(component.render(80).every((line) => visibleWidth(line) <= 72)).toBe(true);
    expect(component.render(24).every((line) => visibleWidth(line) <= 24)).toBe(true);
    expect(component.render(0)).toEqual([]);
    expect(component.render(-1)).toEqual([]);
  });

  it("redacts sensitive argument values and reuses responsive components", () => {
    const theme = createTheme();
    const first = renderMcpToolCall(
      { apiKey: "private-token", nested: { password: "also-private" } },
      TOOL_NAMES,
      theme,
      { isError: false, isPartial: true, lastComponent: undefined },
    );
    const second = renderMcpToolCall(
      { apiKey: "private-token", nested: { password: "also-private" } },
      TOOL_NAMES,
      theme,
      { isError: false, isPartial: false, lastComponent: first },
    );
    const output = stripAnsi(second.render(128).join("\n"));

    expect(second).toBe(first);
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("private-token");
    expect(output).not.toContain("also-private");
    expect(output).toContain("• Calling MultiFetch / fetch_json");
  });

  it("uses structured content when an MCP result has no text blocks", () => {
    const component = renderMcpToolResult(
      {
        content: [],
        details: {
          mcp: true,
          isError: false,
          structuredContent: { rows: [{ id: 1 }] },
        },
      },
      { expanded: true, isPartial: false },
      createTheme(),
      { isError: false, isPartial: false, lastComponent: undefined },
    );
    const output = stripAnsi(component.render(128).join("\n"));

    expect(output).not.toContain("Completed");
    expect(output).toContain('"rows": [');
  });
});
