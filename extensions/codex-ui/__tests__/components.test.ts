import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  stripTerminalSequences,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

const { stripTerminalSequencesMock } = vi.hoisted(() => ({
  stripTerminalSequencesMock: vi.fn(),
}));

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return {
    ...actual,
    stripTerminalSequences(...args: Parameters<typeof actual.stripTerminalSequences>) {
      stripTerminalSequencesMock(...args);
      return actual.stripTerminalSequences(...args);
    },
  };
});

import { CodexEditor, CodexFooter, CodexHeader } from "../src/components.js";

function createTheme(colorMode: "truecolor" | "256color" = "256color"): Theme {
  const foreground = (code: number, text: string) => `\x1b[38;5;${code}m${text}\x1b[39m`;
  return {
    name: "codex-pi",
    fg: (name: string, text: string) => foreground(name === "dim" ? 244 : 81, text),
    bg: (name: string, text: string) => {
      const code = name === "toolErrorBg" ? 52 : name === "toolSuccessBg" ? 22 : 238;
      return `\x1b[48;5;${code}m${text}\x1b[49m`;
    },
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
    getFgAnsi: () => "\x1b[38;5;81m",
    getBgAnsi: () => "\x1b[48;5;238m",
    getColorMode: () => colorMode,
  } as unknown as Theme;
}

const theme = createTheme();

test("header uses Pi branding and live session facts without fabricated badges", () => {
  const header = new CodexHeader({
    version: "0.84.3",
    cwd: "/Users/pi/Code/app",
    home: "/Users/pi",
    getModelId: () => "gpt-test",
    getThinkingLevel: () => "high",
    getTheme: () => theme,
  });

  const lines = header.render(56);
  const plain = lines.map(stripTerminalSequences).join("\n");

  assert.match(plain, /pi v0\.84\.3 · Codex profile/u);
  assert.match(plain, /gpt-test · high/u);
  assert.match(plain, /~\/Code\/app/u);
  assert.ok(!plain.includes("fast"));
  assert.ok(!plain.includes("weekly"));
  assert.ok(lines.every((line) => visibleWidth(line) <= 56));
});

test("footer renders the accepted stable status flow and ignores transient statuses", () => {
  const footer = new CodexFooter({
    cwd: "/Users/pi/Code/app",
    home: "/Users/pi",
    getModelId: () => "gpt-test",
    getThinkingLevel: () => "medium",
    getContextUsage: () => ({ percent: 28 }),
    getBranch: () => "main",
    getExtensionStatuses: () => new Map([
      ["pi-openai-fast-mode", "fast"],
      ["mcp", "\x1b[38;5;196mMCP 2/2 · 14 tools\x1b[39m"],
      ["permissions", "· full access"],
      ["codex-compact", "Compacting context with Codex…"],
      ["codex-ui-lowpower", "Low power"],
    ]),
    getTheme: () => theme,
  });

  const rendered = footer.render(160)[0] ?? "";
  const plain = stripTerminalSequences(rendered).trim();

  assert.equal(
    plain,
    "gpt-test medium ⋅ fast ⋅ ~/Code/app ⋅ git:main ⋅ Context 72% left ⋅ full access",
  );
  assert.ok(!plain.includes("MCP"));
  assert.ok(!plain.includes("Compacting"));
  assert.ok(!plain.includes("Low power"));
  assert.ok(!plain.includes("·"));
  assert.ok(visibleWidth(rendered) <= 160);
});

test("footer adds a live goal row without changing the existing status line", () => {
  const statuses = new Map<string, string>();
  const footer = new CodexFooter({ cwd: "/project", getModelId: () => "fixture", getThinkingLevel: () => "off", getContextUsage: () => undefined, getBranch: () => null, getExtensionStatuses: () => statuses, getTheme: () => theme });
  const before = footer.render(100);
  statuses.set("goal", "Goal: paused | 123 tokens | 8s");
  const paused = footer.render(100);
  assert.equal(paused[0], before[0]);
  assert.match(stripTerminalSequences(paused[1] ?? ""), /Goal: paused/);
  statuses.set("goal", "Goal: complete | 456 tokens | 9s");
  assert.match(stripTerminalSequences(footer.render(100)[1] ?? ""), /Goal: complete/);
  for (const width of [1, 8, 30, 80]) assert.ok(footer.render(width).every(line => visibleWidth(line) <= width));
  statuses.delete("goal");
  assert.deepEqual(footer.render(100), before);
});

test("footer uses Codex CLI colors for model, context, and Fast Mode", () => {
  const truecolorTheme = createTheme("truecolor");
  const footer = new CodexFooter({
    cwd: "/Users/pi/Code/app",
    home: "/Users/pi",
    getModelId: () => "gpt-test",
    getThinkingLevel: () => "max",
    getContextUsage: () => ({ percent: 19 }),
    getBranch: () => "main",
    getExtensionStatuses: () => new Map([
      ["pi-openai-fast-mode", "fast"],
      ["permissions", "· full access"],
    ]),
    getTheme: () => truecolorTheme,
  });

  const rendered = footer.render(120)[0] ?? "";
  assert.ok(rendered.includes("\x1b[38;2;246;226;183mgpt-test max\x1b[39m"));
  assert.ok(rendered.includes("\x1b[38;2;242;181;144mContext 81% left\x1b[39m"));
  assert.ok(rendered.includes("\x1b[38;2;200;169;238mfast\x1b[39m"));
});

