import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { getSelectListTheme, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  CombinedAutocompleteProvider,
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

test("composer keeps its body and menu separate during native command completion", async () => {
  initTheme("dark", false);
  const editor = new CodexEditor(
    { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI,
    { borderColor: text => text, selectList: getSelectListTheme() }, { matches: () => false } as never, () => theme,
  );
  const submit = vi.fn();
  editor.onSubmit = submit;
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider([
    { name: "copy", description: "Copy reply" }, { name: "compact", description: "Compact context" },
  ], process.cwd()));
  editor.setText("/co"); editor.handleInput("\t");
  await vi.waitFor(() => assert.ok(editor.isShowingAutocomplete()));
  const frame = editor.render(40).map(stripTerminalSequences);
  assert.equal(frame[0], " ".repeat(40));
  assert.equal(frame[2], " ".repeat(40));
  assert.ok(frame[1].includes("›/co"));
  assert.deepEqual(frame.slice(3).map(line => line.trim()), ["→ copy", "compact"]);
  editor.setText("/copy"); editor.handleInput("\r");
  assert.deepEqual(submit.mock.calls, [["/copy"]]);
  assert.equal(editor.onSubmit, submit);
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
      ["other-extension", "Other status"],
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
  assert.ok(!plain.includes("Other status"));
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

test("footer skips equal-width variants before dropping a short project branch", () => {
  for (const cwd of ["/repo/a", "/repo/ab", "/repo/中", "/repo/é"]) {
    const footer = new CodexFooter({ cwd, getModelId: () => "gpt", getThinkingLevel: () => "off",
      getContextUsage: () => undefined, getBranch: () => "feature/a-very-long-branch-name",
      getExtensionStatuses: () => new Map(), getTheme: () => theme });
    assert.equal(stripTerminalSequences(footer.render(34)[0]!).trim(), "gpt off ⋅ feature/a-very-long-b…");
    for (const width of [0, 1, 2, 8, 16, 34, 80]) assert(footer.render(width).every(line => visibleWidth(line) <= width));
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

function foregroundAt(line: string, text: string): string {
  let color = "default";
  for (const match of line.slice(0, line.indexOf(text)).matchAll(/\x1b\[([\d;]*)m/gu)) {
    const code = match[1];
    if (code.startsWith("38;")) color = code;
    else if (["", "0", "39", "22;39"].includes(code)) color = "default";
  }
  return color;
}

test("composer keeps theme text colors after prompt and cursor resets in both projections", () => {
  let current = createTheme();
  const editor = new CodexEditor(
    { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI,
    { borderColor: (text: string) => text, selectList: {} } as EditorTheme,
    { matches: () => false } as never,
    () => current,
  );
  const emptyProjection = editor.renderProjectedLines(40, [" "], [], 0, 0).map(stripTerminalSequences);
  assert.ok(emptyProjection[1].startsWith("›"));
  assert.ok(emptyProjection[1].includes("Ask Pi to do anything"));
  assert.deepEqual(editor.renderProjectedLines(40, [], [], 0, 0).map(stripTerminalSequences), [" ".repeat(40), " ".repeat(40)]);
  editor.setText("Draft");
  editor.focused = true;
  assert.deepEqual(editor.render(0), []);
  assert.deepEqual(editor.renderProjectedLines(0, [" Draft"], [], 0, 0), []);
  for (const width of [1, 2, 4, 32]) {
    const lines = editor.render(width);
    assert.ok(lines.length >= 3);
    assert.ok(lines.every(line => visibleWidth(line) === width));
    assert.equal(stripTerminalSequences(lines[0]), " ".repeat(width));
    assert.equal(stripTerminalSequences(lines.at(-1)!), " ".repeat(width));
  }
  for (const color of [81, 16]) {
    current = createTheme();
    current.getFgAnsi = () => `\x1b[38;5;${color}m`;
    const frames = [
      editor.render(40),
      editor.renderProjectedLines(40, [" Draft", "\x1b[0mWrapped", "\x1b[mReset"],
        ["\x1b[38;5;196mMenu\x1b[22;39m Detail"], 0, 0),
    ];
    for (const [index, frame] of frames.entries()) {
      for (const word of index === 0 ? ["Draft"] : ["Draft", "Wrapped", "Reset", "Detail"]) {
        const line = frame.find(value => value.includes(word));
        assert.ok(line, word);
        assert.equal(foregroundAt(line, word), `38;5;${color}`, word);
      }
      assert.ok(frame.every(line => visibleWidth(line) === 40));
      assert.equal(foregroundAt(frame.join("") + "Outside", "Outside"), "default");
    }
    const menu = frames[1].find(line => line.includes("Menu"))!;
    assert.equal(foregroundAt(menu, "Menu"), "38;5;196");
    assert.ok(stripTerminalSequences(frames[1][1]).startsWith("›Draft"));
    assert.ok(stripTerminalSequences(frames[1][2]).startsWith("Wrapped"));
  }
});
