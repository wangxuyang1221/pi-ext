import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";
import { initTheme, ToolExecutionComponent, type ExtensionAPI, type KeybindingsManager, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, Text, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

import claudeUiExtension, { CLAUDE_THEME_NAME } from "../src/index.js";
import { ClaudeEditor, ClaudeFooter, ClaudeHeader } from "../src/components.js";
import { Working, WorkingActivity, workingFrameKey } from "../src/working.js";
import { renderClaudeReadGroup as renderReadGroup } from "../src/claude-tools.js";
import { renderClaudeBashGroup as renderBashGroup } from "../src/claude-tools.js";
import { ReadGroups } from "../../../shared/ui/read-groups.js";
import { BashGroups } from "../../../shared/ui/bash-groups.js";
import { ToolRenderCache } from "../../../shared/ui/render-cache.js";
import { registerClaudeGenericToolRenderer } from "../src/claude-tools.js";
import { registerClaudeTools } from "../src/tools.js";

const themeModule = await import(
  pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")).href
) as { loadThemeFromPath: (path: string, mode?: "truecolor" | "256color") => Theme; setThemeInstance: (t: Theme) => void };

const schemaModule = await import(
  pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.js")).href
) as { validateThemeJson: (label: string, json: unknown) => unknown };

function loadClaudeTheme(mode: "truecolor" | "256color" = "truecolor"): Theme {
  return themeModule.loadThemeFromPath(resolve("extensions/claude-code-ui/themes/claude-code.json"), mode);
}

function createFakeKeybindings(map: Record<string, string[]> = {}): KeybindingsManager {
  return {
    getKeys: (id: string) => map[id] ?? [],
    matches: (data: string, id: string) => data === "\x7f" && id === "tui.editor.deleteCharBackward",
  } as unknown as KeybindingsManager;
}

function createFakeTui(): TUI {
  return {
    requestRender() {},
    terminal: { columns: 112, rows: 34 },
  } as unknown as TUI;
}

function createEditorTheme(): EditorTheme {
  return {
    borderColor: (text: string) => text,
    selectList: {
      selectedPrefix: (text: string) => text,
      selectedText: (text: string) => text,
      description: (text: string) => text,
      scrollInfo: (text: string) => text,
      noMatch: (text: string) => text,
    },
  };
}

test("package publishes its own valid claude-code theme", async () => {
  const raw = JSON.parse(await readFile(new URL("../themes/claude-code.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  schemaModule.validateThemeJson("claude-code", raw);
  assert.equal(raw.name, CLAUDE_THEME_NAME);
  assert.equal(raw.appearance, "dark");
  assert.ok(pkg.pi.themes.includes("./themes/claude-code.json"));
  assert.ok(pkg.files.includes("themes/claude-code.json"));

  const loaded = loadClaudeTheme("truecolor");
  assert.equal(loaded.name, CLAUDE_THEME_NAME);
  assert.equal(loaded.appearance, "dark");
  assert.notEqual(loaded.getFgAnsi("text"), loaded.getFgAnsi("dim"));
  assert.notEqual(loaded.getBgAnsi("toolSuccessBg"), loaded.getBgAnsi("toolErrorBg"));
});

test("ClaudeHeader renders 2-column Clawd welcome box on wide widths and 1-column on narrow widths", () => {
  const theme = loadClaudeTheme();
  const header = new ClaudeHeader({
    version: "1.6.1",
    cwd: "/Users/demo/project",
    home: "/Users/demo",
    userName: "demo",
    getModelId: () => "gpt-5.4",
    getThinkingLevel: () => "high",
    getBranch: () => "main",
    getKeybindings: () => createFakeKeybindings({
      "app.tools.expand": ["ctrl+o"],
      "app.thinking.cycle": ["shift+tab"],
    }),
    getTheme: () => theme,
  });

  const wide = header.render(112).map(stripTerminalSequences).join("\n");
  assert.match(wide, /Claude Code v1\.6\.1/);
  assert.match(wide, /Welcome back demo!/);
  assert.match(wide, /▐▛███▜▌/);
  assert.match(wide, /Tips for getting started/);
  assert.match(wide, /shift\+tab/);
  assert.match(wide, /ctrl\+o/);
  assert.match(wide, / main/);

  const boundaryTwoCol = header.render(78).map(stripTerminalSequences).join("\n");
  assert.match(boundaryTwoCol, /Claude Code v1\.6\.1/);
  assert.match(boundaryTwoCol, /Tips for getting started/);

  const boundarySingleCol = header.render(77).map(stripTerminalSequences).join("\n");
  assert.match(boundarySingleCol, /Claude Code v1\.6\.1/);
  assert.match(boundarySingleCol, /▐▛███▜▌/);
  assert.doesNotMatch(boundarySingleCol, /Tips for getting started/);

  const narrow = header.render(72).map(stripTerminalSequences).join("\n");
  assert.match(narrow, /Claude Code v1\.6\.1/);
  assert.match(narrow, /▐▛███▜▌/);
  assert.doesNotMatch(narrow, /Tips for getting started/);
});

test("ClaudeEditor renders transparent hairlines and toggles bash mode on leading !", () => {
  const theme = loadClaudeTheme();
  const bashEvents: boolean[] = [];
  const editor = new ClaudeEditor(
    createFakeTui(),
    createEditorTheme(),
    createFakeKeybindings(),
    () => theme,
    undefined,
    (bashMode) => bashEvents.push(bashMode),
  );

  const initial = editor.render(80);
  const plainInitial = initial.map(stripTerminalSequences);
  assert.match(plainInitial[0]!, /^ ─+ $/);
  assert.match(plainInitial[1]!, /❯/);
  assert.match(plainInitial[1]!, /Try "refactor retry backoff"/);
  assert.match(plainInitial.at(-1)!, /^ ─+ $/);
  // Transparent composer body must not inject selectedBg ANSI sequence.
  assert.ok(!initial[1]!.includes(theme.getBgAnsi("selectedBg")));

  editor.handleInput("!");
  assert.equal(editor.isBashDraft(), true);
  assert.deepEqual(bashEvents, [true]);
  const bashRendered = editor.render(80);
  // Pink bash-mode hairline color (#ea8ab8 -> 234;138;184).
  assert.ok(bashRendered[0]!.includes("38;2;234;138;184m"));
  assert.match(stripTerminalSequences(bashRendered[1]!), /❯ !/);

  editor.handleInput("\x7f");
  assert.equal(editor.isBashDraft(), false);
  assert.deepEqual(bashEvents, [true, false]);

  // S6: Leading whitespace + ! and programmatic setText("!pwd") both activate bash mode.
  editor.setText("  !pwd");
  assert.equal(editor.isBashDraft(), true);
  assert.deepEqual(bashEvents, [true, false, true]);
  editor.setText("");
  assert.equal(editor.isBashDraft(), false);
  assert.deepEqual(bashEvents, [true, false, true, false]);

  // S1: Prompt column reservation prevents tail character clipping at narrow widths (both paddingX=1 and paddingX=0),
  // and ultra-narrow widths (<= 6) preserve the host line & cursor instead of clipping them.
  editor.setText("0123456789ABCDEFGZ");
  for (const padX of [1, 0]) {
    editor.setPaddingX(padX);
    const narrowRendered = editor.render(20).map(stripTerminalSequences).join("\n");
    assert.ok(narrowRendered.includes(" ❯ 0123456789"), `paddingX=${padX}: expected separate prompt + prefix:\n${narrowRendered}`);
    assert.ok(narrowRendered.includes("Z"), `paddingX=${padX}: expected tail char Z to stay visible:\n${narrowRendered}`);
  }
  editor.setPaddingX(0);
  editor.setText("abcde");
  const tinyRendered = editor.render(6);
  assert.ok(stripTerminalSequences(tinyRendered[1]!).includes("abcde"), `Expected abcde intact at width 6: ${tinyRendered[1]}`);
  assert.ok(tinyRendered[1]!.includes("\x1b_pi:fc\x07") || tinyRendered[1]!.includes("\x1b_pi:c\x07"), "Expected cursor marker intact at width 6");

  // S8: Mouse clicks adjust for reserved prompt columns on both first line and wrapped lines.
  editor.setPaddingX(1);
  editor.setText("abcdef");
  editor.render(20);
  // Row 1 is ` ❯ abcdef...`: 'a' is at screen x=3 (col 0=' ', 1='❯', 2=paddingX ' ', 3='a').
  editor.handleMouse({ type: "click", button: "left", x: 3, y: 1, width: 20, height: 3 } as never);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  editor.handleMouse({ type: "click", button: "left", x: 5, y: 1, width: 20, height: 3 } as never);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });

  // Wrapped line click: width 12, paddingX=1 -> reserved=2, inner=10, content width=8.
  editor.setText("01234567abcdefgh");
  editor.render(12);
  // Row 2 starts with `   abcdefgh`: 'a' (index 8) is at screen x=3.
  editor.handleMouse({ type: "click", button: "left", x: 3, y: 2, width: 12, height: 4 } as never);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 8 });
});

