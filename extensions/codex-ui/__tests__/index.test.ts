import assert from "node:assert/strict";
import { test } from "vitest";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

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

test("markdown transformer prefixes only user messages and remains idempotent", () => {
  const transformers: Array<(markdown: string, context: Record<string, unknown>) => string> = [];
  const pi = {
    registerTool() {},
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
  assert.equal(transform("thought", { messageType: "assistant-thinking" }), "thought");
});

test("session UI installs only in TUI mode", async () => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const pi = {
    registerTool() {},
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
    setWorkingIndicator(value: unknown) {
      calls.push({ name: "working", value });
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
    "getTheme",
    "theme",
    "header",
    "editor",
    "footer",
    "title",
    "working",
  ]);
  assert.equal(calls[0]?.value, CODEX_THEME_NAME);
  assert.equal(calls[1]?.value, profileTheme);
  assert.match(String(calls.find((call) => call.name === "title")?.value), /^π · app$/u);

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
        setWorkingIndicator() {},
        notify() {},
      },
    } as never,
  );

  assert.deepEqual(themeCalls, []);
});
