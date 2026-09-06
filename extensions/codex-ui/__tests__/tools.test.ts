import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  initTheme,
  ToolExecutionComponent,
  type ExtensionAPI,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const {
  highlightCodeMock,
  keyHintMock,
  truncateToWidthMock,
  wrapTextWithAnsiMock,
} = vi.hoisted(() => ({
  highlightCodeMock: vi.fn(),
  keyHintMock: vi.fn((keybinding: string, description: string) => `[${keybinding}] ${description}`),
  truncateToWidthMock: vi.fn(),
  wrapTextWithAnsiMock: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    highlightCode(...args: Parameters<typeof actual.highlightCode>) {
      return highlightCodeMock(...args) ?? actual.highlightCode(...args);
    },
    keyHint: keyHintMock,
  };
});

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return {
    ...actual,
    truncateToWidth(...args: Parameters<typeof actual.truncateToWidth>) {
      truncateToWidthMock(...args);
      return actual.truncateToWidth(...args);
    },
    wrapTextWithAnsi(...args: Parameters<typeof actual.wrapTextWithAnsi>) {
      wrapTextWithAnsiMock(...args);
      return actual.wrapTextWithAnsi(...args);
    },
  };
});

import {
  getDisplayLineNumberWidth,
  parseDisplayDiff,
  parseUnifiedPatch,
  registerCodexTools,
  renderDisplayDiff,
  type CodexToolFactories,
} from "../src/tools.js";
import { fitToWidth } from "../src/layout.js";
import { ToolRenderCache } from "../src/render-cache.js";