test("ClaudeFooter shows Shift+Tab thinking status, bash mode, branch, context, and live rate", () => {
  const theme = loadClaudeTheme();
  let bashMode = false;
  let thinking = "high";
  const footer = new ClaudeFooter({
    cwd: "/Users/demo/project",
    home: "/Users/demo",
    getModelId: () => "gpt-5.4",
    getThinkingLevel: () => thinking,
    getContextUsage: () => ({ percent: 12 }),
    getBranch: () => "main",
    getExtensionStatuses: () => new Map(),
    getRate: () => "≈140 t/s",
    isBashMode: () => bashMode,
    getKeybindings: () => createFakeKeybindings({ "app.thinking.cycle": ["shift+tab"] }),
    getTheme: () => theme,
  });

  const normal = stripTerminalSequences(footer.render(112).join("\n"));
  assert.match(normal, /⏵⏵ thinking: high \(shift\+tab to cycle\)/);
  assert.match(normal, /gpt-5\.4/);
  assert.match(normal, / main/);
  assert.match(normal, /Context left: 88%/);
  assert.match(normal, /≈140 t\/s/);

  bashMode = true;
  const bash = stripTerminalSequences(footer.render(112).join("\n"));
  assert.match(bash, /! for bash mode/);

  bashMode = false;
  thinking = "off";
  const off = stripTerminalSequences(footer.render(112).join("\n"));
  assert.match(off, /thinking off/);
});

