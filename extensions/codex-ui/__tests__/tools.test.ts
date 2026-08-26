import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  initTheme,
  ToolExecutionComponent,
  type ExtensionAPI,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

const { keyHintMock } = vi.hoisted(() => ({
  keyHintMock: vi.fn((keybinding: string, description: string) => `[${keybinding}] ${description}`),
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, keyHint: keyHintMock };
});

import {
  parseDisplayDiff,
  registerCodexTools,
  renderDisplayDiff,
  type CodexToolFactories,
} from "../src/tools.js";

function createTheme(): Theme {
  const getBgCode = (name: string) => name === "toolErrorBg"
    ? 52
    : name === "toolPendingBg"
      ? 236
      : 22;

  return {
    fg: (name: string, text: string) => {
      const code = name === "error" ? 196 : name === "success" ? 82 : 81;
      return `\x1b[38;5;${code}m${text}\x1b[39m`;
    },
    bg: (name: string, text: string) => `\x1b[48;5;${getBgCode(name)}m${text}\x1b[49m`,
    getBgAnsi: (name: string) => `\x1b[48;5;${getBgCode(name)}m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  } as unknown as Theme;
}

const theme = createTheme();

afterEach(() => {
  vi.useRealTimers();
  keyHintMock.mockClear();
});

function createRenderContext(overrides: Record<string, unknown> = {}) {
  return {
    args: {},
    state: {},
    lastComponent: undefined,
    cwd: "/repo",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: true,
    showImages: true,
    isError: false,
    toolCallId: "tool-1",
    invalidate() {},
    ...overrides,
  };
}

test("display diff parser preserves markers, padded line numbers, and source indentation", () => {
  assert.deepEqual(parseDisplayDiff("   9 a\n- 10   old value\n+ 10   new value\n+ 11 extra\n    ..."), [
    { kind: "context", lineNumber: 9, text: "a" },
    { kind: "removed", lineNumber: 10, text: "  old value" },
    { kind: "added", lineNumber: 10, text: "  new value" },
    { kind: "added", lineNumber: 11, text: "extra" },
    { kind: "context", lineNumber: undefined, text: "..." },
  ]);
});

test("display diff renderer applies full-cell backgrounds within the width", () => {
  const lines = renderDisplayDiff(
    parseDisplayDiff(" 1 a\n-2 old value\n+2 new value"),
    theme,
    24,
  );

  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
  assert.equal(visibleWidth(lines[1] ?? ""), 24);
  assert.equal(visibleWidth(lines[2] ?? ""), 24);
  assert.ok((lines[1] ?? "").startsWith("\x1b[48;5;52m"));
  assert.ok((lines[2] ?? "").startsWith("\x1b[48;5;22m"));
});

test("tool overrides retain metadata and delegate execution using context cwd", async () => {
  const created: Array<{ name: string; cwd: string }> = [];
  const executed: Array<{ name: string; cwd: string }> = [];
  const delegated: Array<{
    toolCallId: unknown;
    params: unknown;
    signal: unknown;
    onUpdate: unknown;
    context: unknown;
  }> = [];

  const factory = (name: string) => (cwd: string) => {
    created.push({ name, cwd });
    return {
      name,
      label: name,
      description: `${name} description`,
      promptSnippet: `${name} snippet`,
      promptGuidelines: [`Use ${name}.`],
      constrainedSampling: { mode: "strict" },
      parameters: {},
      renderShell: name === "bash" ? "default" : undefined,
      prepareArguments: name === "edit" ? (args: unknown) => args : undefined,
      async execute(
        toolCallId: unknown,
        params: unknown,
        signal: unknown,
        onUpdate: unknown,
        context: unknown,
      ) {
        executed.push({ name, cwd });
        delegated.push({ toolCallId, params, signal, onUpdate, context });
        return { content: [{ type: "text", text: "ok" }], details: undefined };
      },
    };
  };

  const factories = {
    read: factory("read"),
    edit: factory("edit"),
    write: factory("write"),
    bash: factory("bash"),
  } as unknown as CodexToolFactories;
  const registered: ToolDefinition[] = [];
  const pi = {
    registerTool(tool: ToolDefinition) {
      registered.push(tool);
    },
  } as unknown as ExtensionAPI;

  registerCodexTools(pi, factories);

  assert.deepEqual(registered.map((tool) => tool.name), ["read", "edit", "write", "bash"]);
  for (const tool of registered) {
    assert.equal(tool.promptSnippet, `${tool.name} snippet`);
    assert.deepEqual(tool.promptGuidelines, [`Use ${tool.name}.`]);
    assert.deepEqual(tool.constrainedSampling, { mode: "strict" });
  }
  for (const name of ["read", "edit", "write"]) {
    assert.equal(registered.find((tool) => tool.name === name)?.renderShell, "self");
  }
  assert.equal(registered.find((tool) => tool.name === "bash")?.renderShell, "default");
  assert.equal(typeof registered.find((tool) => tool.name === "edit")?.prepareArguments, "function");

  const read = registered.find((tool) => tool.name === "read");
  assert.ok(read);
  await read.execute(
    "tool-1",
    { path: "README.md" },
    undefined,
    undefined,
    { cwd: "/workspace" } as never,
  );

  assert.ok(created.some((item) => item.name === "read" && item.cwd === "/workspace"));
  assert.deepEqual(executed.at(-1), { name: "read", cwd: "/workspace" });

  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash);
  const params = { command: "pwd", timeout: 30 };
  const controller = new AbortController();
  const onUpdate = vi.fn();
  const context = { cwd: "/other-workspace" };
  await bash.execute(
    "tool-2",
    params,
    controller.signal,
    onUpdate,
    context as never,
  );

  assert.ok(created.some((item) => item.name === "bash" && item.cwd === "/other-workspace"));
  assert.deepEqual(executed.at(-1), { name: "bash", cwd: "/other-workspace" });
  assert.equal(delegated.at(-1)?.toolCallId, "tool-2");
  assert.equal(delegated.at(-1)?.params, params);
  assert.equal(delegated.at(-1)?.signal, controller.signal);
  assert.equal(delegated.at(-1)?.onUpdate, onUpdate);
  assert.equal(delegated.at(-1)?.context, context);
});

test("edit renderer updates its title and renders the real result diff", () => {
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI);
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderCall);
  assert.ok(edit.renderResult);

  const args = {
    path: "src/app.ts",
    edits: [{ oldText: "old", newText: "new" }],
  };
  const state = {};
  const callContext = createRenderContext({ args, state });
  const call = edit.renderCall(args, theme, callContext as never);
  const resultContext = createRenderContext({ args, state });
  const result = edit.renderResult(
    {
      content: [{ type: "text", text: "Successfully replaced 1 block." }],
      details: { diff: " 1 before\n-2 old\n+2 new\n+3 extra", patch: "" },
    },
    { expanded: true, isPartial: false },
    theme,
    resultContext as never,
  );

  const title = stripTerminalSequences(call.render(60).join("\n"));
  const diffLines = result.render(32);

  assert.match(title, /Edited src\/app\.ts/u);
  assert.match(title, /\+2/u);
  assert.match(title, /−1/u);
  assert.ok(diffLines.some((line) => stripTerminalSequences(line).includes("old")));
  assert.ok(diffLines.some((line) => stripTerminalSequences(line).includes("new")));
  assert.ok(diffLines.every((line) => visibleWidth(line) <= 32));
});

test("write renderer reports a compact summary without inventing a diff", () => {
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI);
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderResult);

  const args = { path: "src/new.ts", content: "one\ntwo" };
  const component = write.renderResult(
    { content: [{ type: "text", text: "Successfully wrote 7 bytes" }], details: undefined },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args }) as never,
  );
  const output = stripTerminalSequences(component.render(60).join("\n"));

  assert.match(output, /Written · 2 lines · 7 B/u);
  assert.ok(!output.includes("diff"));
  assert.ok(!output.includes("+one"));
});

test("bash renderer shares running and completed state with the command receipt", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(0));

  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);
  assert.ok(bash.renderResult);
  assert.notEqual(bash.renderShell, "self");

  const args = { command: "printf 'hello\\n'", timeout: 30 };
  const state = {};
  const invalidate = vi.fn();
  const call = bash.renderCall(
    args,
    theme,
    createRenderContext({ args, state, invalidate, executionStarted: true, isPartial: true }) as never,
  );
  const partial = bash.renderResult(
    { content: [{ type: "text", text: "hello" }], details: undefined },
    { expanded: false, isPartial: true },
    theme,
    createRenderContext({ args, state, invalidate, isPartial: true }) as never,
  );

  const runningLines = call.render(60);
  assert.match(stripTerminalSequences(runningLines.join("\n")), /Bash running/u);
  assert.match(stripTerminalSequences(runningLines.join("\n")), /30s limit/u);
  assert.equal(stripTerminalSequences(runningLines[1] ?? "").trim(), "");
  assert.match(stripTerminalSequences(runningLines[2] ?? ""), /▌ \$ printf 'hello\\n'/u);
  assert.match(stripTerminalSequences(partial.render(60).join("\n")), /hello/u);
  assert.ok(runningLines.some((line) => line.startsWith("\x1b[48;5;236m")));

  vi.advanceTimersByTime(1250);
  assert.ok(invalidate.mock.calls.length >= 1);
  assert.match(stripTerminalSequences(call.render(60).join("\n")), /1\.3s/u);

  bash.renderCall(
    args,
    theme,
    createRenderContext({ args, state, invalidate, executionStarted: true, isPartial: false }) as never,
  );
  const completed = bash.renderResult(
    { content: [{ type: "text", text: "hello" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, invalidate, lastComponent: partial }) as never,
  );
  const completedLines = call.render(60);
  const summary = stripTerminalSequences(completedLines.join("\n"));

  assert.match(summary, /✓ Bash completed/u);
  assert.match(summary, /1\.3s · 30s limit/u);
  assert.ok((completedLines.at(-1) ?? "").endsWith("\x1b[48;5;22m"));
  assert.equal(completed, partial);
  assert.equal(vi.getTimerCount(), 0);
});

test("bash renderer keeps a five visual-line tail and falls back to the global expand hint", () => {
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  const args = { command: "seq 12" };
  const state = {};
  const output = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
  const collapsed = bash.renderResult(
    { content: [{ type: "text", text: output }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, executionStarted: false }) as never,
  );
  const collapsedText = stripTerminalSequences(collapsed.render(80).join("\n"));

  assert.ok(!collapsedText.includes("line 7\n"));
  assert.match(collapsedText, /line 8/u);
  assert.match(collapsedText, /line 12/u);
  assert.match(collapsedText, /7 earlier visual lines hidden/u);
  assert.match(collapsedText, /\[app\.tools\.expand\] expand/u);
  assert.deepEqual(keyHintMock.mock.calls.at(-1), ["app.tools.expand", "expand"]);

  const expanded = bash.renderResult(
    { content: [{ type: "text", text: output }], details: undefined },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, executionStarted: false, lastComponent: collapsed }) as never,
  );
  const expandedText = stripTerminalSequences(expanded.render(80).join("\n"));

  assert.match(expandedText, /line 1/u);
  assert.match(expandedText, /12 visual lines/u);
  assert.match(expandedText, /\[app\.tools\.expand\] collapse/u);
  assert.deepEqual(keyHintMock.mock.calls.at(-1), ["app.tools.expand", "collapse"]);
});

test("bash renderer uses keybindings injected by the host editor", () => {
  const registered: ToolDefinition[] = [];
  const getKeys = vi.fn(() => ["alt+x"]);
  registerCodexTools(
    { registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI,
    undefined,
    { getKeybindings: () => ({ getKeys } as never) },
  );
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  const component = bash.renderResult(
    { content: [{ type: "text", text: "hello" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args: { command: "echo hello" }, executionStarted: false }) as never,
  );
  const output = stripTerminalSequences(component.render(80).join("\n"));
  const expectedKey = process.platform === "darwin" ? "option+x" : "alt+x";

  assert.ok(output.includes(`${expectedKey} expand`));
  assert.deepEqual(getKeys.mock.calls, [["app.tools.expand"]]);
  assert.equal(keyHintMock.mock.calls.length, 0);
});

test("bash result appears once when composed by the host tool component", () => {
  initTheme("dark");
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash);

  const component = new ToolExecutionComponent(
    "bash",
    "tool-1",
    { command: "echo hello" },
    undefined,
    bash,
    { requestRender: vi.fn() } as never,
    "/repo",
  );
  component.markExecutionStarted();
  component.updateResult({
    content: [{ type: "text", text: "hello" }],
    details: undefined,
    isError: false,
  });

  const renderedLines = component.render(80);
  const output = stripTerminalSequences(renderedLines.join("\n"));
  const commandLine = renderedLines.find((line) => stripTerminalSequences(line).includes("$ echo hello"));
  assert.ok(commandLine);
  assert.match(commandLine, /\x1b\[48;[\d;]+m \x1b\[49m$/u);
  assert.equal(output.split("hello").length - 1, 2);
  assert.equal(output.split("1 visual line").length - 1, 1);
});

test("edit result appears once when composed by the host tool component", () => {
  initTheme("dark");
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI);
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit);

  const component = new ToolExecutionComponent(
    "edit",
    "tool-1",
    { path: "src/app.ts", edits: [{ oldText: "old value", newText: "new value" }] },
    undefined,
    edit,
    { requestRender: vi.fn() } as never,
    "/repo",
  );
  component.markExecutionStarted();
  component.updateResult({
    content: [{ type: "text", text: "Successfully replaced 1 block." }],
    details: { diff: "-1 old value\n+1 new value", patch: "" },
    isError: false,
  });

  const output = stripTerminalSequences(component.render(80).join("\n"));
  assert.equal(output.split("old value").length - 1, 1);
  assert.equal(output.split("new value").length - 1, 1);
});

test("bash renderer preserves truncation details without duplicating the execution footer", () => {
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  const fullOutputPath = "/tmp/pi-bash-output.log";
  const executionFooter = `[Showing lines 8-12 of 12. Full output: ${fullOutputPath}]`;
  const component = bash.renderResult(
    {
      content: [{ type: "text", text: `line 8\nline 9\nline 10\nline 11\nline 12\n\n${executionFooter}` }],
      details: {
        fullOutputPath,
        truncation: {
          content: "line 8\nline 9\nline 10\nline 11\nline 12",
          truncated: true,
          truncatedBy: "lines",
          totalLines: 12,
          totalBytes: 87,
          outputLines: 5,
          outputBytes: 35,
          lastLinePartial: false,
          firstLineExceedsLimit: false,
          maxLines: 5,
          maxBytes: 51200,
        },
      },
    },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args: { command: "seq 12" }, executionStarted: false }) as never,
  );
  const output = stripTerminalSequences(component.render(100).join("\n"));

  assert.ok(!output.includes(executionFooter));
  assert.match(output, /Full output: \/tmp\/pi-bash-output\.log/u);
  assert.match(output, /Truncated: showing 5 of 12 lines/u);
  assert.equal(output.split(fullOutputPath).length - 1, 1);
});

test("bash renderer reports errors and omits invented duration for restored rows", () => {
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);
  assert.ok(bash.renderResult);

  const args = { command: "sleep 30", timeout: 2 };
  const state = {};
  const invalidate = vi.fn();
  const call = bash.renderCall(
    args,
    theme,
    createRenderContext({ args, state, invalidate, executionStarted: false, isPartial: true }) as never,
  );
  bash.renderCall(
    args,
    theme,
    createRenderContext({
      args,
      state,
      invalidate,
      executionStarted: false,
      isPartial: false,
      isError: true,
    }) as never,
  );
  const result = bash.renderResult(
    { content: [{ type: "text", text: "Command timed out after 2 seconds" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, invalidate, executionStarted: false, isError: true }) as never,
  );
  const summary = stripTerminalSequences(call.render(60).join("\n"));
  const output = stripTerminalSequences(result.render(60).join("\n"));

  assert.match(summary, /✗ Bash failed/u);
  assert.match(summary, /2s limit/u);
  assert.doesNotMatch(summary, /\d+\.\d+s/u);
  assert.match(output, /Command timed out after 2 seconds/u);
});

test("bash renderer strips terminal controls and never exceeds narrow widths", () => {
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool) } as ExtensionAPI);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);
  assert.ok(bash.renderResult);

  const args = { command: "printf 'a very long command that wraps across the receipt'" };
  const state = {};
  const call = bash.renderCall(
    args,
    theme,
    createRenderContext({ args, state, executionStarted: false }) as never,
  );
  const result = bash.renderResult(
    { content: [{ type: "text", text: "\x1b[31mred\x1b[0m\r\nsafe\u0000text with a long suffix" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, executionStarted: false }) as never,
  );

  for (const width of [1, 2, 8, 20]) {
    const lines = [...call.render(width), ...result.render(width)];
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
  }

  const output = stripTerminalSequences(result.render(40).join("\n"));
  assert.match(output, /red/u);
  assert.match(output, /safetext/u);
  assert.ok(!output.includes("\r"));
  assert.ok(!output.includes("\u0000"));
});
