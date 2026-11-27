import { TestKeybindingsManager } from "../../../test-support/keybindings.js";
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
    { borderColor: text => text, selectList: getSelectListTheme() }, new TestKeybindingsManager(), () => theme,
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
  const plain = lines.map(stripTerminalSequences);

  assert.deepEqual(plain, [
    "╭────────────────────────────────────────────────╮",
    "│ pi v0.84.3 · Codex profile                     │",
    "│                                                │",
    "│ model:     gpt-test high      /model to change │",
    "│ directory: ~/Code/app                          │",
    "╰────────────────────────────────────────────────╯",
    "",
  ]);
  assert.ok(lines[3]!.includes(theme.bold("gpt-test")));
  assert.ok(lines[3]!.includes(theme.fg("dim", "model:     ")));
  assert.ok(!plain.join("\n").includes("fast"));
  assert.ok(!plain.join("\n").includes("weekly"));
  assert.ok(lines.every((line) => visibleWidth(line) <= 56));
});

test("header elides the middle of a long directory and keeps its most specific tail", () => {
  const header = (cwd: string) => new CodexHeader({
    version: "0.84.3", cwd, home: "/Users/pi",
    getModelId: () => "gpt-test", getThinkingLevel: () => "high", getTheme: () => theme,
  });
  const long = header("/Users/pi/Code/t3code/pi-ext/.tmp/wt-codex-ui-polish/prototypes/workspace");
  const directory = (width: number) => stripTerminalSequences(long.render(width)[4]!);
  assert.equal(directory(120), "│ directory: ~/Code/t3code/pi-ext/.tmp/wt-codex-ui-polish/prototypes/workspace │");
  assert.equal(directory(64), "│ directory: ~/…/.tmp/wt-codex-ui-polish/prototypes/workspace │");
  assert.equal(directory(40), `│ ${"directory: ~/…/prototypes/workspace".padEnd(36)} │`);
  assert.equal(stripTerminalSequences(long.render(40)[3]!), `│ ${"model:     gpt-test high".padEnd(36)} │`);
  for (let width = 12; width <= 120; width++) {
    const lines = long.render(width);
    assert.ok(lines.every(line => visibleWidth(line) <= width), `width ${width}`);
    if (width >= 28) assert.match(stripTerminalSequences(lines[4]!), /directory: ~\/(?:…\/)?(?:.+\/)?workspace +│$/u, `width ${width}`);
  }
});

test("header path elision keeps the end of a single long segment by display width", () => {
  const header = (cwd: string) => new CodexHeader({
    version: "0.84.3", cwd, home: "/Users/pi",
    getModelId: () => "gpt-test", getThinkingLevel: () => "high", getTheme: () => theme,
  });
  const cjk = header(`/Users/pi/项目/${"很长的目录名字".repeat(6)}尾`);
  const emoji = header(`/x/${"a🙂".repeat(40)}`);
  for (let width = 12; width <= 120; width++) {
    for (const lines of [cjk.render(width), emoji.render(width)]) {
      assert.ok(lines.every(line => visibleWidth(line) <= width), `width ${width}`);
    }
    if (width >= 28) assert.match(stripTerminalSequences(cjk.render(width)[4]!), /尾 +│$/u, `width ${width}`);
    assert.doesNotMatch(emoji.render(width)[4]!, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u, `width ${width}`);
  }
  assert.equal(stripTerminalSequences(cjk.render(60)[4]!), `│ directory: …${"很长的目录名字".repeat(3).slice(-22)}尾 │`);
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
      ["mcp", "\x1b[38;5;196mMCP 2/2 · 14 tools\x1b[39m"],
      ["other-extension", "Other status"],
    ]),
    getTheme: () => theme,
  });

  const rendered = footer.render(160)[0] ?? "";
  const plain = stripTerminalSequences(rendered).trim();

  assert.equal(
    plain,
    "gpt-test medium · ~/Code/app · git:main · Context 72% left",
  );
  assert.ok(!plain.includes("MCP"));
  assert.ok(!plain.includes("Other status"));
  assert.ok(visibleWidth(rendered) <= 160);
});