test("Claude Working shows terracotta shimmer spinner, elapsed time, and streamed token count", () => {
  const theme = loadClaudeTheme();
  let now = 1000;
  const activity = new WorkingActivity(() => now);
  activity.start();
  activity.recordStreamDelta(400);
  now = 4200;

  const working = new Working(activity, () => theme);
  const rendered = working.render(90);
  assert.equal(rendered.length, 1);
  const plain = stripTerminalSequences(rendered[0]!);
  assert.match(plain, /esc to interrupt/);
  assert.match(plain, /3s/);
  assert.match(plain, /↓ 100 tokens/);
  assert.notEqual(
    workingFrameKey(3200, 100),
    workingFrameKey(3200, 120),
  );
});

test("Claude tool renderers format Read, Bash, Update/Write, and generic Search/Glob/List", () => {
  initTheme("dark", false);
  const claudeTheme = loadClaudeTheme();
  const cache = new ToolRenderCache();

  // Read single & grouped
  const readGroups = new ReadGroups(cache);
  const readCtx = {
    toolCallId: "r1",
    args: { path: "src/retry.ts" },
    cwd: "/repo",
    state: {},
    expanded: false,
    isError: false,
    executionStarted: true,
    argsComplete: true,
  } as never;
  const rView = readGroups.bind(readCtx);
  rView.updateCall(readCtx);
  rView.updateResult({ content: [{ type: "text", text: "line 1\nline 2\n" }] }, false, false);
  const singleRead = renderReadGroup(rView.current(), false, claudeTheme, 90, "ctrl+o").map(stripTerminalSequences).join("\n");
  assert.match(singleRead, /● Read\(src\/retry\.ts\)/);
  assert.match(singleRead, /⎿  Read 2 lines \(ctrl\+o to expand\)/);

  // Bash failure
  const bashGroups = new BashGroups(cache);
  const bashCtx = {
    toolCallId: "b1",
    args: { command: "pnpm test" },
    cwd: "/repo",
    state: {},
    expanded: false,
    isError: true,
    executionStarted: true,
    argsComplete: true,
  } as never;
  const bMember = bashGroups.bind(bashCtx);
  bashGroups.updateCall(bMember, bashCtx, { render: () => [], invalidate() {} });
  bashGroups.updateResult(bMember, {
    content: [{ type: "text", text: "FAIL retry.test.ts\n\nCommand exited with code 1" }],
  });
  const bashOut = renderBashGroup(bMember.group, false, claudeTheme, 90, "ctrl+o").map(stripTerminalSequences).join("\n");
  assert.match(bashOut, /● Bash\(pnpm test\)/);
  assert.match(bashOut, /⎿  FAIL retry\.test\.ts/);
  assert.match(bashOut, /Error: Exit code 1/);

  // Edit -> Update(path) + Added/removed summary
  const tools = new Map<string, ToolRenderers>();
  const mockPi = {
    on() {},
    registerTool(tool: { name: string } & ToolRenderers) { tools.set(tool.name, tool); },
  } as unknown as ExtensionAPI;
  registerClaudeTools(mockPi);
  const editRenderer = tools.get("edit")!;
  const editState = {};
  const callComp = editRenderer.renderCall!(
    { path: "src/retry.ts" },
    claudeTheme,
    { state: editState, cwd: "/repo", executionStarted: true, argsComplete: true, outputPad: 0 } as never,
  );
  const resComp = editRenderer.renderResult!(
    {
      content: [{ type: "text", text: "ok" }],
      details: { diff: "-1 old\n+1 newA\n+2 newB\n" },
    },
    { expanded: false, isPartial: false },
    claudeTheme,
    { state: editState, args: { path: "src/retry.ts" }, cwd: "/repo", isError: false, outputPad: 0 } as never,
  );
  const editHeading = stripTerminalSequences(callComp.render(90).join("\n"));
  const editBody = stripTerminalSequences(resComp.render(90).join("\n"));
  assert.match(editHeading, /● Update\(src\/retry\.ts\)/);
  assert.match(editBody, /⎿  Added 2 lines, removed 1 line/);

  // S7: Single Read firstLineExceedsLimit shows host notice even when lines is empty; grouped Read shows failure reason.
  const hugeCtx = {
    toolCallId: "r-huge",
    args: { path: "big.min.js" },
    cwd: "/repo",
    state: {},
    expanded: false,
    isError: false,
    executionStarted: true,
    argsComplete: true,
  } as never;
  const hugeView = readGroups.bind(hugeCtx);
  hugeView.updateCall(hugeCtx);
  hugeView.updateResult({
    content: [{ type: "text", text: "[Line 1 is 80KB, exceeds 50KB limit. Use bash: sed -n '1p' big.min.js]" }],
    details: { truncation: { truncated: true, firstLineExceedsLimit: true, outputLines: 0 } },
  }, false, false);
  const hugeOut = renderReadGroup(hugeView.current(), false, claudeTheme, 100, "ctrl+o").map(stripTerminalSequences).join("\n");
  assert.match(hugeOut, /Use bash: sed -n/);

  const grpRead = new ReadGroups(cache);
  grpRead.discover({
    role: "assistant",
    content: [
      { type: "toolCall", id: "gr1", name: "read", arguments: { path: "ok.ts" } },
      { type: "toolCall", id: "gr2", name: "read", arguments: { path: "missing.ts" } },
    ],
  }, true);
  grpRead.start("gr1", { path: "ok.ts" });
  grpRead.result("gr1", { content: [{ type: "text", text: "ok" }] }, "execution", false);
  grpRead.start("gr2", { path: "missing.ts" });
  grpRead.result("gr2", { content: [{ type: "text", text: "ENOENT: no such file or directory" }] }, "execution", true);
  const gr1Ctx = { toolCallId: "gr1", args: { path: "ok.ts" }, cwd: "/repo", state: {}, expanded: false, isError: false, executionStarted: true, argsComplete: true } as never;
  const gr2Ctx = { toolCallId: "gr2", args: { path: "missing.ts" }, cwd: "/repo", state: {}, expanded: false, isError: true, executionStarted: true, argsComplete: true } as never;
  const gr1 = grpRead.bind(gr1Ctx); gr1.updateCall(gr1Ctx);
  const gr2 = grpRead.bind(gr2Ctx); gr2.updateCall(gr2Ctx);
  const grpOut = renderReadGroup(gr1.current(), true, claudeTheme, 100, "ctrl+o").map(stripTerminalSequences).join("\n");
  assert.match(grpOut, /● Read 2 files/);
  assert.match(grpOut, /ENOENT: no such file or directory/);

  // Generic search renderers preserve empty messages, match counts and expanded rows.
  let resolver: ((name: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined) | undefined;
  registerClaudeGenericToolRenderer(
    {
      registerToolRenderer(fn: typeof resolver) { resolver = fn; },
    } as unknown as ExtensionAPI,
    () => createFakeKeybindings({ "app.tools.expand": ["ctrl+o"] }),
  );
  assert.ok(resolver);

  const fallbackLs: ToolRenderers = {
    renderCall(args) { return new Text(`ls ${(args as { path?: string })?.path ?? "."}`, 0, 0); },
    renderResult(res) { return new Text((res.content[0] as { text?: string })?.text ?? "", 0, 0); },
  };
  const lsRender = resolver("ls", () => fallbackLs)!;
  const lsState = {};
  const lsCallClaude = lsRender.renderCall!(
    { path: "example" },
    claudeTheme,
    { state: lsState, cwd: "/repo", executionStarted: true, outputPad: 0 } as never,
  );
  assert.match(stripTerminalSequences(lsCallClaude.render(80).join("\n")), /● List\(example\)/);
  // Empty directory & No matches found preserve host text (not "1 entry" / "Found 1 match").
  const emptyLs = lsRender.renderResult!(
    { content: [{ type: "text", text: "(empty directory)" }], details: {} },
    { expanded: false, isPartial: false },
    claudeTheme,
    { state: lsState, cwd: "/repo", isError: false, outputPad: 0 } as never,
  );
  assert.match(stripTerminalSequences(emptyLs.render(80).join("\n")), /⎿  \(empty directory\)/);
  assert.doesNotMatch(stripTerminalSequences(emptyLs.render(80).join("\n")), /1 entry/);

  const grepRender = resolver("grep", () => fallbackLs)!;
  const grepState = {};
  const noMatchGrep = grepRender.renderResult!(
    { content: [{ type: "text", text: "No matches found" }], details: {} },
    { expanded: false, isPartial: false },
    claudeTheme,
    { state: grepState, cwd: "/repo", isError: false, outputPad: 0 } as never,
  );
  assert.match(stripTerminalSequences(noMatchGrep.render(80).join("\n")), /⎿  No matches found/);

  // Context lines do not inflate grep match count (using Pi's real `<path>:<n>: ` / `<path>-<n>- ` format).
  const ctxGrep = grepRender.renderResult!(
    {
      content: [{ type: "text", text: "src/a.ts-1- before\nsrc/a.ts:2: hit\nsrc/a.ts-3- after\n--\nsrc/b.ts:9: hit2" }],
      details: {},
    },
    { expanded: false, isPartial: false },
    claudeTheme,
    { state: grepState, cwd: "/repo", isError: false, outputPad: 0 } as never,
  );
  assert.match(stripTerminalSequences(ctxGrep.render(80).join("\n")), /⎿  Found 2 matches/);

  // S4: Expanding 38 find results renders all 38 files + truncation notice.
  const findRender = resolver("find", () => fallbackLs)!;
  const files38 = Array.from({ length: 38 }, (_, i) => `src/file-${i + 1}.ts`).join("\n") + "\n\n[38 results limit reached]";
  const findExpanded = findRender.renderResult!(
    { content: [{ type: "text", text: files38 }], details: { resultLimitReached: 38 } },
    { expanded: true, isPartial: false },
    claudeTheme,
    { state: {}, cwd: "/repo", isError: false, outputPad: 0 } as never,
  );
  const findText = stripTerminalSequences(findExpanded.render(100).join("\n"));
  assert.match(findText, /Found 38 files/);
  assert.match(findText, /src\/file-38\.ts/);
  assert.match(findText, /38 results limit reached/);
  themeModule.setThemeInstance(claudeTheme);
  const card = new ToolExecutionComponent("ls", "ls-result", { path: "example" }, {}, lsRender as never, createFakeTui(), "/repo");
  card.markExecutionStarted();
  card.updateResult({ content: [{ type: "text", text: "a.ts\nb.ts" }], isError: false, details: {} });
  const rendered = card.render(80);
  assert.match(stripTerminalSequences(rendered.join("\n")), /● List\(example\)/);
  assert.match(stripTerminalSequences(rendered.join("\n")), /⎿  2 entries/);

  // S3: Directory containing literal filename `[id]` is counted as 1 entry (not empty/warning).
  const bracketFileLs = lsRender.renderResult!(
    { content: [{ type: "text", text: "[id]" }], details: {} },
    { expanded: true, isPartial: false },
    claudeTheme,
    { state: {}, cwd: "/repo", isError: false, outputPad: 0 } as never,
  );
  const bracketText = stripTerminalSequences(bracketFileLs.render(80).join("\n"));
  assert.match(bracketText, /⎿  1 entry/);
  assert.match(bracketText, /\[id\]/);
  assert.doesNotMatch(bracketText, /empty directory/);

  // S3: Context line containing timestamp colons (`f-1- 12:30:45`) is NOT counted as a grep match,
  // and date filenames (`2026-11-28.log:7: hit`) are NOT misclassified by `-11-`.
  const colonCtxGrep = grepRender.renderResult!(
    { content: [{ type: "text", text: "f-1- 12:30:45\nf:2: hit" }], details: {} },
    { expanded: false, isPartial: false },
    claudeTheme,
    { state: {}, cwd: "/repo", isError: false, outputPad: 0 } as never,
  );
  assert.match(stripTerminalSequences(colonCtxGrep.render(80).join("\n")), /⎿  Found 1 match/);

  const dateFileGrep = grepRender.renderResult!(
    { content: [{ type: "text", text: "2026-11-28.log:7: hit\n2026-11-28.log-8- next" }], details: {} },
    { expanded: false, isPartial: false },
    claudeTheme,
    { state: {}, cwd: "/repo", isError: false, outputPad: 0 } as never,
  );
  assert.match(stripTerminalSequences(dateFileGrep.render(80).join("\n")), /⎿  Found 1 match/);
});

test("extension preserves claude-code theme on session start/reload and applies Claude Markdown and hidden thinking label", async () => {
  const claudeTheme = loadClaudeTheme();
  const darkTheme = { name: "dark" } as Theme;
  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const transformers: Array<(md: string, ctx: { messageType: string }) => string> = [];

  const pi = {
    on(name: string, fn: (...args: unknown[]) => unknown) {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
    },
    registerTool() {},
    registerToolRenderer() {},
    registerCommand() {},
    registerMarkdownTransformer(fn: (md: string, ctx: { messageType: string }) => string) {
      transformers.push(fn);
    },
    getThinkingLevel: () => "high",
    getSessionName: () => undefined,
  } as unknown as ExtensionAPI;

  claudeUiExtension(pi);

  let currentTheme: Theme = darkTheme;
  let claudeThemeInstance: Theme = claudeTheme;
  const hiddenLabels: Array<string | undefined> = [];
  let footerFactory: ((tui: TUI, theme: Theme, footerData: unknown) => { invalidate(): void; render(w: number): string[] }) | undefined;

  const ctx = {
    mode: "tui",
    cwd: "/repo",
    model: { id: "gpt-5.4" },
    isIdle: () => true,
    sessionManager: { buildContextEntries: () => [] },
    ui: {
      get theme() { return currentTheme; },
      getTheme(name: string) {
        if (name === CLAUDE_THEME_NAME) return claudeThemeInstance;
        return undefined;
      },
      setTheme(next: Theme) { currentTheme = next; return { success: true }; },
      notify() {},
      setHeader() {},
      setEditorComponent() {},
      setFooter(factory: typeof footerFactory) { footerFactory = factory; },
      setWidget() {},
      setTitle() {},
      setWorkingVisible() {},
      setHiddenThinkingLabel(label?: string) { hiddenLabels.push(label); },
      addAutocompleteProvider() {},
    },
  };

  for (const fn of handlers.get("session_start") ?? []) {
    fn({ reason: "startup" }, ctx);
  }

  assert.equal(currentTheme.name, CLAUDE_THEME_NAME);
  assert.equal(hiddenLabels.at(-1), "∴ Thinking… (ctrl+t to expand)");

  const transform = transformers[0]!;
  assert.equal(transform("fix retry", { messageType: "user" }), "❯ fix retry");
  assert.equal(transform("```ts\nconst x = 1;\n```", { messageType: "user" }), "❯\n\n```ts\nconst x = 1;\n```");
  assert.equal(transform("    echo ok", { messageType: "user" }), "❯\n\n    echo ok");
  assert.equal(transform(" \techo ok", { messageType: "user" }), "❯\n\n \techo ok");
  assert.equal(transform("---", { messageType: "user" }), "❯\n\n---");
  assert.equal(transform("Done.", { messageType: "assistant" }), "● Done.");
  assert.equal(transform("## Heading", { messageType: "assistant" }), "## Heading");
  assert.equal(transform(" \techo ok", { messageType: "assistant" }), " \techo ok");
  assert.equal(transform("Checking.", { messageType: "assistant-thinking" }), "∴ Thinking…\n\nChecking.");

  // Simulate /reload where Pi refreshes themes and resets to dark: extension must restore claude-code, NOT codex-pi!
  for (const fn of handlers.get("session_start") ?? []) {
    fn({ reason: "reload" }, ctx);
  }
  const footer = footerFactory!(createFakeTui(), currentTheme, {
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map(),
    onBranchChange: () => () => {},
  });
  claudeThemeInstance = loadClaudeTheme();
  currentTheme = darkTheme;
  footer.invalidate();
  await new Promise(resolveTick => queueMicrotask(() => resolveTick(undefined)));
  assert.equal(currentTheme.name, CLAUDE_THEME_NAME);
});
