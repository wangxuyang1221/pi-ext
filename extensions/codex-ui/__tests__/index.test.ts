import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  AssistantMessageComponent,
  SessionManager,
  getMarkdownTheme,
  initTheme,
  type ExtensionAPI,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";

import codexUiExtension, { CODEX_THEME_NAME } from "../src/index.js";

function createTheme(name = CODEX_THEME_NAME): Theme {
  return {
    name,
    fg: (_name: string, text: string) => text,
    bg: (_name: string, text: string) => text,
    bold: (text: string) => text,
    getBgAnsi: () => "\x1b[48;5;238m",
    getColorMode: () => "256color",
  } as unknown as Theme;
}

test("markdown transformer prepends a Thinking heading without wrapping assistant replies or thinking bodies", () => {
  const transformers: Array<(markdown: string, context: Record<string, unknown>) => string> = [];
  const pi = {
    registerTool() {},
    registerCommand() {},
    registerMarkdownTransformer(transformer: (markdown: string, context: Record<string, unknown>) => string) {
      transformers.push(transformer);
    },
    on() {},
  } as unknown as ExtensionAPI;

  codexUiExtension(pi);

  assert.equal(transformers.length, 1);
  const transform = transformers[0];
  assert.ok(transform);
  assert.equal(transform("hello", { messageType: "user" }), "hello");
  assert.equal(transform("› hello", { messageType: "user" }), "› hello");
  assert.equal(transform("hello", { messageType: "assistant" }), "hello");
  assert.equal(transform("## Heading\n\n- item", { messageType: "assistant" }), "## Heading\n\n- item");

  const thinking = "**First title**\n\nFirst body.\n\n**Last title**\n\nLast body.";
  assert.equal(
    transform(thinking, { messageType: "assistant-thinking", isStreaming: true, availableWidth: 80 }),
    `> **Thinking**\n\n${thinking}`,
  );
  for (const text of [
    thinking,
    "Plain reasoning without a title",
    "**Incomplete title",
    "检查 [link](https://example.com) `code`\n\n- item\n\n```ts\nconst n = 1;\n```",
    "Body. ".repeat(2000),
    "First\r\n\r\nLast",
    "  indented\n\nend\n",
    "*emphasis* first",
    "> Nested quote\n\n| Key | Value |\n| --- | --- |\n| a | b |",
    "- item\n\nbody",
    "1. step\n2. step",
    "# Heading\n\nbody",
    "```ts\nconst n = 1;\n```",
    "Key | Value\n--- | ---\na | b",
    "Title\n---\nbody",
    "Plan the fix\nthen verify\n---\nbody",
    "Plan\nthen\n===",
    "Plan\n\n---",
    "---\nbody",
    "    code\n\nbody",
    "\nAfter a blank line",
    "",
    " \n\t ",
  ]) {
    for (const isStreaming of [true, false]) {
      for (const availableWidth of [0, 1, 10, 80, 120]) {
        const result = transform(text, { messageType: "assistant-thinking", isStreaming, availableWidth });
        if (!text.trim()) {
          assert.equal(result, text);
        } else {
          assert.equal(result, `> **Thinking**\n\n${text}`);
        }
      }
    }
  }

  initTheme("dark");
  const message = {
    role: "assistant", content: [{ type: "thinking", thinking }], stopReason: "stop", timestamp: 1,
  } as never;
  const component = new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, [transform as never]);
  const rendered = stripTerminalSequences(component.render(80).join("\n"));
  const nonEmpty = rendered.split("\n").map(line => line.trimEnd()).filter(line => line.trim());
  assert.equal(nonEmpty[0]?.trim(), "│ Thinking");
  assert.ok(nonEmpty.slice(1).every(line => !line.trimStart().startsWith("│")));
  assert.match(rendered, /First body\./u);
  assert.match(rendered, /Last body\./u);
});

