import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";

import codexUiExtension, { CODEX_THEME_NAME } from "../src/index.js";

function createTheme(name = CODEX_THEME_NAME): Theme {
  return {
    name,
    fg: (_name: string, text: string) => text,
    bg: (_name: string, text: string) => text,
    bold: (text: string) => text,
    getBgAnsi: () => "\x1b[48;5;238m",
  } as unknown as Theme;
}

test("markdown transformer formats user messages and compacts thinking to one line", () => {
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
  assert.equal(transform("hello", { messageType: "user" }), "› hello");
  assert.equal(transform("› hello", { messageType: "user" }), "› hello");
  assert.equal(transform("hello", { messageType: "assistant" }), "hello");

  const thinking = [
    "**Reviewing test improvements and reload considerations**",
    "",
    "**Identifying title spinner and tmux title issues",
    "continued on the next source line**",
    "",
    "**Summarizing code changes and test results**",
  ].join("\n");
  assert.equal(transform(thinking, {
    messageType: "assistant-thinking",
    isStreaming: true,
    availableWidth: 80,
  }), "**Summarizing code changes and test results**");
  assert.equal(transform(thinking, {
    messageType: "assistant-thinking",
    isStreaming: false,
    availableWidth: 80,
  }), "**Summarizing code changes and test results**");
  assert.equal(transform("Earlier\n\n1234567890ABCDE", {
    messageType: "assistant-thinking",
    isStreaming: true,
    availableWidth: 10,
  }), "123456789…");
  assert.equal(transform("Earlier\n\n**1234567890ABCDE**", {
    messageType: "assistant-thinking",
    isStreaming: false,
    availableWidth: 10,
  }), "**123456789…**");
});

function createLowPowerCommandHarness() {
  const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
  const registeredTools: ToolDefinition[] = [];
  const pi = {
    registerTool(tool: ToolDefinition) {
      registeredTools.push(tool);
    },
    registerCommand(name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) {
      commands.set(name, options);
    },
    registerMarkdownTransformer() {},
    on() {},
  } as unknown as ExtensionAPI;
  codexUiExtension(pi);

  const command = commands.get("lowpower");
  assert.ok(command);

  const statusCalls: Array<[string, string | undefined]> = [];
  const notifications: Array<[string, string | undefined]> = [];
  const workingVisibility: boolean[] = [];
  const context = {
    ui: {
      theme: createTheme(),
      setStatus(key: string, text: string | undefined) {
        statusCalls.push([key, text]);
      },
      setWorkingVisible(visible: boolean) {
        workingVisibility.push(visible);
      },
      notify(message: string, type?: string) {
        notifications.push([message, type]);
      },
    },
  };

  return { command, context, notifications, registeredTools, statusCalls, workingVisibility };
}

test("lowpower command keeps the built-in working row hidden in both modes", async () => {
  const { command, context, workingVisibility } = createLowPowerCommandHarness();

  await command.handler("on", context as never);
  await command.handler("off", context as never);

  assert.deepEqual(workingVisibility, [false, false]);
});

test("lowpower command toggles the runtime footer status", async () => {
  const { command, context, notifications, statusCalls, workingVisibility } = createLowPowerCommandHarness();

  await command.handler("", context as never);
  await command.handler("", context as never);

  assert.deepEqual(statusCalls, [
    ["codex-ui-lowpower", "Low power"],
    ["codex-ui-lowpower", undefined],
  ]);
  assert.deepEqual(notifications, [
    ["Low power: on", "info"],
    ["Low power: off", "info"],
  ]);
  assert.deepEqual(workingVisibility, [false, false]);
});

test("lowpower command supports idempotent on, off, and status arguments", async () => {
  const { command, context, notifications, registeredTools, statusCalls } = createLowPowerCommandHarness();

  await command.handler(" on ", context as never);
  await command.handler("ON", context as never);
  await command.handler("status", context as never);
  await command.handler("off", context as never);
  await command.handler("OFF", context as never);

  assert.deepEqual(statusCalls, [
    ["codex-ui-lowpower", "Low power"],
    ["codex-ui-lowpower", "Low power"],
    ["codex-ui-lowpower", undefined],
    ["codex-ui-lowpower", undefined],
  ]);
  assert.deepEqual(notifications, [
    ["Low power: on", "info"],
    ["Low power: on", "info"],
    ["Low power: on", "info"],
    ["Low power: off", "info"],
    ["Low power: off", "info"],
  ]);
  assert.equal(registeredTools.length, 4);
});

test("lowpower command rejects invalid arguments without changing mode", async () => {
  const { command, context, notifications, statusCalls, workingVisibility } = createLowPowerCommandHarness();

  await command.handler("on later", context as never);
  await command.handler("status", context as never);

  assert.deepEqual(statusCalls, []);
  assert.deepEqual(notifications, [
    ["Usage: /lowpower [on|off|status]", "error"],
    ["Low power: off", "info"],
  ]);
  assert.deepEqual(workingVisibility, []);
});

