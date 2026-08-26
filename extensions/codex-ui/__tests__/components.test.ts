import assert from "node:assert/strict";
import { test } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  stripTerminalSequences,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

import { CodexEditor, CodexFooter, CodexHeader } from "../src/components.js";

function createTheme(): Theme {
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
    getColorMode: () => "256color",
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

test("footer keeps extension statuses and omits unavailable quota data", () => {
  const footer = new CodexFooter({
    cwd: "/Users/pi/Code/app",
    home: "/Users/pi",
    getModelId: () => "gpt-test",
    getThinkingLevel: () => "medium",
    getContextUsage: () => ({ percent: 28 }),
    getExtensionStatuses: () => new Map([
      ["mcp", "\x1b[38;5;196mMCP 2/2 · 14 tools\x1b[39m"],
      ["permissions", "· full access"],
      ["health", "● active"],
      ["empty", "\x1b[38;5;196m   \x1b[39m"],
    ]),
    getTheme: () => theme,
  });

  const wide = stripTerminalSequences(footer.render(160)[0] ?? "");
  const narrow = stripTerminalSequences(footer.render(30)[0] ?? "");

  assert.match(wide, /gpt-test medium/u);
  assert.match(wide, /~\/Code\/app/u);
  assert.match(wide, /Context 72% left/u);
  assert.match(wide, /MCP 2\/2 · 14 tools · full access · ● active/u);
  assert.ok(!wide.includes("· ·"));
  assert.ok(!wide.includes("weekly"));
  assert.ok(!wide.includes("fast"));
  assert.ok(narrow.includes("MCP") || narrow.includes("full access"));
  assert.ok(visibleWidth(footer.render(30)[0] ?? "") <= 30);

  const rendered = footer.render(160)[0] ?? "";
  assert.ok(!rendered.includes("\x1b[38;5;196m"));
  assert.ok(rendered.includes("\x1b[38;5;244mMCP 2/2 · 14 tools\x1b[39m"));
  assert.ok(rendered.includes("\x1b[38;5;244mfull access\x1b[39m"));
  assert.ok(rendered.includes("\x1b[38;5;244m● active\x1b[39m"));
  assert.ok(stripTerminalSequences(rendered).trimEnd().endsWith("● active"));
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