test("streaming replies and thinking reuse completed top-level Markdown blocks and code highlighting", () => {
  const transformers: Array<(markdown: string, context: Record<string, unknown>) => string> = [];
  codexUiExtension({
    registerTool() {},
    registerCommand() {},
    registerMarkdownTransformer(transformer: (markdown: string, context: Record<string, unknown>) => string) {
      transformers.push(transformer);
    },
    on() {},
  } as unknown as ExtensionAPI);

  initTheme("dark", false);
  const baseMdTheme = getMarkdownTheme();

  const makeMsg = (kind: "text" | "thinking", value: string) => ({
    role: "assistant",
    content: [kind === "text" ? { type: "text", text: value } : { type: "thinking", thinking: value }],
    stopReason: "stop",
    timestamp: 1,
  }) as never;

  // (a) Blank-line-separated completed fenced code block: highlightCode runs once across 5 trailing deltas.
  for (const kind of ["text", "thinking"] as const) {
    let highlightCalls = 0;
    const mdTheme = {
      ...baseMdTheme,
      highlightCode(code: string, lang?: string) {
        highlightCalls++;
        return baseMdTheme.highlightCode ? baseMdTheme.highlightCode(code, lang) : code.split("\n");
      },
    };
    const renderBlockSpy = vi.spyOn(Markdown.prototype as unknown as { renderBlock: (...args: unknown[]) => void }, "renderBlock");
    try {
      const comp = new AssistantMessageComponent(undefined, false, mdTheme, "Thinking...", 1, transformers as never);
      const prefix = "Intro paragraph.\n\n```ts\nconst answer = 42;\n```\n\n";
      comp.updateContent(makeMsg(kind, `${prefix}Tail 0`), true);
      comp.render(80);
      assert.equal(highlightCalls, 1, `${kind}: initial render highlights completed code block once`);

      renderBlockSpy.mockClear();
      for (let i = 1; i <= 5; i++) {
        comp.updateContent(makeMsg(kind, `${prefix}Tail ${i}`), true);
        comp.render(80);
      }
      assert.equal(highlightCalls, 1, `${kind}: completed code block must not re-highlight on trailing deltas`);
      const nonSpaceBlocks = renderBlockSpy.mock.calls
        .map(([, token]) => (token as { type?: string; raw?: string }))
        .filter(token => token.type !== "space");
      assert.equal(nonSpaceBlocks.length, 5, `${kind}: only the mutated trailing block re-renders per delta`);
      assert.ok(nonSpaceBlocks.every(token => token.type === "paragraph" && token.raw?.startsWith("Tail ")));
    } finally {
      renderBlockSpy.mockRestore();
    }
  }

  // (b) Single-newline transition after closing fence matches Native Pi step-by-step ([1, 1, 0]).
  for (const kind of ["text", "thinking"] as const) {
    const measureSteps = (activeTransformers: typeof transformers) => {
      let calls = 0;
      const mdTheme = {
        ...baseMdTheme,
        highlightCode(code: string, lang?: string) {
          calls++;
          return baseMdTheme.highlightCode ? baseMdTheme.highlightCode(code, lang) : code.split("\n");
        },
      };
      const comp = new AssistantMessageComponent(undefined, false, mdTheme, "Thinking...", 1, activeTransformers as never);
      const counts: number[] = [];
      for (const body of [
        "```ts\nconst x = 1;\n```\n",
        "```ts\nconst x = 1;\n```\n\na",
        "```ts\nconst x = 1;\n```\n\nab",
      ]) {
        const before = calls;
        comp.updateContent(makeMsg(kind, body), true);
        comp.render(80);
        counts.push(calls - before);
      }
      return counts;
    };
    assert.deepEqual(measureSteps(transformers), measureSteps([]), `${kind}: single-newline fence transition matches native Pi`);
  }

  // (c) Trailing reference-style link definition disables block reuse and resolves the earlier link.
  for (const kind of ["text", "thinking"] as const) {
    const comp = new AssistantMessageComponent(undefined, false, baseMdTheme, "Thinking...", 1, transformers as never);
    comp.updateContent(makeMsg(kind, "See [Pi Docs][pi]\n\n```ts\nconst ok = true;\n```"), true);
    comp.render(80);
    comp.updateContent(makeMsg(kind, "See [Pi Docs][pi]\n\n```ts\nconst ok = true;\n```\n\n[pi]: https://pi.dev"), false);
    const rendered = stripTerminalSequences(comp.render(80).join("\n"));
    assert.match(rendered, /Pi Docs/u);
    assert.match(rendered, /https:\/\/pi\.dev/u);
  }
});