test("lowpower command completes only supported arguments", async () => {
  const { command } = createLowPowerCommandHarness();

  assert.equal(command.description, "Toggle low-power rendering for write, edit, and bash");
  assert.deepEqual(await command.getArgumentCompletions?.(""), [
    { value: "on", label: "on" },
    { value: "off", label: "off" },
    { value: "status", label: "status" },
  ]);
  assert.deepEqual(await command.getArgumentCompletions?.("o"), [
    { value: "on", label: "on" },
    { value: "off", label: "off" },
  ]);
  assert.deepEqual(await command.getArgumentCompletions?.("st"), [
    { value: "status", label: "status" },
  ]);
  assert.equal(await command.getArgumentCompletions?.("unknown"), null);
});

test("lowpower command affects newly rendered write calls without re-registering tools", async () => {
  const { command, context, registeredTools } = createLowPowerCommandHarness();
  const write = registeredTools.find((tool) => tool.name === "write");
  assert.ok(write?.renderCall);

  await command.handler("on", context as never);
  const args = {
    path: "src/new.ts",
    get content() {
      throw new Error("enabled low-power mode must not read write content");
    },
  };
  const component = write.renderCall(args, createTheme(), {
    args,
    state: {},
    lastComponent: undefined,
    cwd: "/repo/app",
    executionStarted: true,
    argsComplete: false,
    isPartial: true,
    expanded: false,
    showImages: true,
    isError: false,
    toolCallId: "write-1",
    invalidate() {},
  } as never);

  assert.equal(component.render(80).join("\n"), "• Write src/new.ts");
  assert.equal(registeredTools.length, 4);
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
    notify() {},
  };

  await sessionStart(
    { type: "session_start", reason: "startup" } as never,
    {
      mode: "tui",
      cwd: "/repo/app",
      model: { id: "gpt-test" },
      getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
      ui,
    } as never,
  );

  assert.deepEqual(calls.map((call) => call.name), [
    "status",
    "getTheme",
    "theme",
    "header",
    "editor",
    "footer",
    "title",
    "working-visible",
  ]);
  assert.deepEqual(calls[0]?.value, ["codex-ui-lowpower", undefined]);
  assert.equal(calls[1]?.value, CODEX_THEME_NAME);
  assert.equal(calls[2]?.value, profileTheme);
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

  const bash = registeredTools.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);
  const bashResult = bash.renderResult(
    { content: [{ type: "text", text: "hello" }], details: undefined },
    { expanded: false, isPartial: false },
    profileTheme,
    {
      args: { command: "echo hello" },
      state: {},
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
    } as never,
  );
  assert.match(bashResult.render(80).join("\n"), /ctrl\+shift\+o expand/u);

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

test("title spinner animates while working and is independent of low-power mode", async () => {
  vi.useFakeTimers();
  try {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
    const pi = {
      registerTool() {},
      registerCommand(name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) {
        commands.set(name, options);
      },
      registerMarkdownTransformer() {},
      on(event: string, handler: (...args: never[]) => unknown) {
        handlers.set(event, handler);
      },
    } as unknown as ExtensionAPI;
    codexUiExtension(pi);

    const titles: string[] = [];
    const context = {
      mode: "tui",
      cwd: "/repo/app",
      ui: {
        setTitle(title: string) {
          titles.push(title);
        },
        setStatus() {},
        setWorkingVisible() {},
        notify() {},
      },
    };
    const agentStart = handlers.get("agent_start");
    const agentSettled = handlers.get("agent_settled");
    const sessionShutdown = handlers.get("session_shutdown");
    const lowpower = commands.get("lowpower");
    assert.ok(agentStart);
    assert.ok(agentSettled);
    assert.ok(sessionShutdown);
    assert.ok(lowpower);

    await agentStart({ type: "agent_start" } as never, context as never);
    vi.advanceTimersByTime(1_000);
    await agentSettled({ type: "agent_settled" } as never, context as never);

    assert.deepEqual(titles, [
      "⠋ π Pi · Thinking.",
      "⠙ π Pi · Thinking..",
      "⠹ π Pi · Thinking...",
      "π · app",
    ]);
    vi.advanceTimersByTime(1_000);
    assert.equal(titles.length, 4);

    await lowpower.handler("on", context as never);
    await agentStart({ type: "agent_start" } as never, context as never);
    vi.advanceTimersByTime(500);
    await sessionShutdown({ type: "session_shutdown", reason: "reload" } as never, context as never);

    assert.deepEqual(titles.slice(4), [
      "⠋ π Pi · Thinking.",
      "⠙ π Pi · Thinking..",
      "π · app",
    ]);
    vi.advanceTimersByTime(1_000);
    assert.equal(titles.length, 7);
  } finally {
    vi.useRealTimers();
  }
});

test("session UI preserves an active Codex theme without replacing it", async () => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const pi = {
    registerTool() {},
    registerCommand() {},
    registerMarkdownTransformer() {},
    getThinkingLevel: () => "high",
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
        notify() {},
      },
    } as never,
  );

  assert.deepEqual(themeCalls, []);
});