test("footer adds a live status row without changing the existing status line", () => {
  const statuses = new Map<string, string>();
  const footer = new CodexFooter({ cwd: "/project", getModelId: () => "fixture", getThinkingLevel: () => "off", getContextUsage: () => undefined, getBranch: () => null, getExtensionStatuses: () => statuses, getTheme: () => theme });
  const before = footer.render(100);
  statuses.set("status", "Status: paused | 123 tokens | 8s");
  const paused = footer.render(100);
  assert.equal(paused[0], before[0]);
  assert.match(stripTerminalSequences(paused[1] ?? ""), /Status: paused/);
  statuses.set("status", "Status: complete | 456 tokens | 9s");
  assert.match(stripTerminalSequences(footer.render(100)[1] ?? ""), /Status: complete/);
  for (const width of [1, 8, 30, 80]) assert.ok(footer.render(width).every(line => visibleWidth(line) <= width));
  statuses.delete("status");
  assert.deepEqual(footer.render(100), before);
});

test("footer uses Codex CLI colors for model and context", () => {
  const truecolorTheme = createTheme("truecolor");
  const footer = new CodexFooter({
    cwd: "/Users/pi/Code/app",
    home: "/Users/pi",
    getModelId: () => "gpt-test",
    getThinkingLevel: () => "max",
    getContextUsage: () => ({ percent: 19 }),
    getBranch: () => "main",
    getExtensionStatuses: () => new Map(),
    getTheme: () => truecolorTheme,
  });

  const rendered = footer.render(120)[0] ?? "";
  assert.ok(rendered.includes("\x1b[38;2;246;226;183mgpt-test max\x1b[39m"));
  assert.ok(rendered.includes("\x1b[38;2;242;181;144mContext 81% left\x1b[39m"));
});