test("does not register the removed lowpower command or argument completion", () => {
  const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
  codexUiExtension({ registerTool() {}, registerMarkdownTransformer() {}, on() {},
    registerCommand(name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) { commands.set(name, command); },
  } as unknown as ExtensionAPI);
  assert.equal(commands.has("lowpower"), false);
});

test("session UI installs only in TUI mode", async () => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const registeredTools: ToolDefinition[] = [];
  const pi = {
    registerTool(tool: ToolDefinition) {
      registeredTools.push(tool);
    },
    registerCommand() {},
    registerMarkdownTransformer() {},
    getThinkingLevel: () => "high",
    getSessionName: () => undefined,
    on(event: string, handler: (...args: never[]) => unknown) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  codexUiExtension(pi);

  const sessionStart = handlers.get("session_start");
  assert.ok(sessionStart);

  const nonTuiCalls: string[] = [];
  await sessionStart(
    { type: "session_start", reason: "startup" } as never,
    {
      mode: "print",
      ui: new Proxy({}, {
        get(_target, property) {
          return () => nonTuiCalls.push(String(property));
        },
      }),
    } as never,
  );
  assert.deepEqual(nonTuiCalls, []);

  const calls: Array<{ name: string; value?: unknown }> = [];
  const activeTheme = createTheme("dark");
  const profileTheme = createTheme();
  const ui = {
    theme: activeTheme,
    setStatus(key: string, text: string | undefined) {
      calls.push({ name: "status", value: [key, text] });
    },
    getTheme(name: string) {
      calls.push({ name: "getTheme", value: name });
      return profileTheme;
    },
    setTheme(value: Theme) {
      calls.push({ name: "theme", value });
      return { success: true };
    },
    setHeader(value: unknown) {
      calls.push({ name: "header", value });
    },
    setEditorComponent(value: unknown) {
      calls.push({ name: "editor", value });
    },
    setFooter(value: unknown) {
      calls.push({ name: "footer", value });
    },
    setTitle(value: string) {
      calls.push({ name: "title", value });
    },
    setWorkingVisible(value: boolean) {
      calls.push({ name: "working-visible", value });
    },
    setWorkingIndicator(value: unknown) { calls.push({ name: "working-indicator", value }); },
    setWidget(key: string, value: unknown) { calls.push({ name: "widget", value: [key, value] }); },
    notify() {},
  };

  await sessionStart(
    { type: "session_start", reason: "startup" } as never,
    {
      mode: "tui",
      cwd: "/repo/app",
      model: { id: "gpt-test" },
      sessionManager: SessionManager.inMemory(),
      getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
      isIdle: () => true,
      ui,
    } as never,
  );

  assert.deepEqual(calls.map((call) => call.name), [
    "getTheme",
    "theme",
    "header",
    "editor",
    "footer",
    "title",
    "working-visible",
  ]);
  assert.ok(!calls.some(call => call.name === "status"));
  assert.equal(calls[0]?.value, CODEX_THEME_NAME);
  assert.equal(calls[1]?.value, profileTheme);
  assert.match(String(calls.find((call) => call.name === "title")?.value), /^π · app$/u);
  assert.equal(calls.find((call) => call.name === "working-visible")?.value, false);

  const editorFactory = calls.find((call) => call.name === "editor")?.value as ((
    tui: never,
    editorTheme: never,
    keybindings: never,
  ) => unknown) | undefined;
  assert.ok(editorFactory);
  editorFactory(
    { requestRender() {} } as never,
    { borderColor: (text: string) => text } as never,
    {
      getKeys: (keybinding: string) => keybinding === "app.tools.expand" ? ["ctrl+shift+o"] : [],
      matches: () => false,
    } as never,
  );

  const footerFactory = calls.find((call) => call.name === "footer")?.value as ((
    tui: { requestRender(): void },
    theme: Theme,
    footerData: {
      getGitBranch(): string | null;
      getExtensionStatuses(): ReadonlyMap<string, string>;
      onBranchChange(listener: () => void): () => void;
    },
  ) => { render(width: number): string[]; dispose?(): void }) | undefined;
  assert.ok(footerFactory);
  const requestRender = vi.fn();
  const unsubscribe = vi.fn();
  let branchListener: (() => void) | undefined;
  const footer = footerFactory(
    { requestRender } as never,
    profileTheme,
    {
      getGitBranch: () => "feature/footer",
      getExtensionStatuses: () => new Map(),
      onBranchChange(listener) {
        branchListener = listener;
        return unsubscribe;
      },
    },
  );
  assert.match(footer.render(100).join("\n"), /git:feature\/footer/u);
  branchListener?.();
  assert.equal(requestRender.mock.calls.length, 1);
  footer.dispose?.();
  assert.equal(unsubscribe.mock.calls.length, 1);

  const bash = registeredTools.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);
  assert.ok(bash.renderResult);
  const bashState = {};
  const bashContext = {
    args: { command: "echo hello" },
    state: bashState,
    lastComponent: undefined,
    cwd: "/repo/app",
    executionStarted: false,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: true,
    isError: false,
    toolCallId: "tool-1",
    invalidate() {},
  };
  const bashCall = bash.renderCall(bashContext.args, profileTheme, bashContext as never);
  const bashResult = bash.renderResult(
    { content: [{ type: "text", text: "hello\nsecond\nthird\nfourth\nfifth\nsixth" }], details: undefined },
    { expanded: false, isPartial: false },
    profileTheme,
    bashContext as never,
  );
  assert.deepEqual(bashResult.render(80), []);
  assert.match(bashCall.render(80).map(stripTerminalSequences).join("\n"), /… \+2 lines \(ctrl\+shift\+o to expand\)/u);

  const headerFactory = calls.find((call) => call.name === "header")?.value as (() => {
    render(width: number): string[];
  }) | undefined;
  assert.ok(headerFactory);
  await handlers.get("model_select")?.(
    { type: "model_select", model: { id: "gpt-next" } } as never,
    {} as never,
  );
  assert.match(headerFactory().render(60).join("\n"), /gpt-next/u);
});