function createTheme(codeOffset = 0): Theme {
  const getBgCode = (name: string) => (name === "toolErrorBg"
    ? 52
    : name === "toolPendingBg"
      ? 236
      : 22) + codeOffset;
  const getFgCode = (name: string) => (name === "error"
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
              : 81) + codeOffset;

  return {
    fg: (name: string, text: string) => `\x1b[38;5;${getFgCode(name)}m${text}\x1b[39m`,
    bg: (name: string, text: string) => `\x1b[48;5;${getBgCode(name)}m${text}\x1b[49m`,
    getFgAnsi: (name: string) => `\x1b[38;5;${getFgCode(name)}m`,
    getBgAnsi: (name: string) => `\x1b[48;5;${getBgCode(name)}m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  } as unknown as Theme;
}

function createMutableThemeProxy(initialBackend: Theme): {
  theme: Theme;
  setBackend: (nextBackend: Theme) => void;
} {
  let backend = initialBackend;
  return {
    theme: new Proxy({} as Theme, {
      get(_target, property) {
        const value = Reflect.get(backend as object, property, backend);
        return typeof value === "function" ? value.bind(backend) : value;
      },
    }),
    setBackend(nextBackend) {
      backend = nextBackend;
    },
  };
}

const theme = createTheme();

afterEach(() => {
  vi.useRealTimers();
  highlightCodeMock.mockClear();
  keyHintMock.mockClear();
  truncateToWidthMock.mockClear();
  wrapTextWithAnsiMock.mockClear();
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

test("write streams without counts and restores final counts before argsComplete", () => {
  initTheme("dark", false);
  for (const lowPower of [false, true]) {
    const registered: ToolDefinition[] = [];
    registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => lowPower });
    const write = registered.find(tool => tool.name === "write")!;
    const row = new ToolExecutionComponent("write", `stream-${lowPower}`, { path: "src/new.ts", content: "" },
      { showImages: false }, write, { requestRender() {} }, "/repo");
    for (const count of [0, 3, 10, 20]) {
      row.updateArgs({ path: "src/new.ts", content: Array.from({ length: count }, () => "text").join("\n") });
      assert.deepEqual(row.render(80).map(stripTerminalSequences).filter(Boolean), ["• Write src/new.ts"]);
    }
    row.updateResult({ content: [{ type: "text", text: "Successfully wrote file." }], isError: false });
    assert.deepEqual(row.render(80).map(stripTerminalSequences).filter(Boolean), ["• Write src/new.ts (20 lines)"]);
    row.setExpanded(true);
    assert.deepEqual(row.render(80).map(stripTerminalSequences).filter(Boolean), ["• Write src/new.ts (20 lines)"]);
  }
});

test("write keeps completed malformed arguments inside the host fallback boundary", () => {
  initTheme("dark", false);
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find(tool => tool.name === "write")!;
  for (const content of [undefined, null, 123, {}, []]) {
    const row = new ToolExecutionComponent("write", "invalid", { path: "src/new.ts", content },
      { showImages: false }, write, { requestRender() {} }, "/repo");
    row.setArgsComplete();
    assert.deepEqual(row.render(80).map(line => stripTerminalSequences(line).trimEnd()).filter(Boolean), ["write"]);
    row.updateResult({ content: [{ type: "text", text: "Invalid arguments" }], isError: true });
    assert.match(row.render(80).map(stripTerminalSequences).join("\n"), /Invalid arguments/u);
    assert.doesNotMatch(row.render(80).map(stripTerminalSequences).join("\n"), /0 lines/u);
  }
});

test("write scans final content once and colors pending, success and failure markers", () => {
  for (const lowPower of [false, true]) {
    const registered: ToolDefinition[] = [];
    registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => lowPower });
    const write = registered.find(tool => tool.name === "write")!;
    const args = { path: "中文🙂.ts", content: "WRITE-BODY\none\ntwo\n" };
    const state = {};
    const context = createRenderContext({ args, state, argsComplete: false, isPartial: true });
    const search = vi.spyOn(String.prototype, "indexOf");
    const bytes = vi.spyOn(Buffer, "byteLength");
    try {
      let call = write.renderCall!(args, theme, context as never);
      const scanned = () => search.mock.contexts.filter(value => String(value) === args.content).length;
      for (const width of [0, 1, 2, 24, 60, 120]) call.render(width);
      assert.equal(scanned(), 0);
      assert.ok(call.render(120)[0]!.includes(theme.fg("warning", "•")));
      for (let index = 0; index < 3; index++) {
        call = write.renderCall!(args, theme, { ...context, lastComponent: call, isPartial: false } as never);
        write.renderResult!({ content: [], details: undefined }, { expanded: index % 2 === 0, isPartial: false }, theme,
          { ...context, isPartial: false } as never);
        for (const width of [0, 1, 2, 24, 60, 120]) {
          assert.ok(call.render(width).every(line => visibleWidth(line) <= width));
        }
        call.invalidate(); call.render(120);
      }
      assert.equal(scanned(), 4);
      assert.equal(bytes.mock.calls.filter(([value]) => value === args.content).length, 0);
      assert.ok(call.render(120)[0]!.includes(theme.fg("success", "•")));
      const failed = write.renderResult!({ content: [{ type: "text", text: "Cancelled" }], details: undefined },
        { expanded: false, isPartial: false }, theme, { ...context, isError: true, isPartial: false } as never);
      assert.ok(call.render(120)[0]!.includes(theme.fg("error", "•")));
      assert.doesNotMatch(stripTerminalSequences(call.render(120)[0]!), /lines/u);
      assert.match(stripTerminalSequences(failed.render(120)[0]!), /Cancelled/u);
      assert.equal(scanned(), 4);
    } finally { search.mockRestore(); bytes.mockRestore(); }
  }
});

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

test("display diff line-number width handles row counts beyond argument limits", () => {
  const lines = Array.from({ length: 150_000 }, (_, index) => ({
    kind: "hunk" as const,
    lineNumber: index + 1,
    text: "⋮",
  }));

  assert.equal(getDisplayLineNumberWidth(lines), 6);
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
  for (const name of ["read", "edit", "write", "bash"]) {
    assert.equal(registered.find((tool) => tool.name === name)?.renderShell, "self");
  }
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
    "• Write src/new.ts",
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

test("low-power edit renderer skips edit arguments and bounds the raw patch preview", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => true });
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderCall);
  assert.ok(edit.renderResult);

  const args = {
    path: "src/app.ts",
    get edits() {
      throw new Error("low-power edit must not read replacement text");
    },
  };
  const state: Record<string, unknown> = {};
  const call = edit.renderCall(
    args,
    theme,
    createRenderContext({ args, state, argsComplete: false, isPartial: true }) as never,
  );
  const partial = edit.renderResult(
    {
      content: [{ type: "text", get text() { throw new Error("partial edit output must stay hidden"); } }],
      details: {
        get patch() { throw new Error("partial edit must not read patch"); },
        get diff() { throw new Error("partial edit must not read diff"); },
      },
    },
    { expanded: true, isPartial: true },
    theme,
    createRenderContext({ args, state, isPartial: true }) as never,
  );

  let patchReads = 0;
  const patch = [
    "--- a/src/app.ts\r",
    "+++ b/src/app.ts",
    "@@ -1,7 +1,7 @@",
    "-old 1",
    "+new 1",
    " context 2",
    "+seventh line must stay hidden",
    `+${"x".repeat(5_000)}`,
  ].join("\n");
  const details = {
    get patch() {
      patchReads += 1;
      return patch;
    },
    get diff() {
      throw new Error("low-power edit must not read display diff");
    },
  };
  const result = {
    content: [{ type: "text", get text() { throw new Error("successful edit output must stay hidden"); } }],
    details,
  };
  const expanded = edit.renderResult(
    result,
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: true }) as never,
  );
  const expandedLines = expanded.render(100).map((line) => stripTerminalSequences(line));
  const collapsed = edit.renderResult(
    result,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: false, lastComponent: expanded }) as never,
  );

  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "• Edited src/app.ts");
  assert.equal(stripTerminalSequences(partial.render(80).join("\n")), "  … Editing");
  assert.deepEqual(expandedLines, [
    "    --- a/src/app.ts",
    "    +++ b/src/app.ts",
    "    @@ -1,7 +1,7 @@",
    "    -old 1",
    "    +new 1",
    "     context 2",
  ]);
  assert.deepEqual(collapsed.render(100), expanded.render(100));
  assert.equal(patchReads, 1);
  assert.equal(highlightCodeMock.mock.calls.length, 0);
  assert.equal(state.preparedDiff, undefined);
  assert.equal(state.collapsedLayouts, undefined);
});

test("low-power edit errors stay bounded without reading patch details", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => true });
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderCall);
  assert.ok(edit.renderResult);

  const args = { path: "src/app.ts", edits: [] };
  const state: Record<string, unknown> = {};
  const call = edit.renderCall(
    args,
    theme,
    createRenderContext({ args, state, isPartial: true }) as never,
  );
  let textReads = 0;
  const result = edit.renderResult(
    {
      content: [{
        type: "text",
        get text() {
          textReads += 1;
          return `\x1b[31mfailed\x1b[0m\u0000 ${"x".repeat(5_000)}\nsecond line`;
        },
      }],
      details: {
        get patch() { throw new Error("failed low-power edit must not read patch"); },
        get diff() { throw new Error("failed low-power edit must not read diff"); },
      },
    },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, isError: true }) as never,
  );
  const lines = result.render(24);
  const output = stripTerminalSequences(lines.join("\n"));

  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "• Edit failed src/app.ts");
  assert.match(output, /^  ✗ failed /u);
  assert.ok(!output.includes("\u0000"));
  assert.ok(!output.includes("second line"));
  assert.equal(textReads, 1);
  assert.equal(state.lowPowerPreview, undefined);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
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

test("collapsed edit highlights only the visible diff rows", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderResult);

  const diff = Array.from({ length: 10_000 }, (_, index) => (
    `${index % 2 === 0 ? "+" : "-"}${index + 1} const value${index} = ${index};`
  )).join("\n");
  const args = { path: "src/large.ts", edits: [] };
  const component = edit.renderResult(
    {
      content: [{ type: "text", text: "Successfully replaced 1 block." }],
      details: { diff, patch: "" },
    },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state: {}, expanded: false }) as never,
  );
  component.render(100);

  assert.ok(highlightCodeMock.mock.calls.length <= 12);
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

test("settled edit reuses full diff statistics on hot renderer calls", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderResult);

  const args = { path: "src/large.ts", edits: [] };
  const details = {
    diff: Array.from({ length: 100 }, (_, index) => (
      `${index % 2 === 0 ? "+" : "-"}${index + 1} value${index}`
    )).join("\n"),
    patch: "",
  };
  const result = {
    content: [{ type: "text", text: "Successfully replaced 1 block." }],
    details,
  };
  const state: Record<string | symbol, unknown> = {};
  edit.renderResult(
    result,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: false }) as never,
  );

  let fullIterations = 0;
  const prepared = state.preparedDiff as unknown[];
  state.preparedDiff = new Proxy(prepared, {
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        return function* iterate() {
          fullIterations += 1;
          yield* target;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  edit.renderResult(
    result,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: false }) as never,
  );

  assert.equal(fullIterations, 0);
});

test("expanded edit reuses its current painted layout after host invalidation", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderResult);

  let backgroundReads = 0;
  const countingTheme = {
    ...theme,
    getBgAnsi(name: string) {
      backgroundReads += 1;
      return theme.getBgAnsi(name as never);
    },
  } as Theme;
  const args = { path: "src/large.ts", edits: [] };
  const result = {
    content: [{ type: "text", text: "Successfully replaced 1 block." }],
    details: {
      diff: Array.from({ length: 100 }, (_, index) => `+${index + 1} const value${index} = ${index};`).join("\n"),
      patch: "",
    },
  };
  const state = {};
  const component = edit.renderResult(
    result,
    { expanded: true, isPartial: false },
    countingTheme,
    createRenderContext({ args, state, expanded: true }) as never,
  );
  const initial = component.render(100);
  const readsAfterInitialRender = backgroundReads;
  assert.ok(readsAfterInitialRender > 0);

  component.invalidate();
  const rebound = edit.renderResult(
    result,
    { expanded: true, isPartial: false },
    countingTheme,
    createRenderContext({ args, state, expanded: true, lastComponent: component }) as never,
  );
  const repeated = rebound.render(100);

  assert.equal(backgroundReads - readsAfterInitialRender, 2);
  assert.deepEqual(repeated, initial);
});

test("edit final layout cache follows a mutable theme proxy", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderResult);

  for (const expanded of [false, true]) {
    const mutableTheme = createMutableThemeProxy(createTheme());
    const args = { path: "src/fixture.txt", edits: [] };
    const result = {
      content: [{ type: "text", text: "Successfully replaced 1 block." }],
      details: {
        diff: "-1 old value\n+1 new value",
        patch: "",
      },
    };
    const state = {};
    const component = edit.renderResult(
      result,
      { expanded, isPartial: false },
      mutableTheme.theme,
      createRenderContext({ args, state, expanded }) as never,
    );
    const initial = component.render(40);

    mutableTheme.setBackend(createTheme(1));
    component.invalidate();
    const rebound = edit.renderResult(
      result,
      { expanded, isPartial: false },
      mutableTheme.theme,
      createRenderContext({ args, state, expanded, lastComponent: component }) as never,
    );
    const hotAfterThemeChange = rebound.render(40);
    const coldAfterThemeChange = edit.renderResult(
      result,
      { expanded, isPartial: false },
      mutableTheme.theme,
      createRenderContext({ args, state: {}, expanded }) as never,
    ).render(40);

    assert.deepEqual(
      hotAfterThemeChange,
      coldAfterThemeChange,
      `expanded=${expanded}`,
    );
    assert.notDeepEqual(hotAfterThemeChange, initial, `expanded=${expanded}`);
  }
});

test("edit cache follows syntax-only changes through the same theme proxy", () => {
  initTheme("dark", false);
  const backend = (keyword: number) => ({ ...theme, fg(name: string, text: string) {
    return name === "syntaxKeyword" ? `\x1b[38;5;${keyword}m${text}\x1b[39m` : theme.fg(name as never, text);
  } }) as Theme;
  const mutable = createMutableThemeProxy(backend(196));
  highlightCodeMock.mockImplementation((text: string) => [mutable.theme.fg("syntaxKeyword", text)]);
  try {
    const registered: ToolDefinition[] = [];
    registerToolsForTest(registered);
    const edit = registered.find(tool => tool.name === "edit")!;
    const state = {};
    const args = { path: "fixture.ts", edits: [] };
    const result = { content: [], details: { diff: "+1 const flag = true;", patch: "" } };
    const context = createRenderContext({ args, state });
    const component = edit.renderResult!(result, { expanded: true, isPartial: false }, mutable.theme, context as never);
    const initial = component.render(120);
    mutable.setBackend(backend(82));
    component.invalidate();
    const updated = component.render(120);
    const cold = edit.renderResult!(result, { expanded: true, isPartial: false }, mutable.theme,
      { ...context, state: {} } as never).render(120);
    assert.notDeepEqual(cold, initial);
    assert.deepEqual(updated, cold);
  } finally {
    highlightCodeMock.mockReset();
  }
});

test("edit retains expanded layouts and syntax only in the shared budget", () => {
  const registered: ToolDefinition[] = [];
  const renderCache = new ToolRenderCache();
  registerToolsForTest(registered, undefined, { renderCache });
  const edit = registered.find((tool) => tool.name === "edit");
  assert.ok(edit?.renderResult);

  const args = { path: "src/large.ts", edits: [] };
  const result = {
    content: [{ type: "text", text: "Successfully replaced 1 block." }],
    details: {
      diff: Array.from({ length: 30 }, (_, index) => `+${index + 1} const value${index} = ${index};`).join("\n"),
      patch: "",
    },
  };
  const state: Record<string, unknown> = {};
  let component = edit.renderResult(
    result,
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: true }) as never,
  );
  component.render(100);
  const highlightsAfterExpanded = highlightCodeMock.mock.calls.length;
  assert.equal(highlightsAfterExpanded, 30);
  assert.equal(state.expandedLayout, undefined);
  assert.ok((state.preparedDiff as Array<{ highlightedText?: string }>).every(line => line.highlightedText === undefined));
  assert.ok(renderCache.stats().layouts.entries >= 2);

  component.invalidate();
  component = edit.renderResult(
    result,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: false, lastComponent: component }) as never,
  );
  component.render(100);
  assert.equal(state.expandedLayout, undefined);
  assert.equal(state.collapsedLayouts, undefined);

  component.invalidate();
  component = edit.renderResult(
    result,
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: true, lastComponent: component }) as never,
  );
  component.render(100);

  assert.equal(highlightCodeMock.mock.calls.length, highlightsAfterExpanded);
  component.render(99);
  assert.equal(highlightCodeMock.mock.calls.length, highlightsAfterExpanded);
  assert.ok(renderCache.stats().layouts.chargedBytes <= renderCache.stats().layouts.limitBytes);
});

test("low-power write skips pending metrics and counts only the final content", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => true });
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderCall);
  assert.ok(write.renderResult);

  let contentReads = 0;
  const args = {
    path: "src/new.ts",
    get content() {
      contentReads += 1;
      return "one\ntwo";
    },
  };
  const state = {};
  const call = write.renderCall(
    args,
    theme,
    createRenderContext({ args, state, argsComplete: false, isPartial: true }) as never,
  );
  const partial = write.renderResult(
    { content: [{ type: "text", get text() { throw new Error("partial result must stay hidden"); } }], details: undefined },
    { expanded: true, isPartial: true },
    theme,
    createRenderContext({ args, state, argsComplete: false, isPartial: true }) as never,
  );
  assert.equal(contentReads, 0);
  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "• Write src/new.ts");
  const completed = write.renderResult(
    { content: [{ type: "text", get text() { throw new Error("success result must stay hidden"); } }], details: undefined },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, argsComplete: true }) as never,
  );

  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "• Write src/new.ts (2 lines)");
  assert.deepEqual(partial.render(80), []);
  assert.deepEqual(completed.render(80), []);
  assert.equal(contentReads, 1);
});

test("low-power stable render cache follows a mutable theme proxy", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => true });
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderCall);

  const mutableTheme = createMutableThemeProxy(createTheme());
  const args = {
    path: "src/new.ts",
    get content() {
      throw new Error("low-power write must not read content");
    },
  };
  const state = {};
  const call = write.renderCall(
    args,
    mutableTheme.theme,
    createRenderContext({ args, state, argsComplete: false }) as never,
  );
  const initial = call.render(80).join("\n");

  mutableTheme.setBackend(createTheme(1));
  const updated = write.renderCall(
    args,
    mutableTheme.theme,
    createRenderContext({ args, state, argsComplete: false, lastComponent: call }) as never,
  );
  const repainted = updated.render(80).join("\n");

  assert.equal(updated, call);
  assert.equal(stripTerminalSequences(repainted), stripTerminalSequences(initial));
  assert.notEqual(repainted, initial);
});

test("low-power write errors keep one sanitized bounded line", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => true });
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderResult);

  let textReads = 0;
  const errorText = `\x1b[31mfailure\x1b[0m\u0000 ${"x".repeat(100)}\rsecond line\n${"y".repeat(5_000)}`;
  const args = {
    path: "src/new.ts",
    get content() {
      throw new Error("error rendering must not read write args content");
    },
  };
  const component = write.renderResult(
    {
      content: [{
        type: "text",
        get text() {
          textReads += 1;
          return errorText;
        },
      }],
      details: undefined,
    },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state: {}, isError: true }) as never,
  );
  const output = stripTerminalSequences(component.render(10_000).join("\n"));

  assert.match(output, /^  ✗ failure /u);
  assert.ok(!output.includes("\u0000"));
  assert.ok(!output.includes("\r"));
  assert.ok(!output.includes("second line"));
  assert.ok(output.length <= 4_100);
  assert.equal(textReads, 1);
});

test("write renderer locks its mode on the first render", () => {
  let lowPowerEnabled = true;
  const isLowPowerEnabled = vi.fn(() => lowPowerEnabled);
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled });
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderCall);
  assert.ok(write.renderResult);

  const lowPowerArgs = { path: "src/low.ts", content: "one\ntwo" };
  const lowPowerState = {};
  write.renderCall(
    lowPowerArgs,
    theme,
    createRenderContext({ args: lowPowerArgs, state: lowPowerState, argsComplete: false }) as never,
  );
  lowPowerEnabled = false;
  const lowPowerResult = write.renderResult(
    { content: [{ type: "text", text: "Successfully wrote file" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args: lowPowerArgs, state: lowPowerState }) as never,
  );
  assert.deepEqual(lowPowerResult.render(80), []);

  const fullArgs = { path: "src/full.ts", content: "one\ntwo" };
  const fullState = {};
  const fullCall = write.renderCall(
    fullArgs,
    theme,
    createRenderContext({ args: fullArgs, state: fullState }) as never,
  );
  lowPowerEnabled = true;
  const fullResult = write.renderResult(
    { content: [{ type: "text", text: "Successfully wrote file" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args: fullArgs, state: fullState }) as never,
  );

  assert.match(stripTerminalSequences(fullCall.render(80).join("\n")), /2 lines/u);
  assert.deepEqual(fullResult.render(80), []);
  assert.equal(isLowPowerEnabled.mock.calls.length, 2);
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

  assert.equal(output, "");
  assert.ok(!output.includes("diff"));
  assert.ok(!output.includes("+one"));
});

test("write line metrics preserve empty and trailing newline semantics", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderCall);

  for (const [content, expected] of [
    ["", "0 lines"],
    ["\n", "2 lines"],
    ["one\n", "2 lines"],
    ["one\n\n", "3 lines"],
  ] as const) {
    const args = { path: "src/new.ts", content };
    const state = {};
    const call = write.renderCall(
      args,
      theme,
      createRenderContext({ args, state, argsComplete: false, isPartial: true }) as never,
    );
    write.renderResult!({ content: [], details: undefined }, { expanded: false, isPartial: false }, theme,
      createRenderContext({ args, state, argsComplete: false }) as never);
    assert.match(stripTerminalSequences(call.render(80).join("\n")), new RegExp(expected, "u"));
  }
});

test("write pending paints do not scan any argument snapshot", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find(tool => tool.name === "write")!;
  const state = {};
  const characterSpy = vi.spyOn(String.prototype, "charCodeAt");
  const searchSpy = vi.spyOn(String.prototype, "indexOf");
  const scanned = () => new Set([...characterSpy.mock.contexts, ...searchSpy.mock.contexts]
    .map(value => String(value)).filter(value => value.startsWith("WRITE-BODY")));
  try {
    let call;
    for (let index = 0; index < 16; index++) {
      const args = { path: "fixture.ts", content: `WRITE-BODY ${index}\nlast` };
      call = write.renderCall!(args, theme, createRenderContext({ args, state, argsComplete: false, lastComponent: call }) as never);
    }
    assert.equal(scanned().size, 0);
    assert.equal(stripTerminalSequences(call!.render(80).join("\n")), "• Write fixture.ts");
    assert.deepEqual([...scanned()], []);
    assert.equal(characterSpy.mock.contexts.filter(value => String(value).startsWith("WRITE-BODY")).length, 0);
  } finally {
    characterSpy.mockRestore();
    searchSpy.mockRestore();
  }
});

test("write streaming metrics avoid split arrays and final result recounting", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderCall);
  assert.ok(write.renderResult);

  const splitSpy = vi.spyOn(String.prototype, "split");
  const byteLengthSpy = vi.spyOn(Buffer, "byteLength");
  try {
    const state = {};
    let call = write.renderCall(
      { path: "src/new.ts", content: "one" },
      theme,
      createRenderContext({
        args: { path: "src/new.ts", content: "one" },
        state,
        argsComplete: false,
        isPartial: true,
      }) as never,
    );
    assert.equal(stripTerminalSequences(call.render(80).join("\n")), "• Write src/new.ts");

    const finalArgs = { path: "src/new.ts", content: "one\ntwo\n" };
    call = write.renderCall(
      finalArgs,
      theme,
      createRenderContext({
        args: finalArgs,
        state,
        lastComponent: call,
        argsComplete: true,
        isPartial: false,
      }) as never,
    );
    assert.equal(stripTerminalSequences(call.render(80).join("\n")), "• Write src/new.ts");

    assert.equal(byteLengthSpy.mock.calls.filter(([value]) => value === finalArgs.content).length, 0);
    const result = write.renderResult(
      { content: [{ type: "text", text: "Successfully wrote 8 bytes" }], details: undefined },
      { expanded: false, isPartial: false },
      theme,
      createRenderContext({ args: finalArgs, state, argsComplete: true }) as never,
    );
    assert.deepEqual(result.render(80), []);
    assert.match(stripTerminalSequences(call.render(80).join("\n")), /3 lines/u);
    result.invalidate();
    assert.deepEqual(result.render(80), []);
    const newlineSplits = splitSpy.mock.calls.filter(([separator]) => separator === "\n").length;
    assert.equal(newlineSplits, 0);
    assert.equal(byteLengthSpy.mock.calls.filter(([value]) => value === finalArgs.content).length, 0);
  } finally {
    splitSpy.mockRestore();
    byteLengthSpy.mockRestore();
  }
});

test("low-power bash hides partial output without reading result text", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => true });
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  let textReads = 0;
  const result = {
    content: [{
      type: "text",
      get text() {
        textReads += 1;
        throw new Error("low-power partial bash output must stay unread");
      },
    }],
    details: undefined,
  };
  const state = {};
  const collapsed = bash.renderResult(
    result,
    { expanded: false, isPartial: true },
    theme,
    createRenderContext({
      args: { command: "printf fixture" },
      state,
      expanded: false,
      isPartial: true,
    }) as never,
  );
  const expanded = bash.renderResult(
    result,
    { expanded: true, isPartial: true },
    theme,
    createRenderContext({
      args: { command: "printf fixture" },
      state,
      expanded: true,
      isPartial: true,
      lastComponent: collapsed,
    }) as never,
  );

  assert.deepEqual(collapsed.render(80), []);
  assert.deepEqual(expanded.render(20), []);
  assert.equal(expanded, collapsed);
  assert.equal(textReads, 0);
});

test("low-power bash keeps a bounded tail hidden until expanded", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => true });
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);
  assert.ok(bash.renderResult);

  let textReads = 0;
  const output = [
    "HEAD-MUST-STAY-HIDDEN",
    "x".repeat(5_000),
    "tail 1 must stay hidden",
    "\x1b[31mtail 2\x1b[0m",
    "tail\u0000 3",
    "tail 4",
  ].join("\n");
  const fullOutputPath = "/tmp/pi-bash-output.log";
  const content = [{
    type: "text",
    get text() {
      textReads += 1;
      return output;
    },
  }];
  const details = {
    fullOutputPath,
    truncation: {
      truncated: true,
      truncatedBy: "lines" as const,
      outputLines: 5,
      totalLines: 100,
    },
  };
  const result = { content, details };
  const args = { command: "seq 100" };
  const state: Record<string, unknown> = {};
  const call = bash.renderCall(
    args,
    theme,
    createRenderContext({ args, state, expanded: false, isPartial: false }) as never,
  );
  const collapsed = bash.renderResult(
    result,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: false, isPartial: false }) as never,
  );
  const collapsedText = stripTerminalSequences(call.render(100).join("\n"));

  assert.deepEqual(collapsed.render(100), []);
  assert.match(collapsedText, /3 lines shown/u);
  assert.match(collapsedText, /details/u);
  assert.ok(!collapsedText.includes("tail 2"));

  bash.renderCall(
    args,
    theme,
    createRenderContext({ args, state, expanded: true, isPartial: false, lastComponent: call }) as never,
  );
  const expanded = bash.renderResult(
    result,
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: true, isPartial: false, lastComponent: collapsed }) as never,
  );
  const expandedLines = expanded.render(100);
  const expandedText = stripTerminalSequences(expandedLines.join("\n"));

  assert.ok(!expandedText.includes("HEAD-MUST-STAY-HIDDEN"));
  assert.ok(!expandedText.includes("tail 1 must stay hidden"));
  assert.match(expandedText, /^ {6}tail 2\n {6}tail 3\n {6}tail 4/u);
  assert.match(expandedText, /Full output: \/tmp\/pi-bash-output\.log/u);
  assert.match(expandedText, /Truncated: showing 5 of 100 lines/u);
  assert.equal(expanded, collapsed);
  assert.equal(textReads, 1);
  assert.equal(state.preparedResult, undefined);
  assert.ok(expandedLines.every((line) => visibleWidth(line) <= 100));
});

test("low-power bash call bounds completed commands and runs without a refresh timer", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(0));

  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => true });
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);

  let commandReads = 0;
  const command = `${"x".repeat(255)}😀NEVER-SHOW-THIS`;
  const args = {
    timeout: 30,
    get command() {
      commandReads += 1;
      return command;
    },
  };
  const state = {};
  const invalidate = vi.fn();
  const call = bash.renderCall(
    args,
    theme,
    createRenderContext({
      args,
      state,
      invalidate,
      expanded: false,
      argsComplete: false,
      executionStarted: true,
      isPartial: true,
    }) as never,
  );
  const initial = stripTerminalSequences(call.render(500).join("\n"));
  const initialLines = initial.split("\n");

  assert.equal(initialLines.length, 2);
  assert.match(initialLines[0] ?? "", /^ ├─ • Bash running/u);
  assert.doesNotMatch(initialLines[0] ?? "", /output …|0\.0s|30s limit|expand/u);
  assert.equal(
    initialLines[1],
    "      output … · 0.0s · 30s limit · [app.tools.expand] expand",
  );
  assert.equal(commandReads, 0);
  assert.equal(vi.getTimerCount(), 0);

  vi.advanceTimersByTime(1_250);
  call.invalidate();
  assert.match(stripTerminalSequences(call.render(500).join("\n")), /0\.0s/u);
  assert.equal(invalidate.mock.calls.length, 0);

  const updated = bash.renderCall(
    args,
    theme,
    createRenderContext({
      args,
      state,
      invalidate,
      expanded: false,
      lastComponent: call,
      argsComplete: true,
      executionStarted: true,
      isPartial: true,
    }) as never,
  );
  const updatedText = stripTerminalSequences(updated.render(500).join("\n"));
  assert.match(updatedText, /1\.3s/u);
  assert.match(updatedText, /30s limit/u);
  assert.ok(!updatedText.includes("😀"));
  assert.ok(!updatedText.includes("NEVER-SHOW-THIS"));
  assert.match(updatedText.split("\n")[0] ?? "", /\.\.\.$/u);
  assert.equal(visibleWidth(updatedText.split("\n")[0] ?? ""), 110);
  assert.equal(updatedText.split("\n").length, 2);
  assert.equal(commandReads, 1);

  vi.setSystemTime(new Date(2_000));
  bash.renderCall(
    args,
    theme,
    createRenderContext({
      args,
      state,
      invalidate,
      expanded: false,
      lastComponent: call,
      argsComplete: true,
      executionStarted: true,
      isPartial: false,
    }) as never,
  );
  const completedText = stripTerminalSequences(call.render(500).join("\n"));
  assert.match(completedText, /^ ├─ • Bash completed/u);
  assert.match(completedText, /2\.0s/u);
  assert.match(completedText, /30s limit/u);
  assert.equal(completedText.split("\n").length, 2);
  assert.equal(commandReads, 1);
  assert.equal(vi.getTimerCount(), 0);
});

test("low-power bash preserves failed status and fits sanitized narrow rows", () => {
  vi.useFakeTimers();

  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled: () => true });
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);

  const args = { command: "\x1b[31mecho\x1b[0m\u0000 failed" };
  const component = bash.renderCall(
    args,
    theme,
    createRenderContext({
      args,
      state: {},
      argsComplete: true,
      executionStarted: true,
      isPartial: false,
      isError: true,
      toolCallId: "failed-call",
    }) as never,
  );
  const output = stripTerminalSequences(component.render(80).join("\n"));

  assert.match(output, /^ ├─ • Bash failed/u);
  assert.match(output, /echo failed/u);
  assert.ok(!output.includes("\u0000"));
  assert.ok(!output.includes("0.0s"));
  assert.equal(vi.getTimerCount(), 0);
  for (const width of [1, 2, 8]) {
    assert.ok(component.render(width).every((line) => visibleWidth(line) <= width));
  }
});

test("bash calls lock their render mode and isolate the full-mode refresh timer", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(0));

  let lowPowerEnabled = false;
  const isLowPowerEnabled = vi.fn(() => lowPowerEnabled);
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered, undefined, { isLowPowerEnabled });
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);

  const fullArgs = { command: "printf full" };
  const fullState = {};
  const fullInvalidate = vi.fn();
  const fullCall = bash.renderCall(
    fullArgs,
    theme,
    createRenderContext({
      args: fullArgs,
      state: fullState,
      invalidate: fullInvalidate,
      toolCallId: "full-call",
      executionStarted: true,
      isPartial: true,
    }) as never,
  );
  assert.equal(vi.getTimerCount(), 1);

  lowPowerEnabled = true;
  const lowPowerArgs = { command: "printf low" };
  const lowPowerState = {};
  const lowPowerInvalidate = vi.fn();
  const lowPowerCall = bash.renderCall(
    lowPowerArgs,
    theme,
    createRenderContext({
      args: lowPowerArgs,
      state: lowPowerState,
      invalidate: lowPowerInvalidate,
      toolCallId: "low-power-call",
      executionStarted: true,
      isPartial: true,
    }) as never,
  );
  assert.equal(vi.getTimerCount(), 1);

  lowPowerEnabled = false;
  bash.renderCall(
    lowPowerArgs,
    theme,
    createRenderContext({
      args: lowPowerArgs,
      state: lowPowerState,
      invalidate: lowPowerInvalidate,
      lastComponent: lowPowerCall,
      toolCallId: "low-power-call",
      executionStarted: true,
      isPartial: true,
    }) as never,
  );
  assert.match(stripTerminalSequences(lowPowerCall.render(80).join("\n")), /Bash running/u);
  assert.equal(vi.getTimerCount(), 1);

  vi.advanceTimersByTime(1_000);
  assert.equal(fullInvalidate.mock.calls.length, 1);
  assert.equal(lowPowerInvalidate.mock.calls.length, 0);

  bash.renderCall(
    lowPowerArgs,
    theme,
    createRenderContext({
      args: lowPowerArgs,
      state: lowPowerState,
      invalidate: lowPowerInvalidate,
      lastComponent: lowPowerCall,
      toolCallId: "low-power-call",
      executionStarted: true,
      isPartial: false,
    }) as never,
  );
  assert.equal(vi.getTimerCount(), 1);

  lowPowerEnabled = true;
  bash.renderCall(
    fullArgs,
    theme,
    createRenderContext({
      args: fullArgs,
      state: fullState,
      invalidate: fullInvalidate,
      lastComponent: fullCall,
      toolCallId: "full-call",
      executionStarted: true,
      isPartial: false,
    }) as never,
  );
  assert.equal(vi.getTimerCount(), 0);
  assert.equal(isLowPowerEnabled.mock.calls.length, 2);
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
