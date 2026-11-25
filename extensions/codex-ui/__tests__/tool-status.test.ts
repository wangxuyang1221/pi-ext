import { afterEach, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../src/tools.js";

type ToolRenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];

const glyph = (name: string) => ({ bash: "$", read: "@", edit: "~", write: "~" })[name]!;
const colors = { muted: 245, dim: 240, warning: 220, success: 82, error: 196, text: 252, toolOutput: 244, accent: 81 };
function theme(offset = 0): Theme {
  return {
    fg: (name: string, text: string) => `\x1b[38;5;${(colors[name as keyof typeof colors] ?? 250) + offset}m${text}\x1b[39m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    underline: (text: string) => `\x1b[4m${text}\x1b[24m`,
    getBgAnsi: () => "",
    getFgAnsi: () => "",
  } as unknown as Theme;
}
function tools() {
  const registered: ToolDefinition[] = [];
  const handlers = new Map<string, Function[]>();
  registerCodexTools({
    registerTool: (tool: ToolDefinition) => registered.push(tool),
    on: (event: string, handler: Function) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  } as unknown as ExtensionAPI, undefined, { getKeybindings: () => ({ getKeys: () => ["ctrl+o"] }) });
  return {
    registered,
    emit: (event: string, value: unknown, ctx: unknown = { mode: "tui" }) => {
      for (const handler of handlers.get(event) ?? []) handler(value, ctx);
    },
  };
}
function row(tool: ToolDefinition, id = tool.name, initialTheme = theme()) {
  const args = { command: "printf hello", path: "src/目标.ts", content: "hello", edits: [] };
  const ctx = { args, state: {}, toolCallId: id, cwd: "/repo", executionStarted: false,
    durationMs: undefined, outputPad: 0, argsComplete: true, keyText: () => "", keyHint: (_id: string, label: string) => label, isPartial: true, isError: false, expanded: false, showImages: false,
    lastComponent: undefined, invalidate: vi.fn(),
  } as ToolRenderContext;
  let currentTheme = initialTheme;
  let call: Component | undefined;
  let result: Component | undefined;
  let payload: { content: Array<{ type: "text"; text: string }>; details: unknown } | undefined;
  const paint = () => {
    call = tool.renderCall!(args, currentTheme, { ...ctx, lastComponent: call });
    if (payload) result = tool.renderResult!(payload, { expanded: ctx.expanded, isPartial: ctx.isPartial }, currentTheme, { ...ctx, lastComponent: result });
    return [...call.render(120), ...(result?.render(120) ?? [])];
  };
  return {
    ctx, paint,
    setTheme: (next: Theme) => { currentTheme = next; call?.invalidate(); result?.invalidate(); },
    resultContent: (content: Array<{ type: "text"; text: string }>, isError = false) => {
      ctx.isPartial = false; ctx.isError = isError; payload = { content, details: undefined };
      return paint();
    },
    result: (text: string, isError = false, details?: any) => {
      ctx.isPartial = false; ctx.isError = isError; payload = { content: [{ type: "text", text }], details };
      return paint();
    },
  };
}

afterEach(() => vi.useRealTimers());

test("uses one body color per tool without recoloring metadata or unrelated theme roles", () => {
  const roles = { bash: ["toolOutput", "text"], read: ["toolOutput", "text"] } as const;
  for (const tool of tools().registered.filter(tool => ["bash", "read"].includes(tool.name))) {
    const [bodyRole, otherRole] = roles[tool.name as keyof typeof roles];
    const item = row(tool);
    item.ctx.executionStarted = true;
    item.result("hello\nsecond\nthird\nfourth\nfifth\nsixth");
    for (const palette of [theme(), theme(1)]) {
      item.setTheme(palette);
      for (const expanded of [false, true]) {
        item.ctx.expanded = expanded;
        const lines = item.paint();
        const body = lines.slice(1).filter(line => /^(?:\s*[│⎿└]?\s*)(?:\d+\s+)?(?:hello|second|third|fourth|fifth|sixth)/u.test(stripTerminalSequences(line)));
        if (tool.name === "read" && !expanded) expect(lines).toHaveLength(1);
        else expect(body.length).toBeGreaterThan(0);
        expect(body.every(line => line.includes(palette.fg(bodyRole, "").split("m")[0] + "m"))).toBe(true);
        expect(body.join("\n")).not.toContain(palette.fg(otherRole, "").split("m")[0] + "m");
        if (tool.name === "read") expect(lines[0]).toContain(palette.fg("dim", "src/") + palette.fg("accent", "目标.ts"));
      }
    }
  }
});

test("recognizes native abort diagnostics without treating arbitrary error prose as cancellation", () => {
  const palette = theme();
  for (const tool of tools().registered) {
    const item = row(tool);
    item.ctx.executionStarted = true;
    const interrupted = tool.name === "bash" ? "partial output\n\nCommand aborted" : "Operation aborted";
    const output = item.result(interrupted, true);
    expect(output[0]).toContain(palette.fg("warning", glyph(tool.name)));
    item.ctx.expanded = true;
    const expanded = item.paint().map(line => stripTerminalSequences(line)).join("\n");
    if (tool.name === "bash") {
      expect(expanded).toBe("$ Bash(printf hello) · interrupted\n  └ partial output");
      const timedOut = item.result("partial output\n\nCommand timed out after 0.1 seconds", true);
      expect(timedOut[0]).toContain(palette.fg("warning", "$"));
      expect(timedOut[0]).toContain(palette.fg("dim", " · ") + palette.fg("warning", "timed out"));
      expect(timedOut.map(line => stripTerminalSequences(line)).join("\n")).not.toContain("Command timed out");
    } else expect(expanded).toContain("Operation aborted");
    for (const ordinary of ["Operation aborted while parsing a log", "Command aborted\n\nCommand exited with code 1", "request timeout configuration is invalid"]) {
      expect(item.result(ordinary, true)[0]).toContain(palette.fg("error", glyph(tool.name)));
    }
    expect(item.result(interrupted, false)[0]).toContain(palette.fg("muted", glyph(tool.name)));
  }
});

test("keeps mixed group colors independent and reuses captured output across paints and theme changes", () => {
  for (const name of ["read", "bash"]) for (const count of [1, 3, 20]) for (const length of [3, 1800]) {
    const h = tools();
    const tool = h.registered.find(tool => tool.name === name)!;
    const items = Array.from({ length: count }, (_, index) => row(tool, `call-${index}`));
    h.emit("message_start", { message: { role: "assistant", content: items.map(item => ({ type: "toolCall", id: item.ctx.toolCallId, name })) } });
    for (const item of items) { item.ctx.executionStarted = true; item.paint(); }
    const reads = vi.fn();
    for (let index = items.length - 1; index >= 0; index--) {
      const text = index === 1 ? "Permission denied" : index === 2 ? name === "bash" ? "partial output\n\nCommand aborted" : "Operation aborted" : "source line\n".repeat(length);
      const content = [{ type: "text" as const, get text() { reads(); return text; } }];
      const isError = index === 1 || index === 2;
      h.emit("tool_execution_end", { toolName: name, toolCallId: items[index]!.ctx.toolCallId, result: { content }, isError });
      items[index]!.resultContent(content, isError);
    }
    for (const palette of [theme(), theme(1)]) {
      items[0]!.setTheme(palette);
      const lines = items[0]!.paint();
      const markers = lines.filter(line => stripTerminalSequences(line).trimStart().startsWith(glyph(name)));
      expect(markers).toHaveLength(count);
      for (let index = 0; index < count; index++) expect(markers[index]).toContain(palette.fg(index === 1 ? "error" : index === 2 ? "warning" : "muted", glyph(name)));
      const baseline = reads.mock.calls.length;
      for (let paint = 0; paint < 10; paint++) expect(items[0]!.paint()).toEqual(lines);
      expect(reads.mock.calls.length).toBe(baseline);
    }
    h.emit("session_shutdown", {});
  }
});

test("does not reread a Bash failure to recolor an unchanged row", () => {
  const bash = tools().registered.find(tool => tool.name === "bash")!;
  const item = row(bash);
  item.ctx.executionStarted = true;
  const read = vi.fn(() => "partial output\n\nCommand aborted");
  item.resultContent([{ type: "text", get text() { return read(); } }], true);
  const baseline = read.mock.calls.length;
  for (const palette of [theme(), theme(1)]) {
    item.setTheme(palette);
    for (let paint = 0; paint < 10; paint++) expect(item.paint()[0]).toContain(palette.fg("warning", "$"));
  }
  expect(read.mock.calls.length).toBe(baseline);
});

test("preserves native abort and Bash timeout diagnostics through serialization", async () => {
  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  const cwd = await mkdtemp(join(process.cwd(), ".tmp/tool-status-native-"));
  try {
    const h = tools();
    const context = { cwd, sessionManager: { getSessionId: () => "fixture", getSessionFile: () => undefined } } as never;
    for (const tool of h.registered) {
      const controller = new AbortController();
      controller.abort();
      const args = { path: join(cwd, "unused.txt"), content: "unused", edits: [{ oldText: "old", newText: "new" }], command: "printf unused" };
      const error = await tool.execute("abort", args, controller.signal, undefined, context).catch(error => error);
      expect(error).toBeInstanceOf(Error);
      const content = JSON.parse(JSON.stringify([{ type: "text", text: error.message }]));
      expect(row(tool).resultContent(content, true)[0], `${tool.name}: ${error.message}`).toContain(theme().fg("warning", glyph(tool.name)));
    }
    const bash = h.registered.find(tool => tool.name === "bash")!;
    const error = await bash.execute("timeout", { command: "printf 'partial output\\n'; sleep 2", timeout: 0.05 }, undefined, undefined, context).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("partial output");
    expect(error.message).toContain("Command timed out after 0.05 seconds");
    expect(row(bash).result(error.message, true)[0]).toContain(theme().fg("warning", "$"));
    h.emit("session_shutdown", {});
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("uses static accent markers from argument generation through execution without refresh timers", () => {
  vi.useFakeTimers();
  const palette = theme();
  for (const tool of tools().registered) {
    const item = row(tool);
    for (const argsComplete of [false, true]) {
      item.ctx.argsComplete = argsComplete;
      const pending = item.paint();
      if (tool.name === "bash") expect(pending).toEqual([]);
      else expect(pending[0]).toContain(palette.fg("accent", glyph(tool.name)) + " ");
      vi.advanceTimersByTime(30_000);
      expect(item.paint()).toEqual(pending);
    }
    item.ctx.executionStarted = true;
    expect(item.paint()[0]).toContain(palette.fg("accent", glyph(tool.name)) + " ");
    expect(item.result("hello")[0]).toContain(palette.fg("muted", glyph(tool.name)) + " ");
    expect(item.result("Permission denied", true)[0]).toContain(palette.fg("error", glyph(tool.name)) + " ");
    expect(visibleWidth(glyph(tool.name))).toBe(1);
    vi.advanceTimersByTime(30_000);
    expect(item.ctx.invalidate).not.toHaveBeenCalled();
  }
  expect(vi.getTimerCount()).toBe(0);
});