test("session UI preserves an active Codex theme without replacing it", async () => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const pi = {
    registerTool() {},
    registerCommand() {},
    registerMarkdownTransformer() {},
    getThinkingLevel: () => "high",
    getSessionName: () => undefined,
    on(event: string, handler: (...args: never[]) => unknown) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  codexUiExtension(pi);

  const sessionStart = handlers.get("session_start");
  assert.ok(sessionStart);

  const themeCalls: string[] = [];
  const theme = createTheme();
  await sessionStart(
    { type: "session_start", reason: "startup" } as never,
    {
      mode: "tui",
      cwd: "/repo/app",
      model: { id: "gpt-test" },
      getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
      isIdle: () => true,
      ui: {
        theme,
        setStatus() {},
        getTheme() {
          themeCalls.push("getTheme");
          return theme;
        },
        setTheme() {
          themeCalls.push("setTheme");
          return { success: true };
        },
        setHeader() {},
        setEditorComponent() {},
        setFooter() {},
        setTitle() {},
        setWorkingVisible() {},
        setWorkingIndicator() {},
        setWidget() {},
        notify() {},
      },
    } as never,
  );

  assert.deepEqual(themeCalls, []);
});

test("history rebuild shares one context entry scan across tools and codemode and skips pure text deltas", async () => {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const tools = new Map<string, ToolDefinition>();
  const pi = {
    registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); },
    registerToolRenderer() {},
    registerCommand() {},
    registerMarkdownTransformer() {},
    getThinkingLevel: () => "high",
    getSessionName: () => undefined,
    on(event: string, handler: (...args: any[]) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  } as unknown as ExtensionAPI;
  codexUiExtension(pi);

  const sessionManager = SessionManager.inMemory("/repo/app");
  const scan = vi.spyOn(sessionManager, "buildContextEntries");
  const theme = createTheme();
  const ctx = {
    mode: "tui",
    cwd: "/repo/app",
    model: { id: "gpt-test" },
    sessionManager,
    getContextUsage: () => undefined,
    isIdle: () => true,
    ui: {
      theme,
      setStatus() {},
      getTheme: () => theme,
      setTheme: () => ({ success: true }),
      setHeader() {},
      setEditorComponent() {},
      setFooter() {},
      setTitle() {},
      setWorkingVisible() {},
      setWorkingIndicator() {},
      setWidget() {},
      notify() {},
    },
  };
  const emit = (type: string, event: Record<string, unknown> = {}) => {
    const payload = { type, ...event };
    for (const handler of handlers.get(type) ?? []) handler(payload, ctx);
  };
  emit("session_start", { reason: "startup" });
  assert.equal(scan.mock.calls.length, 1, "session_start should call buildContextEntries once across Bash, Read, and Codemode");
  emit("session_tree");
  assert.equal(scan.mock.calls.length, 2, "session_tree should call buildContextEntries once");
  emit("session_compact");
  assert.equal(scan.mock.calls.length, 3, "session_compact should call buildContextEntries once");

  // Pure text_delta on an unchanged content array short-circuits discovery without breaking later toolcall grouping.
  let blockReads = 0;
  const textBlock = { get type() { blockReads++; return "text"; }, text: "hi" };
  const content: Array<Record<string, unknown>> = [textBlock];
  const msg = { role: "assistant", content };
  emit("message_start", { message: msg });
  const readsAfterStart = blockReads;
  assert.ok(readsAfterStart > 0);
  textBlock.text = "hi there";
  emit("message_update", {
    message: msg,
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " there", partial: msg },
  });
  // Only the single contentIndex guard checks block.type; neither BashGroups nor ReadGroups scans the content array.
  assert.equal(blockReads - readsAfterStart, 1, "text_delta should skip full BashGroups/ReadGroups scans");

  const bash1 = { type: "toolCall", id: "b1", name: "bash", arguments: { command: "echo 1" } };
  const bash2 = { type: "toolCall", id: "b2", name: "bash", arguments: { command: "echo 2" } };
  content.push(bash1, bash2);
  emit("message_update", {
    message: msg,
    assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, partial: msg },
  });
  const bashTool = tools.get("bash")!;
  const mkCtx = (id: string, command: string) => ({
    args: { command }, state: {}, lastComponent: undefined, cwd: "/repo/app",
    executionStarted: true, argsComplete: true, isPartial: false, expanded: false,
    showImages: false, isError: false, toolCallId: id, invalidate() {},
  });
  const row1 = bashTool.renderCall!({ command: "echo 1" } as never, theme, mkCtx("b1", "echo 1") as never);
  const row2 = bashTool.renderCall!({ command: "echo 2" } as never, theme, mkCtx("b2", "echo 2") as never);
  const out1 = stripTerminalSequences(row1.render(80).join("\n"));
  assert.match(out1, /echo 1/u);
  assert.match(out1, /echo 2/u);
  assert.deepEqual(row2.render(80), []);
  emit("session_shutdown");
});

