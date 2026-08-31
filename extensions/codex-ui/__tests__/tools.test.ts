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

const { highlightCodeMock, keyHintMock } = vi.hoisted(() => ({
  highlightCodeMock: vi.fn(),
  keyHintMock: vi.fn((keybinding: string, description: string) => `[${keybinding}] ${description}`),
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    highlightCode(...args: Parameters<typeof actual.highlightCode>) {
      highlightCodeMock(...args);
      return actual.highlightCode(...args);
    },
    keyHint: keyHintMock,
  };
});

import {
  parseDisplayDiff,
  parseUnifiedPatch,
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
  const getFgCode = (name: string) => name === "error"
    ? 196
    : name === "success"
      ? 82
      : name === "toolDiffContext"
        ? 189
        : name === "toolOutput"
          ? 250
          : name === "muted"
            ? 244
            : name === "dim"
              ? 240
              : 81;

  return {
    fg: (name: string, text: string) => `\x1b[38;5;${getFgCode(name)}m${text}\x1b[39m`,
    bg: (name: string, text: string) => `\x1b[48;5;${getBgCode(name)}m${text}\x1b[49m`,
    getFgAnsi: (name: string) => `\x1b[38;5;${getFgCode(name)}m`,
    getBgAnsi: (name: string) => `\x1b[48;5;${getBgCode(name)}m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  } as unknown as Theme;
}

const theme = createTheme();

afterEach(() => {
  vi.useRealTimers();
  highlightCodeMock.mockClear();
  keyHintMock.mockClear();
});

function createExtensionHarness(registered: ToolDefinition[] = []) {
  const handlers = new Map<string, Array<(event: Record<string, unknown>) => unknown>>();
  const pi = {
    registerTool(tool: ToolDefinition) {
      registered.push(tool);
    },
    on(event: string, handler: unknown) {
      const listeners = handlers.get(event) ?? [];
      listeners.push(handler as (event: Record<string, unknown>) => unknown);
      handlers.set(event, listeners);
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    registered,
    async emit(type: string, event: Record<string, unknown> = {}) {
      for (const handler of handlers.get(type) ?? []) {
        await handler({ type, ...event });
      }
    },
  };
}

function registerToolsForTest(
  registered: ToolDefinition[],
  factories?: CodexToolFactories,
  services?: Parameters<typeof registerCodexTools>[2],
) {
  const harness = createExtensionHarness(registered);
  registerCodexTools(harness.pi, factories, services);
  return harness;
}

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

test("display diff parser preserves markers, source indentation, and fallback hunk gaps", () => {
  assert.deepEqual(parseDisplayDiff("   9 a\n- 10   old value\n+ 10   new value\n+ 11 extra\n    ..."), [
    { kind: "context", lineNumber: 9, text: "a" },
    { kind: "removed", lineNumber: 10, text: "  old value" },
    { kind: "added", lineNumber: 10, text: "  new value" },
    { kind: "added", lineNumber: 11, text: "extra" },
    { kind: "hunk", lineNumber: undefined, text: "⋮" },
  ]);
});

test("unified patch parser uses old and new line numbers across hunks", () => {
  const parsed = parseUnifiedPatch(`--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
 first
-old second
+new second
@@ -10,2 +10,2 @@
 tenth
-old eleventh
+new eleventh
`);

  assert.deepEqual(
    parsed.map(({ kind, lineNumber }) => [kind, lineNumber]),
    [
      ["context", 1], ["removed", 2], ["added", 2],
      ["hunk", undefined],
      ["context", 10], ["removed", 11], ["added", 11],
    ],
  );
});

test("display diff renderer separates signs, highlights content, and fills changed rows", () => {
  const lines = renderDisplayDiff(
    parseDisplayDiff(" 1 a\n-2 old value\n+2 new value"),
    theme,
    24,
    "fixture.unknown",
  );
  const plainLines = lines.map((line) => stripTerminalSequences(line).trimEnd());

  assert.deepEqual(plainLines, [
    "    1   a",
    "    2 - old value",
    "    2 + new value",
  ]);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
  assert.equal(visibleWidth(lines[1] ?? ""), 24);
  assert.equal(visibleWidth(lines[2] ?? ""), 24);
  assert.ok((lines[1] ?? "").startsWith("\x1b[48;5;52m"));
  assert.ok((lines[2] ?? "").startsWith("\x1b[48;5;22m"));
  assert.ok((lines[1] ?? "").includes("\x1b[31m-\x1b[39m \x1b[2m"));
  assert.ok((lines[2] ?? "").includes("\x1b[32m+\x1b[39m "));
  assert.ok((lines[0] ?? "").includes("\x1b[38;5;189m"));
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
  registerToolsForTest(registered, factories);

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

test("read renderer moves the success marker to the call row and layers the line count", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const read = registered.find((tool) => tool.name === "read");
  assert.ok(read?.renderCall);
  assert.ok(read.renderResult);

  const args = { path: "src/app.ts", offset: 4, limit: 2 };
  const state = {};
  const call = read.renderCall(
    args,
    theme,
    createRenderContext({ args, state, isPartial: true }) as never,
  );
  assert.equal(
    stripTerminalSequences(call.render(80).join("\n")),
    "• Read src/app.ts (offset=4, limit=2)",
  );

  const result = read.renderResult(
    { content: [{ type: "text", text: "alpha\nbeta" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state }) as never,
  );

  const settledTitleAnsi = call.render(80).join("\n");
  const summaryAnsi = result.render(80).at(0) ?? "";
  assert.equal(
    stripTerminalSequences(settledTitleAnsi),
    "✓ Read src/app.ts (offset=4, limit=2)",
  );
  assert.ok(settledTitleAnsi.includes("\x1b[38;5;82m✓\x1b[39m"));
  assert.equal(stripTerminalSequences(summaryAnsi), "  2 lines");
  assert.ok(!summaryAnsi.includes("└"));
  assert.ok(summaryAnsi.includes("\x1b[38;5;250m\x1b[1m2\x1b[22m\x1b[39m"));
  assert.ok(summaryAnsi.includes("\x1b[38;5;240mlines\x1b[39m"));

  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderCall);
  const writeArgs = { path: "src/new.ts", content: "one\ntwo" };
  const writeCall = write.renderCall(
    writeArgs,
    theme,
    createRenderContext({ args: writeArgs }) as never,
  );
  assert.equal(
    stripTerminalSequences(writeCall.render(80).join("\n")),
    "• Write src/new.ts (2 lines)",
  );
});

test("read renderer preserves summary variants", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const read = registered.find((tool) => tool.name === "read");
  assert.ok(read?.renderResult);

  const renderSummary = (
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
    details: unknown = undefined,
  ) => read.renderResult?.(
    { content, details },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args: { path: "fixture.txt" }, state: {} }) as never,
  ).render(80).at(0) ?? "";

  assert.equal(stripTerminalSequences(renderSummary([
    { type: "text", text: "only" },
  ])), "  1 line");

  const truncated = renderSummary(
    [{ type: "text", text: "one\ntwo" }],
    { truncation: { truncated: true } },
  );
  assert.equal(stripTerminalSequences(truncated), "  2 lines · truncated");
  assert.ok(truncated.includes("\x1b[38;5;240m · truncated\x1b[39m"));

  const image = renderSummary([
    { type: "text", text: "Read image file [image/png]" },
    { type: "image", data: "base64", mimeType: "image/png" },
  ]);
  assert.equal(stripTerminalSequences(image), "  Image loaded");
  assert.ok(image.includes("\x1b[38;5;250mImage loaded\x1b[39m"));
});

test("read renderer keeps partial and error calls neutral", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const read = registered.find((tool) => tool.name === "read");
  assert.ok(read?.renderCall);
  assert.ok(read.renderResult);

  const args = { path: "src/app.ts" };
  const state = {};
  const call = read.renderCall(
    args,
    theme,
    createRenderContext({ args, state, isPartial: true }) as never,
  );
  call.render(80);

  const partial = read.renderResult(
    { content: [{ type: "text", text: "alpha" }], details: undefined },
    { expanded: false, isPartial: true },
    theme,
    createRenderContext({ args, state, isPartial: true }) as never,
  );
  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "• Read src/app.ts");
  assert.equal(stripTerminalSequences(partial.render(80).join("\n")), "  … Reading");

  const error = read.renderResult(
    { content: [{ type: "text", text: "Permission denied\nstack" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, isError: true }) as never,
  );
  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "• Read src/app.ts");
  assert.equal(stripTerminalSequences(error.render(80).join("\n")), "  ✗ Permission denied");
});

test("read renderer preserves expanded output and fits narrow widths", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const read = registered.find((tool) => tool.name === "read");
  assert.ok(read?.renderCall);
  assert.ok(read.renderResult);

  const args = { path: "a/very/long/path/to/a/fixture.txt" };
  const state = {};
  const call = read.renderCall(
    args,
    theme,
    createRenderContext({ args, state, isPartial: true }) as never,
  );
  const content = Array.from({ length: 42 }, (_, index) => `line ${index + 1}`).join("\n");
  const result = read.renderResult(
    { content: [{ type: "text", text: content }], details: undefined },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state }) as never,
  );

  const lines = result.render(80).map((line) => stripTerminalSequences(line));
  assert.equal(lines.length, 42);
  assert.equal(lines[0], "  42 lines");
  assert.equal(lines[1], "    line 1");
  assert.equal(lines[40], "    line 40");
  assert.equal(lines[41], "    … 2 more lines");

  for (const width of [1, 2, 8, 20]) {
    const narrowLines = [...call.render(width), ...result.render(width)];
    assert.ok(narrowLines.every((line) => visibleWidth(line) <= width));
  }
  assert.deepEqual(call.render(0), []);
  assert.deepEqual(result.render(0), []);
});

test("edit renderer refreshes its title and renders the patch with Codex styling", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderCall);
  assert.ok(edit.renderResult);

  const args = {
    path: "src/app.ts",
    edits: [{ oldText: "old", newText: "new\nextra" }],
  };
  const state = {};
  const callContext = createRenderContext({ args, state });
  const call = edit.renderCall(args, theme, callContext as never);
  assert.equal(stripTerminalSequences(call.render(60).join("\n")), "• Edit src/app.ts");

  const resultContext = createRenderContext({ args, state });
  const result = edit.renderResult(
    {
      content: [{ type: "text", text: "Successfully replaced 1 block." }],
      details: {
        diff: " 1 before\n-2 old\n+2 new\n+3 extra",
        patch: `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,3 @@
 before
-old
+new
+extra
`,
      },
    },
    { expanded: true, isPartial: false },
    theme,
    resultContext as never,
  );

  const titleAnsi = call.render(60).join("\n");
  const title = stripTerminalSequences(titleAnsi);
  const diffLines = result.render(40);
  const plainDiff = diffLines.map((line) => stripTerminalSequences(line).trimEnd());

  assert.equal(title, "• Edited src/app.ts (+2 -1)");
  assert.ok(titleAnsi.includes("\x1b[32m+2\x1b[39m"));
  assert.ok(titleAnsi.includes("\x1b[31m-1\x1b[39m"));
  assert.ok(!titleAnsi.includes("\x1b[38;5;81msrc/app.ts"));
  assert.deepEqual(plainDiff, [
    "    1   before",
    "    2 - old",
    "    2 + new",
    "    3 + extra",
  ]);
  assert.ok(diffLines.every((line) => visibleWidth(line) <= 40));
});

test("collapsed edit diff separates and fills its hidden-lines footer", () => {
  for (const [totalLines, hiddenLabel] of [
    [13, "1 line"],
    [14, "2 lines"],
  ] as const) {
    const registered: ToolDefinition[] = [];
    registerToolsForTest(registered);
    const edit = registered.find((tool) => tool.name === "edit");
    assert.ok(edit?.renderResult);

    const patchLines = Array.from({ length: totalLines }, (_, index) => ` line ${index + 1}`);
    const component = edit.renderResult(
      {
        content: [{ type: "text", text: "Successfully replaced 1 block." }],
        details: {
          patch: [
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            `@@ -1,${totalLines} +1,${totalLines} @@`,
            ...patchLines,
            "",
          ].join("\n"),
        },
      },
      { expanded: false, isPartial: false },
      theme,
      createRenderContext({ args: { path: "src/app.ts", edits: [] } }) as never,
    );

    const lines = component.render(48);
    const footer = lines.at(-1) ?? "";
    const plainFooter = stripTerminalSequences(footer);

    assert.equal(stripTerminalSequences(lines.at(-2) ?? ""), "");
    assert.match(plainFooter, new RegExp(`^    ── ${hiddenLabel} hidden ─+$`, "u"));
    assert.equal(visibleWidth(footer), 48);
    assert.ok(footer.startsWith("\x1b[2m"));
    assert.ok(footer.endsWith("\x1b[22m"));

    const narrowFooter = component.render(10).at(-1) ?? "";
    assert.equal(visibleWidth(narrowFooter), 10);
  }
});

test("settled edit history reuses prepared syntax highlighting", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderResult);

  const args = { path: "src/app.ts", edits: [{ oldText: "old", newText: "new" }] };
  const details = {
    diff: "-1 old\n+1 new",
    patch: `--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new
`,
  };
  const result = {
    content: [{ type: "text", text: "Successfully replaced 1 block." }],
    details,
  };
  const state = {};
  const component = edit.renderResult(
    result,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, executionStarted: false }) as never,
  );
  component.render(80);
  const callsAfterFirstRender = highlightCodeMock.mock.calls.length;
  assert.ok(callsAfterFirstRender > 0);

  component.invalidate();
  edit.renderResult(
    result,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({
      args,
      state,
      lastComponent: component,
      executionStarted: false,
    }) as never,
  ).render(80);

  assert.equal(highlightCodeMock.mock.calls.length, callsAfterFirstRender);
});

test("write renderer reports a compact summary without inventing a diff", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
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
  registerToolsForTest(registered);
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
  invalidate.mockImplementation(() => call.invalidate());

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

test("bash renderer shares one refresh timer across concurrent executions", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(0));

  const harness = createExtensionHarness();
  registerCodexTools(harness.pi);
  const bash = harness.registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);

  const firstInvalidate = vi.fn();
  const secondInvalidate = vi.fn();
  const firstArgs = { command: "sleep 10" };
  const secondArgs = { command: "sleep 20" };
  const firstState = {};
  const secondState = {};

  bash.renderCall(
    firstArgs,
    theme,
    createRenderContext({
      args: firstArgs,
      state: firstState,
      toolCallId: "bash-1",
      invalidate: firstInvalidate,
      executionStarted: true,
      isPartial: true,
    }) as never,
  );
  bash.renderCall(
    secondArgs,
    theme,
    createRenderContext({
      args: secondArgs,
      state: secondState,
      toolCallId: "bash-2",
      invalidate: secondInvalidate,
      executionStarted: true,
      isPartial: true,
    }) as never,
  );

  assert.equal(vi.getTimerCount(), 1);
  vi.advanceTimersByTime(1000);
  assert.equal(firstInvalidate.mock.calls.length, 1);
  assert.equal(secondInvalidate.mock.calls.length, 1);

  bash.renderCall(
    firstArgs,
    theme,
    createRenderContext({
      args: firstArgs,
      state: firstState,
      toolCallId: "bash-1",
      invalidate: firstInvalidate,
      executionStarted: true,
      isPartial: false,
    }) as never,
  );
  assert.equal(vi.getTimerCount(), 1);

  bash.renderCall(
    secondArgs,
    theme,
    createRenderContext({
      args: secondArgs,
      state: secondState,
      toolCallId: "bash-2",
      invalidate: secondInvalidate,
      executionStarted: true,
      isPartial: false,
    }) as never,
  );
  assert.equal(vi.getTimerCount(), 0);
});

test("bash refresh scheduler cleans up on lifecycle events and ignores restored rows", async () => {
  vi.useFakeTimers();

  const harness = createExtensionHarness();
  registerCodexTools(harness.pi);
  const bash = harness.registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);

  const args = { command: "sleep 10" };
  bash.renderCall(
    args,
    theme,
    createRenderContext({
      args,
      state: {},
      toolCallId: "bash-active",
      executionStarted: true,
      isPartial: true,
    }) as never,
  );
  assert.equal(vi.getTimerCount(), 1);

  await harness.emit("tool_execution_end", {
    toolCallId: "read-1",
    toolName: "read",
    result: {},
    isError: false,
  });
  assert.equal(vi.getTimerCount(), 1);

  await harness.emit("tool_execution_end", {
    toolCallId: "bash-active",
    toolName: "bash",
    result: {},
    isError: true,
  });
  assert.equal(vi.getTimerCount(), 0);

  bash.renderCall(
    args,
    theme,
    createRenderContext({
      args,
      state: {},
      toolCallId: "bash-next",
      executionStarted: true,
      isPartial: true,
    }) as never,
  );
  assert.equal(vi.getTimerCount(), 1);

  await harness.emit("session_shutdown", { reason: "reload" });
  assert.equal(vi.getTimerCount(), 0);

  bash.renderCall(
    args,
    theme,
    createRenderContext({
      args,
      state: {},
      toolCallId: "bash-restored",
      executionStarted: false,
      isPartial: true,
    }) as never,
  );
  assert.equal(vi.getTimerCount(), 0);
});

test("bash renderer reuses prepared output until the result revision changes", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  let textReads = 0;
  const content = [{
    type: "text",
    get text() {
      textReads += 1;
      return "first\nsecond";
    },
  }];
  const result = { content, details: undefined };
  const state = {};
  const context = createRenderContext({ args: { command: "printf test" }, state });
  const component = bash.renderResult(
    result,
    { expanded: false, isPartial: true },
    theme,
    context as never,
  );
  component.render(80);
  const readsAfterFirstRender = textReads;
  assert.ok(readsAfterFirstRender > 0);

  component.invalidate();
  const rerendered = bash.renderResult(
    result,
    { expanded: true, isPartial: true },
    theme,
    createRenderContext({
      args: { command: "printf test" },
      state,
      lastComponent: component,
      isPartial: true,
    }) as never,
  );
  rerendered.render(60);

  assert.equal(rerendered, component);
  assert.equal(textReads, readsAfterFirstRender);

  bash.renderResult(
    result,
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({
      args: { command: "printf test" },
      state,
      lastComponent: component,
      isPartial: false,
    }) as never,
  ).render(60);
  assert.ok(textReads > readsAfterFirstRender);

  let updatedTextReads = 0;
  const updatedResult = {
    content: [{
      type: "text",
      get text() {
        updatedTextReads += 1;
        return "first\nsecond\nthird";
      },
    }],
    details: undefined,
  };
  bash.renderResult(
    updatedResult,
    { expanded: true, isPartial: true },
    theme,
    createRenderContext({
      args: { command: "printf test" },
      state,
      lastComponent: component,
      isPartial: true,
    }) as never,
  ).render(60);

  assert.ok(updatedTextReads > 0);
});

test("settled bash history avoids output preprocessing on hot frames", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  let textReads = 0;
  const largeOutput = `${"x".repeat(50 * 1024 - 20)}\ncomplete`;
  const rows = Array.from({ length: 100 }, (_, index) => {
    const content = [{
      type: "text",
      get text() {
        textReads += 1;
        return largeOutput;
      },
    }];
    const result = { content, details: undefined };
    const state = {};
    const component = bash.renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      createRenderContext({
        args: { command: `printf row-${index}` },
        state,
        toolCallId: `bash-history-${index}`,
        executionStarted: false,
      }) as never,
    );
    component.render(120);
    return { component, result, state, index };
  });
  const readsAfterColdFrame = textReads;
  assert.ok(readsAfterColdFrame > 0);

  for (const row of rows) {
    row.component.invalidate();
    bash.renderResult(
      row.result,
      { expanded: false, isPartial: false },
      theme,
      createRenderContext({
        args: { command: `printf row-${row.index}` },
        state: row.state,
        lastComponent: row.component,
        toolCallId: `bash-history-${row.index}`,
        executionStarted: false,
      }) as never,
    ).render(120);
  }

  assert.equal(textReads, readsAfterColdFrame);
});

test("bash renderer keeps a five visual-line tail and falls back to the global expand hint", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
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
  registerToolsForTest(
    registered,
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
  registerToolsForTest(registered);
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
  registerToolsForTest(registered);
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
  registerToolsForTest(registered);
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
  registerToolsForTest(registered);
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
  registerToolsForTest(registered);
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
