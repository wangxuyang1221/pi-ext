import { describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  renderMcpToolCall,
  renderMcpToolResult,
} from "../src/mcp-renderers.js";

const { wrapSpy, widthSpy, truncateSpy } = vi.hoisted(() => ({
  wrapSpy: vi.fn(), widthSpy: vi.fn(), truncateSpy: vi.fn(),
}));
vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return {
    ...actual,
    wrapTextWithAnsi: (...args: Parameters<typeof actual.wrapTextWithAnsi>) => {
      wrapSpy(...args); return actual.wrapTextWithAnsi(...args);
    },
    visibleWidth: (...args: Parameters<typeof actual.visibleWidth>) => {
      widthSpy(...args); return actual.visibleWidth(...args);
    },
    truncateToWidth: (...args: Parameters<typeof actual.truncateToWidth>) => {
      truncateSpy(...args); return actual.truncateToWidth(...args);
    },
  };
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
  it("handles official MCP errors without relying on legacy details", () => {
    const context = { state: {}, isError: false, isPartial: false, lastComponent: undefined };
    const result = renderMcpToolResult({ content: [{ type: "text", text: "Permission denied" }],
      details: { server: "exa", tool: "fetch" }, isError: true },
    { expanded: false, isPartial: false }, createTheme(), context);
    expect(result.render(120).join("\n")).toContain("Failed");
    expect(context.state).toMatchObject({ mcpStatus: "error" });
  });

  it.each([null, [1, 2], { answer: 42 }])("renders structured-only official results: %j", value => {
    const result = renderMcpToolResult({ content: [], details: { server: "exa", tool: "fetch" },
      structuredContent: { content: [], structuredContent: value } },
    { expanded: false, isPartial: false }, createTheme(),
    { state: {}, isError: false, isPartial: false, lastComponent: undefined });
    expect(result.render(120).join("\n")).toContain(JSON.stringify(value).replace(/([,:])/g, "$1 "));
  });

  it("keeps the official full-output file discoverable below a long collapsed preview", () => {
    const result = renderMcpToolResult({ content: [{ type: "text", text: "line\n".repeat(200) }],
      details: { server: "exa", tool: "fetch", fullOutputPath: "/tmp/pi-output.txt" } },
    { expanded: false, isPartial: false }, createTheme(),
    { state: {}, isError: false, isPartial: false, lastComponent: undefined });
    expect(result.render(120).join("\n")).toContain("Full output: /tmp/pi-output.txt");
  });
  it("does not replace symbols or recolor successful result text when the prefix changes", () => {
    const color = vi.fn((_name: string, text: string) => text);
    const theme = { ...createTheme(), fg: color } as Theme;
    const body = "Literal symbols: ⏺ ⌕ ⌁";
    const result = renderMcpToolResult({ content: [{ type: "text", text: body }] },
      { expanded: false, isPartial: false }, theme,
      { state: {}, isError: false, isPartial: false, lastComponent: undefined });
    expect(result.render(120)).toEqual([`  └ ${body}`]);
    expect(color).toHaveBeenCalledWith("text", body);
    expect(color.mock.calls.some(([tone]) => tone === "muted")).toBe(false);
  });

  it("reuses unchanged call and preview layouts without segmentation, measurement or styling", () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    try {
      const color = vi.fn((_name: string, text: string) => text);
      const theme = { ...createTheme(), fg: color } as Theme;
      const context = { state: {}, isError: false, isPartial: false, lastComponent: undefined };
      const call = renderMcpToolCall({ query: "中文🙂" }, TOOL_NAMES, theme, context);
      const result = renderMcpToolResult({ content: [{ type: "text", text: "中🙂e\u0301".repeat(2000) }] },
        { expanded: false, isPartial: false }, theme, context);
      const expected = [call.render(120), result.render(120)];
      expect(segment).toHaveBeenCalled();
      expect(widthSpy).toHaveBeenCalled();
      expect(truncateSpy).toHaveBeenCalled();
      segment.mockClear(); widthSpy.mockClear(); truncateSpy.mockClear(); wrapSpy.mockClear(); color.mockClear();
      for (let i = 0; i < 100; i++) {
        expect(call.render(120)).toEqual(expected[0]);
        expect(result.render(120)).toEqual(expected[1]);
      }
      expect(segment).not.toHaveBeenCalled();
      expect(widthSpy).not.toHaveBeenCalled();
      expect(truncateSpy).not.toHaveBeenCalled();
      expect(wrapSpy).not.toHaveBeenCalled();
      expect(color).not.toHaveBeenCalled();
    } finally { segment.mockRestore(); }
  });

  it.each([50, 500, 2000])("does not re-layout unchanged history of %i rows", count => {
    const theme = createTheme();
    const rows = Array.from({ length: count }, (_, index) => {
      const context = { state: {}, isError: false, isPartial: false, lastComponent: undefined };
      return [
        renderMcpToolCall({ query: `row-${index} 中文🙂` }, TOOL_NAMES, theme, context),
        renderMcpToolResult({ content: [{ type: "text", text: `row-${index} 中文🙂e\u0301` }] },
          { expanded: index % 10 === 0, isPartial: false }, theme, context),
      ];
    }).flat();
    for (const row of rows) row.render(120);
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    try {
      widthSpy.mockClear(); truncateSpy.mockClear(); wrapSpy.mockClear();
      for (let frame = 0; frame < 100; frame++) for (const row of rows) row.render(120);
      expect(segment.mock.calls.length).toBe(0);
      expect(widthSpy.mock.calls.length).toBe(0);
      expect(truncateSpy.mock.calls.length).toBe(0);
      expect(wrapSpy.mock.calls.length).toBe(0);
      rows[0]!.invalidate();
      rows[0]!.render(120);
      const changed = [segment.mock.calls.length, widthSpy.mock.calls.length, truncateSpy.mock.calls.length];
      expect(changed[2]).toBeGreaterThan(0);
      for (const row of rows) row.render(120);
      expect([segment.mock.calls.length, widthSpy.mock.calls.length, truncateSpy.mock.calls.length]).toEqual(changed);
    } finally { segment.mockRestore(); }
  });

  it("replaces its single layout on resize and invalidation without discarding prepared JSON", () => {
    const parse = vi.spyOn(JSON, "parse");
    const color = vi.fn((_name: string, text: string) => text);
    try {
      const theme = { ...createTheme(), fg: color } as Theme;
      const result = { content: [{ type: "text", text: '{"message":"中文🙂 long text"}' }] };
      const context = { isError: false, isPartial: false, lastComponent: undefined };
      const component = renderMcpToolResult(result, { expanded: true, isPartial: false }, theme, context);
      const wide = component.render(120);
      expect(component.render(120)).toBe(wide);
      for (let i = 0; i < 10; i++) {
        for (const width of [24, 120, 0, 120]) {
          color.mockClear(); truncateSpy.mockClear();
          const lines = component.render(width);
          if (width === 0) expect(truncateSpy.mock.calls.length).toBe(0);
          else {
            expect(truncateSpy.mock.calls.length).toBeGreaterThan(0);
            expect(color.mock.calls.length).toBeGreaterThan(0);
          }
          color.mockClear(); truncateSpy.mockClear();
          expect(component.render(width)).toBe(lines);
          expect(color.mock.calls.length).toBe(0);
          expect(truncateSpy.mock.calls.length).toBe(0);
        }
      }
      component.invalidate();
      expect(component.render(120)).toEqual(wide);
      expect(color.mock.calls.length).toBeGreaterThan(0);
      expect(parse).toHaveBeenCalledTimes(1);
    } finally { parse.mockRestore(); }
  });

  it("updates a cached call for shared success, failure and warning states", () => {
    const theme = { ...createTheme(), fg: (name: string, text: string) => `<${name}>${text}</${name}>` } as Theme;
    const context = { state: {}, isError: false, isPartial: false, lastComponent: undefined };
    const call = renderMcpToolCall({}, TOOL_NAMES, theme, context);
    expect(call.render(120).join("\n")).toContain("Calling");
    for (const [content, isError, color] of [
      ["done", false, "muted"],
      ["denied", true, "error"],
      ['MCP tool "mcp__MultiFetch__fetch_json" was cancelled.', true, "warning"],
      ['MCP tool "mcp__MultiFetch__fetch_json" failed: [MCP:MultiFetch/fetch_json] Connection timed out after 30000ms', true, "warning"],
      ["denied again", true, "error"],
    ] as const) {
      renderMcpToolResult({ content: [{ type: "text", text: content }] },
        { expanded: false, isPartial: false }, theme, { ...context, isError });
      const title = call.render(120).join("\n");
      expect(title).toContain(`<${color}>⌁</${color}>`);
      expect(title).toContain(isError ? "Call failed for" : "Called");
    }
  });

  it("repaints reused components after argument, result, option and theme updates", () => {
    const theme = createTheme();
    const context = { state: {}, isError: false, isPartial: false, lastComponent: undefined };
    let call = renderMcpToolCall({ query: "old" }, TOOL_NAMES, theme, context);
    expect(call.render(120).join("\n")).toContain("old");
    call = renderMcpToolCall({ query: "new 中文🙂" }, TOOL_NAMES, theme, { ...context, lastComponent: call });
    expect(call.render(120).join("\n")).toContain("new 中文🙂");
    const results = [undefined, { content: [{ type: "text", text: "partial" }] },
      { content: [{ type: "text", text: '{"rows":[1,2,3,4,5,6]}' }] },
      { content: [], details: { structuredContent: { rows: [7, 8] } } }];
    let component;
    for (const result of results) for (const expanded of [false, true, false]) for (const isPartial of [true, false]) {
      const options = { expanded, isPartial };
      component = renderMcpToolResult(result, options, theme, { ...context, lastComponent: component });
      const fresh = renderMcpToolResult(result, options, theme, context);
      for (const width of [24, 120]) expect(component.render(width)).toEqual(fresh.render(width));
    }
    let palette = "dark";
    const mutableTheme = { ...theme, fg: (name: string, text: string) => `<${palette}:${name}>${text}` } as Theme;
    const result = { content: [{ type: "text", text: "hello" }] };
    const options = { expanded: false, isPartial: false };
    component = renderMcpToolResult(result, options, mutableTheme, context);
    const dark = component.render(120);
    palette = "light";
    component.invalidate();
    expect(component.render(120)).not.toEqual(dark);
    expect(component.render(120)).toEqual(renderMcpToolResult(result, options, mutableTheme, context).render(120));
  });

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

  it("keeps success detail bright and preserves image hints without exposing data", () => {
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
      expect(color.mock.calls).toContainEqual(["text", mixed ? "hello" : "Image"]);
      expect(color.mock.calls.filter(([name]) => name === "dim").every(([, text]) => /^\s*[└]?\s*$/u.test(text))).toBe(true);
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
      expect(title).toContain(isError ? "<error>⌁</error>" : "<muted>⌁</muted>");
      expect(title).toContain(isError ? "Call failed for" : "Called");
    }
  });
  it("shows a compact JSON preview without a success summary", () => {
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
      `⌁ Called MultiFetch / fetch_json (${url})`,
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

    expect(stripAnsi(runningCall.render(128)[0] ?? "")).toContain("⌁ Calling MultiFetch / fetch_json");
    expect(stripAnsi(runningResult.render(128)[0] ?? "")).toBe(
      "  └ Running · waiting for response",
    );
    expect(stripAnsi(failedCall.render(128)[0] ?? "")).toContain(
      "⌁ Call failed for MultiFetch / fetch_json",
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
    expect(output).toContain("⌁ Calling MultiFetch / fetch_json");
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