function createThemeLifecycleHarness(initialThemeName: string) {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const pi = {
    registerTool() {},
    registerToolRenderer() {},
    registerCommand() {},
    registerMarkdownTransformer() {},
    getThinkingLevel: () => "high",
    getSessionName: () => undefined,
    on(event: string, handler: (...args: any[]) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  } as unknown as ExtensionAPI;
  codexUiExtension(pi);

  let registeredProfileTheme = createTheme(CODEX_THEME_NAME);
  let activeTheme = initialThemeName === CODEX_THEME_NAME ? registeredProfileTheme : createTheme(initialThemeName);
  const setThemeCalls: Theme[] = [];
  const autocompleteWrappers: Array<(provider: Record<string, unknown>) => Record<string, unknown>> = [];
  let mountedFooter: { render(width: number): string[]; invalidate(): void; dispose?(): void } | undefined;

  const setupAutocompleteProvider = () => {
    let provider: Record<string, unknown> = {};
    for (const wrap of autocompleteWrappers) {
      provider = wrap(provider);
    }
  };

  const ui = {
    get theme() { return activeTheme; },
    setStatus() {},
    getTheme(name: string) { return name === CODEX_THEME_NAME ? registeredProfileTheme : undefined; },
    setTheme(value: Theme) {
      setThemeCalls.push(value);
      activeTheme = value;
      return { success: true };
    },
    setHeader() {},
    setEditorComponent() {},
    addAutocompleteProvider(wrap: (provider: Record<string, unknown>) => Record<string, unknown>) {
      autocompleteWrappers.push(wrap);
      setupAutocompleteProvider();
    },
    setFooter(factory: (tui: never, theme: Theme, footerData: never) => {
      render(width: number): string[];
      invalidate(): void;
      dispose?(): void;
    }) {
      mountedFooter = factory(
        { requestRender() {} } as never,
        activeTheme,
        {
          getGitBranch: () => null,
          getExtensionStatuses: () => new Map(),
          onBranchChange: () => () => {},
        } as never,
      );
    },
    setTitle() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setWidget() {},
    notify() {},
  };

  const ctx = {
    mode: "tui",
    cwd: "/repo/app",
    model: { id: "gpt-test" },
    sessionManager: SessionManager.inMemory("/repo/app"),
    getContextUsage: () => undefined,
    isIdle: () => true,
    ui,
  };

  const emit = (type: string, event: Record<string, unknown> = {}) => {
    const payload = { type, ...event };
    for (const handler of handlers.get(type) ?? []) handler(payload, ctx);
  };

  const refreshRegisteredThemes = () => {
    registeredProfileTheme = createTheme(CODEX_THEME_NAME);
    return registeredProfileTheme;
  };

  return {
    get profileTheme() { return registeredProfileTheme; },
    setThemeCalls,
    get activeTheme() { return activeTheme; },
    set activeTheme(theme: Theme) { activeTheme = theme; },
    get footer() { return mountedFooter; },
    setupAutocompleteProvider,
    refreshRegisteredThemes,
    emit,
  };
}

test("restores codex-pi theme once after host post-rebind reset on resume, new, fork, and reload", async () => {
  for (const reason of ["resume", "new", "fork", "reload"] as const) {
    const harness = createThemeLifecycleHarness(CODEX_THEME_NAME);
    harness.emit("session_start", { reason });
    assert.equal(harness.setThemeCalls.length, 0, `${reason}: active codex-pi should not be re-set during session_start`);

    // Unrelated invalidation and sibling autocomplete registration during discovery must not disarm restore.
    harness.footer?.invalidate();
    harness.setupAutocompleteProvider();

    // Simulate Pi 1.5.2 setRegisteredThemes() -> setupAutocompleteProvider() / applyFromSettings().
    const freshProfileTheme = harness.refreshRegisteredThemes();
    if (reason !== "reload") {
      harness.setupAutocompleteProvider();
      await Promise.resolve();
    }
    harness.activeTheme = createTheme("dark");
    harness.footer?.invalidate();
    harness.footer?.invalidate();
    if (reason === "reload") {
      harness.setupAutocompleteProvider();
    }
    await Promise.resolve();

    assert.equal(harness.activeTheme, freshProfileTheme, `${reason}: codex-pi should be restored after host reset`);
    assert.equal(harness.setThemeCalls.length, 1, `${reason}: restore should apply profile theme once`);

    // A later manual theme change must not be hijacked back to codex-pi.
    const manualLight = createTheme("light");
    harness.activeTheme = manualLight;
    harness.footer?.invalidate();
    await Promise.resolve();

    assert.equal(harness.activeTheme, manualLight, `${reason}: manual theme switch must persist`);
    assert.equal(harness.setThemeCalls.length, 1);

    harness.emit("session_shutdown");
  }
});

test("restores codex-pi theme after delayed discovery with sibling autocomplete and unrelated invalidations", async () => {
  const harness = createThemeLifecycleHarness(CODEX_THEME_NAME);
  harness.emit("session_start", { reason: "resume" });

  // Simulate another extension registering autocomplete + an unrelated invalidation before an async discovery I/O turn.
  harness.setupAutocompleteProvider();
  harness.footer?.invalidate();
  await new Promise<void>((resolve) => setImmediate(resolve));

  const freshProfileTheme = harness.refreshRegisteredThemes();
  harness.setupAutocompleteProvider();
  await Promise.resolve();
  harness.activeTheme = createTheme("dark");
  harness.footer?.invalidate();
  await Promise.resolve();

  assert.equal(harness.activeTheme, freshProfileTheme);
  assert.equal(harness.setThemeCalls.length, 1);
  harness.emit("session_shutdown");
});

test("skips post-rebind theme restore on startup, sibling overrides, matching settings theme, and shutdown", async () => {
  const manualLight = createTheme("light");
  const darkTheme = createTheme("dark");

  // Startup does not arm post-rebind restore.
  const startup = createThemeLifecycleHarness("dark");
  startup.emit("session_start", { reason: "startup" });
  assert.equal(startup.setThemeCalls.length, 1);
  startup.refreshRegisteredThemes();
  startup.activeTheme = manualLight;
  startup.footer?.invalidate();
  await Promise.resolve();
  assert.equal(startup.activeTheme, manualLight);
  startup.emit("session_shutdown");

  // A sibling extension overriding the theme during session_start or resources_discover (before setRegisteredThemes) disarms restore.
  const sibling = createThemeLifecycleHarness(CODEX_THEME_NAME);
  sibling.emit("session_start", { reason: "resume" });
  sibling.activeTheme = manualLight;
  sibling.footer?.invalidate();
  await Promise.resolve();
  assert.equal(sibling.activeTheme, manualLight);
  assert.equal(sibling.setThemeCalls.length, 0);
  sibling.refreshRegisteredThemes();
  sibling.setupAutocompleteProvider();
  sibling.activeTheme = darkTheme;
  sibling.footer?.invalidate();
  await Promise.resolve();
  assert.equal(sibling.activeTheme, darkTheme);
  assert.equal(sibling.setThemeCalls.length, 0);
  sibling.emit("session_shutdown");

  // Matching settings theme (codex-pi) disarms synchronously during applyFromSettings() so
  // even a withSession() callback in the very next microtask (before setImmediate) persists.
  const matching = createThemeLifecycleHarness(CODEX_THEME_NAME);
  matching.emit("session_start", { reason: "new" });
  matching.refreshRegisteredThemes();
  matching.setupAutocompleteProvider();
  matching.footer?.invalidate();
  await Promise.resolve();
  matching.activeTheme = manualLight;
  matching.footer?.invalidate();
  await Promise.resolve();
  assert.equal(matching.activeTheme, manualLight);
  assert.equal(matching.setThemeCalls.length, 0);
  matching.emit("session_shutdown");

  // session_shutdown cancels any scheduled restore microtask.
  const shutdown = createThemeLifecycleHarness(CODEX_THEME_NAME);
  shutdown.emit("session_start", { reason: "resume" });
  shutdown.refreshRegisteredThemes();
  shutdown.setupAutocompleteProvider();
  shutdown.activeTheme = darkTheme;
  shutdown.footer?.invalidate();
  shutdown.emit("session_shutdown");
  await Promise.resolve();
  assert.equal(shutdown.activeTheme, darkTheme);
  assert.equal(shutdown.setThemeCalls.length, 0);
});