test("footer degrades location before stable session facts on narrow terminals", () => {
  const footer = new CodexFooter({
    cwd: "/Users/pi/Code/t3code/pi-ext",
    home: "/Users/pi",
    getModelId: () => "gpt-5.6-sol",
    getThinkingLevel: () => "max",
    getContextUsage: () => ({ percent: 19 }),
    getBranch: () => "main",
    getExtensionStatuses: () => new Map(),
    getTheme: () => theme,
  });

  const expected = new Map([
    [100, "gpt-5.6-sol max · ~/Code/t3code/pi-ext · git:main · Context 81% left"],
    [65, "gpt-5.6-sol max · pi-ext · main · Context 81% left"],
    [45, "gpt-5.6-sol max · main · Context 81% left"],
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
    assert.equal(stripTerminalSequences(footer.render(34)[0]!).trim(), "gpt off · feature/a-very-long-b…");
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
    ["mcp", "\x1b[31mMCP ready\x1b[39m"],
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
  const expected = [...initial];
  const stripsAfterInitialRender = stripTerminalSequencesMock.mock.calls.length;
  const paintsAfterInitialRender = themePaints;
  initial[0] = `${initial[0]}\x1b[0m`;
  const repeated = footer.render(120);

  assert.deepEqual(repeated, expected);
  assert.notEqual(repeated, initial);
  repeated[0] = `${repeated[0]}\x1b[0m`;
  assert.deepEqual(footer.render(120), expected);
  assert.equal(getContextUsage.mock.calls.length, 3);
  assert.equal(getExtensionStatuses.mock.calls.length, 3);
  assert.equal(stripTerminalSequencesMock.mock.calls.length, stripsAfterInitialRender);
  assert.equal(themePaints, paintsAfterInitialRender);

  statuses.set("mcp", "\x1b[31mMCP reconnecting\x1b[39m");
  assert.deepEqual(footer.render(120), expected);
  assert.equal(stripTerminalSequencesMock.mock.calls.length, stripsAfterInitialRender);
  assert.equal(themePaints, paintsAfterInitialRender);

  statuses.set("status", "Status: updated");
  const changed = stripTerminalSequences(footer.render(120)[1] ?? "");
  assert.match(changed, /Status: updated/u);
  assert.equal(
    stripTerminalSequencesMock.mock.calls.filter(([value]) => value === "Status: updated").length,
    1,
  );

  statuses.delete("status");
  footer.render(120);
  statuses.set("status", "Status: updated");
  footer.render(120);
  assert.equal(
    stripTerminalSequencesMock.mock.calls.filter(([value]) => value === "Status: updated").length,
    2,
  );
});

test("empty composer shows a dim command hint on its bottom padding row only when wide and idle", async () => {
  const editor = new CodexEditor(
    { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI,
    { borderColor: text => text, selectList: getSelectListTheme() }, new TestKeybindingsManager(), () => theme,
  );
  const hinted = (width: number) => `${" ".repeat(width - 16)}/ for commands  `;
  for (const width of [48, 80]) {
    const lines = editor.render(width);
    assert.equal(stripTerminalSequences(lines.at(-1)!), hinted(width));
    assert.ok(lines.at(-1)!.includes(theme.fg("dim", "/ for commands")));
    assert.equal(visibleWidth(lines.at(-1)!), width);
  }
  assert.equal(stripTerminalSequences(editor.render(47).at(-1)!), " ".repeat(47));
  editor.setText("ship it");
  assert.equal(stripTerminalSequences(editor.render(80).at(-1)!), " ".repeat(80));
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
  const keybindings = new TestKeybindingsManager();
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

test("composer keeps theme text colors after prompt and cursor resets", () => {
  let current = createTheme();
  const editor = new CodexEditor(
    { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI,
    { borderColor: (text: string) => text, selectList: {} } as EditorTheme,
    new TestKeybindingsManager(),
    () => current,
  );
  editor.setText("Draft");
  editor.focused = true;
  assert.deepEqual(editor.render(0), []);
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
    const frame = editor.render(40);
    assert.equal(foregroundAt(frame[1]!, "Draft"), `38;5;${color}`);
    assert.ok(frame.every(line => visibleWidth(line) === 40));
    assert.equal(foregroundAt(frame.join("") + "Outside", "Outside"), "default");

  }
});

test("composer uses the supplied host bindings and restores the module manager after failure", async () => {
  const { getKeybindings } = await import("@earendil-works/pi-tui");
  const previous = getKeybindings();
  const keys = new TestKeybindingsManager({ "tui.editor.historyPrevious": "ctrl+p" });
  const editor = new CodexEditor(
    { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI,
    { borderColor: text => text, selectList: getSelectListTheme() }, keys, () => theme,
  );
  editor.addToHistory("Host history");
  editor.handleInput("\x10");
  assert.equal(editor.getText(), "Host history");
  assert.equal(getKeybindings(), previous);
  editor.onSubmit = () => { throw new Error("fixture submit failure"); };
  assert.throws(() => editor.handleInput("\r"), /fixture submit failure/u);
  assert.equal(getKeybindings(), previous);
});

test("header caches rendered output per width, theme, model and thinking level until invalidated", () => {
  let model = "gpt-test";
  let thinking = "high";
  let fgCalls = 0;
  const countingTheme = {
    ...theme,
    fg(name: string, text: string) {
      fgCalls++;
      return theme.fg(name as never, text);
    },
  } as Theme;
  const header = new CodexHeader({
    version: "1.6.1",
    cwd: "/Users/pi/Code/app",
    home: "/Users/pi",
    getModelId: () => model,
    getThinkingLevel: () => thinking,
    getTheme: () => countingTheme,
  });
  const first = header.render(80);
  const afterFirst = fgCalls;
  assert.equal(header.render(80), first);
  assert.equal(fgCalls, afterFirst);
  model = "gpt-next";
  const second = header.render(80);
  assert.notEqual(second, first);
  assert.ok(fgCalls > afterFirst);
  const afterSecond = fgCalls;
  header.invalidate();
  header.render(80);
  assert.ok(fgCalls > afterSecond);
});

test("composer preserves scroll position during completion, avoids wide double-render, and treats newline drafts as non-empty", async () => {
  initTheme("dark", false);
  const { Editor } = await import("@earendil-works/pi-tui");
  const editor = new CodexEditor(
    { terminal: { rows: 10, columns: 40 }, requestRender() {} } as unknown as TUI,
    { borderColor: text => text, selectList: getSelectListTheme() },
    new TestKeybindingsManager(),
    () => theme,
  );
  // Single newline ["", ""] is not an empty draft, and render does not copy lines via getLines()/getText().
  editor.setText("\n");
  const getLinesSpy = vi.spyOn(editor, "getLines");
  const getTextSpy = vi.spyOn(editor, "getText");
  try {
    const newlineLines = editor.render(80).map(stripTerminalSequences);
    assert.ok(!newlineLines.join("\n").includes("Ask Pi to do anything"));
    assert.ok(!newlineLines.at(-1)!.includes("/ for commands"));
    assert.equal(getLinesSpy.mock.calls.length, 0);
    assert.equal(getTextSpy.mock.calls.length, 0);
  } finally {
    getLinesSpy.mockRestore();
    getTextSpy.mockRestore();
  }

  // Re-entrant chained onChange listeners keep native receiver binding and accurate empty-draft state.
  let receiver: unknown;
  const seenChanges: string[] = [];
  editor.onChange = function (this: unknown, value: string) {
    receiver = this;
    seenChanges.push(value);
  };
  const previousChange = editor.onChange;
  editor.onChange = function (this: unknown, value: string) {
    if (value === "") editor.setText("replacement");
    previousChange?.call(this, value);
  };
  editor.setText("seed");
  editor.setText("");
  assert.equal(receiver, editor);
  assert.deepEqual(seenChanges, ["seed", "replacement", ""]);
  const replacedFrame = editor.render(80).map(stripTerminalSequences);
  assert.ok(!replacedFrame.join("\n").includes("Ask Pi to do anything"));
  editor.onChange = undefined;

  // Long wrapped line scrolled up: opening autocomplete must render once and preserve the viewport scroll offset.
  editor.setAutocompleteProvider({
    async getSuggestions() {
      return {
        prefix: "",
        items: [
          { value: "copy", label: "copy", description: "Copy reply" },
          { value: "compact", label: "compact", description: "Compact context" },
        ],
      };
    },
    applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
  });
  editor.setText("0123456789".repeat(14));
  editor.render(12);
  editor.handleInput("\x1b[A");
  editor.handleInput("\x1b[A");
  const beforeScroll = editor.render(12).map(stripTerminalSequences)[1];
  editor.handleInput("\t");
  await vi.waitFor(() => assert.ok(editor.isShowingAutocomplete()));
  const baseRender = vi.spyOn(Editor.prototype, "render");
  try {
    const frame = editor.render(12).map(stripTerminalSequences);
    assert.equal(baseRender.mock.calls.length, 1, "autocomplete frame must only call super.render once");
    assert.equal(frame[1], beforeScroll, "autocomplete must not reset wrapped scroll offset");
  } finally {
    baseRender.mockRestore();
  }
});

test("composer keeps empty-draft placeholder accurate after rebound slash completion and without native isEditorEmpty", async () => {
  initTheme("dark", false);
  const reboundEditor = new CodexEditor(
    { terminal: { rows: 10, columns: 40 }, requestRender() {} } as unknown as TUI,
    { borderColor: text => text, selectList: getSelectListTheme() },
    new TestKeybindingsManager({ "tui.select.confirm": "f2" }),
    () => theme,
  );
  let changeCalls = 0;
  reboundEditor.onChange = () => { changeCalls++; };
  reboundEditor.setAutocompleteProvider({
    async getSuggestions() {
      return {
        prefix: "/co",
        items: [{ value: "clear", label: "clear", description: "Clear draft" }],
      };
    },
    applyCompletion: () => ({ lines: [""], cursorLine: 0, cursorCol: 0 }),
  });
  reboundEditor.setText("/co");
  reboundEditor.handleInput("\t");
  await vi.waitFor(() => assert.ok(reboundEditor.isShowingAutocomplete()));
  const beforeConfirm = changeCalls;
  reboundEditor.handleInput("\x1bOQ");
  assert.equal(changeCalls, beforeConfirm, "rebound slash completion does not emit onChange when clearing draft");
  assert.equal(reboundEditor.getText(), "");
  const emptyFrame = reboundEditor.render(80).map(stripTerminalSequences);
  assert.ok(emptyFrame.join("\n").includes("Ask Pi to do anything"));
  assert.ok(emptyFrame.at(-1)!.includes("/ for commands"));

  // Capability fallback when a host lacks isEditorEmpty().
  Object.defineProperty(reboundEditor, "isEditorEmpty", { configurable: true, value: undefined });
  assert.ok(reboundEditor.render(80).map(stripTerminalSequences).join("\n").includes("Ask Pi to do anything"));
  reboundEditor.setText("hello");
  assert.ok(!reboundEditor.render(80).map(stripTerminalSequences).join("\n").includes("Ask Pi to do anything"));
});