test("footer degrades location before stable session facts on narrow terminals", () => {
  const footer = new CodexFooter({
    cwd: "/Users/pi/Code/t3code/pi-ext",
    home: "/Users/pi",
    getModelId: () => "gpt-5.6-sol",
    getThinkingLevel: () => "max",
    getContextUsage: () => ({ percent: 19 }),
    getBranch: () => "main",
    getExtensionStatuses: () => new Map([
      ["pi-openai-fast-mode", "fast"],
      ["permissions", "· full access"],
    ]),
    getTheme: () => theme,
  });

  const expected = new Map([
    [100, "gpt-5.6-sol max ⋅ fast ⋅ ~/Code/t3code/pi-ext ⋅ git:main ⋅ Context 81% left ⋅ full access"],
    [72, "gpt-5.6-sol max ⋅ fast ⋅ git:main ⋅ Context 81% left ⋅ full access"],
    [52, "gpt-5.6-sol max ⋅ fast ⋅ 81% left ⋅ full access"],
  ]);
  for (const [width, line] of expected) {
    const rendered = footer.render(width)[0] ?? "";
    assert.equal(stripTerminalSequences(rendered).trim(), line);
    assert.ok(visibleWidth(rendered) <= width);
  }
});

test("footer caches only allowlisted statuses and painted output", () => {
  let themePaints = 0;
  const countingTheme = {
    ...theme,
    fg(name: string, text: string) {
      themePaints += 1;
      return theme.fg(name as never, text);
    },
  } as Theme;
  const statuses = new Map([
    ["pi-openai-fast-mode", "fast"],
    ["mcp", "\x1b[31mMCP ready\x1b[39m"],
    ["permissions", "· full access"],
  ]);
  const getContextUsage = vi.fn(() => ({ percent: 28 }));
  const getExtensionStatuses = vi.fn(() => statuses);
  const footer = new CodexFooter({
    cwd: "/Users/pi/Code/app",
    home: "/Users/pi",
    getModelId: () => "gpt-test",
    getThinkingLevel: () => "medium",
    getContextUsage,
    getBranch: () => "main",
    getExtensionStatuses,
    getTheme: () => countingTheme,
  });

  stripTerminalSequencesMock.mockClear();
  const initial = footer.render(120);
  const stripsAfterInitialRender = stripTerminalSequencesMock.mock.calls.length;
  const paintsAfterInitialRender = themePaints;
  const repeated = footer.render(120);

  assert.deepEqual(repeated, initial);
  assert.equal(getContextUsage.mock.calls.length, 2);
  assert.equal(getExtensionStatuses.mock.calls.length, 2);
  assert.equal(stripTerminalSequencesMock.mock.calls.length, stripsAfterInitialRender);
  assert.equal(themePaints, paintsAfterInitialRender);

  statuses.set("mcp", "\x1b[31mMCP reconnecting\x1b[39m");
  assert.deepEqual(footer.render(120), initial);
  assert.equal(stripTerminalSequencesMock.mock.calls.length, stripsAfterInitialRender);
  assert.equal(themePaints, paintsAfterInitialRender);

  statuses.set("permissions", "⋅ sandboxed");
  const changed = stripTerminalSequences(footer.render(120)[0] ?? "");
  assert.match(changed, /sandboxed/u);
  assert.equal(
    stripTerminalSequencesMock.mock.calls.filter(([value]) => value === "⋅ sandboxed").length,
    1,
  );

  statuses.delete("permissions");
  footer.render(120);
  statuses.set("permissions", "⋅ sandboxed");
  footer.render(120);
  assert.equal(
    stripTerminalSequencesMock.mock.calls.filter(([value]) => value === "⋅ sandboxed").length,
    2,
  );
});

test("editor paints a flat composer while preserving the cursor marker", () => {
  const editorTheme = {
    borderColor: (text: string) => `\x1b[38;5;240m${text}\x1b[39m`,
    selectList: {},
  } as EditorTheme;
  const tui = {
    terminal: { rows: 40, columns: 80 },
    requestRender() {},
  } as unknown as TUI;
  const keybindings = { matches: () => false };
  const editor = new CodexEditor(
    tui,
    editorTheme,
    keybindings as never,
    () => theme,
  );
  editor.focused = true;

  const emptyLines = editor.render(40);
  const emptyPlain = emptyLines.map(stripTerminalSequences);

  assert.ok(emptyLines.every((line) => visibleWidth(line) === 40));
  assert.equal(emptyPlain[0], " ".repeat(40));
  assert.equal(emptyPlain.at(-1), " ".repeat(40));
  assert.ok(emptyPlain[1]?.includes("›"));
  assert.ok(emptyPlain[1]?.includes("Ask Pi to do anything"));
  assert.ok(emptyLines[1]?.includes(CURSOR_MARKER));
  assert.ok(emptyLines.every((line) => line.endsWith("\x1b[49m")));

  editor.setText("ship it");
  const filled = editor.render(40).map(stripTerminalSequences).join("\n");
  assert.ok(filled.includes("›ship it"));
  assert.ok(!filled.includes("Ask Pi to do anything"));
});
