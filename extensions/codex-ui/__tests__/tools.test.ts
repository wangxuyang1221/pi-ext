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
    underline: (text: string) => `\x1b[4m${text}\x1b[24m`,
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

test("write and edit keep partial output static and private even when expanded", () => {
  vi.useFakeTimers();
  const invalidate = vi.fn();
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  for (const name of ["write", "edit"]) {
    const tool = registered.find(tool => tool.name === name)!;
    const args = { path: "src/components/中文.ts" };
    for (const key of ["content", "edits"]) Object.defineProperty(args, key, {
      get() { throw new Error("Pending content must not be read"); },
    });
    const context = createRenderContext({ args, argsComplete: false, isPartial: true, invalidate });
    const call = tool.renderCall!(args, theme, context as never);
    const details = Object.defineProperty({}, "patch", {
      get() { throw new Error("Pending diff must not be read"); },
    });
    const result = tool.renderResult!({ content: [], details }, { expanded: true, isPartial: true }, theme, context as never);
    const verb = name === "write" ? "Writing" : "Editing";
    assert.equal(stripTerminalSequences(call.render(92)[0]!), `~ ${verb} src/components/中文.ts`);
    assert.ok(call.render(92)[0]!.includes(theme.fg("warning", "~")));
    assert.ok(call.render(92)[0]!.includes(theme.fg("dim", "src/components/")));
    assert.ok(call.render(92)[0]!.includes(theme.fg("text", theme.bold("中文.ts"))));
    for (const width of [1, 8, 16, 24, 40, 60, 92, 160]) {
      assert.ok(call.render(width).every(line => visibleWidth(line) <= width));
      assert.deepEqual(result.render(width), []);
    }
  }
  vi.advanceTimersByTime(30_000);
  assert.equal(vi.getTimerCount(), 0);
  assert.equal(invalidate.mock.calls.length, 0);
  assert.equal(highlightCodeMock.mock.calls.length, 0);
});

test("write and edit show one red failure marker and never render a failed diff", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  for (const name of ["write", "edit"]) {
    const tool = registered.find(tool => tool.name === name)!;
    const args = { path: "src/app.ts", content: "ignored", edits: [] };
    const context = createRenderContext({ args });
    const call = tool.renderCall!(args, theme, context as never);
    const result = tool.renderResult!({
      content: [{ type: "text" as const, text: "Permission denied" }],
      details: { get patch() { throw new Error("Failed diff must not be read"); } },
    }, { expanded: true, isPartial: false }, theme, { ...context, isError: true } as never);
    const title = call.render(92)[0]!;
    assert.equal(stripTerminalSequences(title), `~ ${name === "write" ? "Write" : "Edit"} failed src/app.ts`);
    assert.ok(title.includes(theme.fg("error", "~")));
    assert.deepEqual(result.render(92).map(stripTerminalSequences), ["  Permission denied"]);
  }
  assert.equal(highlightCodeMock.mock.calls.length, 0);
});

test("write restores persisted changes with the same settled ANSI layout as edit", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find(tool => tool.name === "write")!;
  const edit = registered.find(tool => tool.name === "edit")!;
  const patch = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";
  for (const action of ["Added", "Edited"]) {
    const args = { path: "src/app.ts", get content() { throw new Error("Persisted changes must not rescan arguments"); } };
    const context = createRenderContext({ args, argsComplete: false });
    const call = write.renderCall!(args, theme, context as never);
    const details = JSON.parse(JSON.stringify({ codexWrite: { version: 1, action, patch } }));
    const body = write.renderResult!({ content: [], details }, { expanded: false, isPartial: false }, theme, context as never);
    const editContext = createRenderContext({ args: { path: args.path, edits: [] } });
    const editCall = edit.renderCall!(editContext.args, theme, editContext as never);
    const editBody = edit.renderResult!({ content: [], details: { diff: "", patch } }, { expanded: false, isPartial: false }, theme, editContext as never);
    assert.equal(stripTerminalSequences(call.render(92)[0]!), `~ ${action} src/app.ts (+1 -1)`);
    assert.ok(call.render(92)[0]!.startsWith("\x1b[4m" + theme.fg("muted", "~")));
    for (const width of [1, 8, 16, 24, 40, 60, 92, 160]) {
      assert.deepEqual(body.render(width), editBody.render(width));
    }
    if (action === "Edited") assert.deepEqual(call.render(92), editCall.render(92));
  }
});

test("write reports unavailable diffs without inventing a change count or operation", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find(tool => tool.name === "write")!;
  for (const action of [undefined, "Added", "Edited"]) {
    const args = { path: "file.ts", content: "new" };
    const context = createRenderContext({ args });
    const call = write.renderCall!(args, theme, context as never);
    const body = write.renderResult!({ content: [], details: { codexWrite: { version: 1, action } } },
      { expanded: true, isPartial: false }, theme, context as never);
    assert.equal(stripTerminalSequences(call.render(92)[0]!), `~ ${action ?? "Write"} file.ts`);
    assert.deepEqual(body.render(92), [theme.fg("dim", "  Diff unavailable")]);
  }
});

test("write streams without counts and restores final counts before argsComplete", () => {
  initTheme("dark", false);
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find(tool => tool.name === "write")!;
  const row = new ToolExecutionComponent("write", "stream-write", { path: "src/new.ts", content: "" },
    { showImages: false }, write, { requestRender() {} } as never, "/repo");
  for (const count of [0, 3, 10, 20]) {
    row.updateArgs({ path: "src/new.ts", content: Array.from({ length: count }, () => "text").join("\n") });
    assert.deepEqual(row.render(80).map(stripTerminalSequences).filter(Boolean), ["~ Writing src/new.ts"]);
  }
  row.updateResult({ content: [{ type: "text" as const, text: "Successfully wrote file." }], isError: false });
  assert.deepEqual(row.render(80).map(stripTerminalSequences).filter(Boolean), ["~ Write src/new.ts (20 lines)"]);
  row.setExpanded(true);
  assert.deepEqual(row.render(80).map(stripTerminalSequences).filter(Boolean), ["~ Write src/new.ts (20 lines)"]);
});

test("write keeps completed malformed arguments inside the host fallback boundary", () => {
  initTheme("dark", false);
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find(tool => tool.name === "write")!;
  for (const content of [undefined, null, 123, {}, []]) {
    const row = new ToolExecutionComponent("write", "invalid", { path: "src/new.ts", content },
      { showImages: false }, write, { requestRender() {} } as never, "/repo");
    row.setArgsComplete();
    assert.deepEqual(row.render(80).map(line => stripTerminalSequences(line).trimEnd()).filter(Boolean),
      [`write path="src/new.ts" content=${JSON.stringify(content) ?? String(content)}`]);
    row.setExpanded(true);
    const expanded = row.render(80).map(stripTerminalSequences).join("\n");
    assert.match(expanded, /path: src\/new\.ts/u);
    assert.match(expanded, new RegExp(`content: ${JSON.stringify(content) ?? String(content)}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    row.updateResult({ content: [{ type: "text" as const, text: "Invalid arguments" }], isError: true });
    assert.match(row.render(80).map(stripTerminalSequences).join("\n"), /Invalid arguments/u);
    assert.doesNotMatch(row.render(80).map(stripTerminalSequences).join("\n"), /0 lines/u);
  }
});

test("write scans final content once and colors pending, success and failure markers", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
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
    assert.ok(call.render(120)[0]!.includes(theme.fg("warning", "~")));
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
    assert.ok(call.render(120)[0]!.includes(theme.fg("muted", "~")));
    const failed = write.renderResult!({ content: [{ type: "text" as const, text: "Cancelled" }], details: undefined },
      { expanded: false, isPartial: false }, theme, { ...context, isError: true, isPartial: false } as never);
    assert.ok(call.render(120)[0]!.includes(theme.fg("error", "~")));
    assert.doesNotMatch(stripTerminalSequences(call.render(120)[0]!), /lines/u);
    assert.match(stripTerminalSequences(failed.render(120)[0]!), /Cancelled/u);
    assert.equal(scanned(), 4);
  } finally { search.mockRestore(); bytes.mockRestore(); }
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

test("mutation diff highlighting bounds long lines without discarding the remaining text", () => {
  highlightCodeMock.mockImplementation((text: string) => [text]);
  try {
    const text = "x".repeat(4095) + "🙂" + "x".repeat(50 * 1024) + "END";
    const patch = `--- a/file.ts\n+++ b/file.ts\n@@ -0,0 +1 @@\n+${text}\n`;
    const registered: ToolDefinition[] = [];
    registerToolsForTest(registered);
    for (const name of ["write", "edit"]) {
      const tool = registered.find(tool => tool.name === name)!;
      const details = name === "write" ? { codexWrite: { version: 1, action: "Added", patch } } : { patch, diff: "" };
      const args = { path: "file.ts", content: text, edits: [] };
      const context = createRenderContext({ args });
      tool.renderCall!(args, theme, context as never);
      const body = tool.renderResult!({ content: [], details }, { expanded: true, isPartial: false }, theme, context as never);
      body.render(92);
      assert.ok(stripTerminalSequences(body.render(60_000)[0]!).includes(text));
      const count = highlightCodeMock.mock.calls.length;
      body.invalidate(); body.render(92);
      assert.equal(highlightCodeMock.mock.calls.length, count);
    }
    assert.ok(stripTerminalSequences(renderDisplayDiff(parseDisplayDiff(`+1 ${text}`), theme, 60_000, "file.ts")[0]!).includes(text));
    assert.ok(highlightCodeMock.mock.calls.length > 0);
    for (const [input] of highlightCodeMock.mock.calls) {
      assert.ok(input.length <= 4096);
      assert.ok(!/[\uD800-\uDBFF]$/u.test(input), "Highlight prefixes must not split a surrogate pair");
    }
  } finally { highlightCodeMock.mockReset(); }
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
        return { content: [{ type: "text" as const, text: "ok" }], details: undefined };
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

test("read renderer combines the success marker, filename, range and preview in the call row", () => {
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
    createRenderContext({ args, state, isPartial: true, expanded: false }) as never,
  );
  assert.equal(
    stripTerminalSequences(call.render(80).join("\n")),
    "@ Read app.ts  src/ · Reading…",
  );

  const result = read.renderResult(
    { content: [{ type: "text" as const, text: "alpha\nbeta" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state }) as never,
  );

  const settledTitleAnsi = call.render(80).join("\n");
  assert.equal(stripTerminalSequences(settledTitleAnsi),
    "@ Read app.ts  src/ · L4–5 · 2 lines\n  │   4  alpha\n  │   5  beta");
  assert.ok(settledTitleAnsi.includes(theme.fg("muted", "@")));
  assert.ok(settledTitleAnsi.includes(theme.fg("accent", "app.ts")));
  assert.ok(settledTitleAnsi.includes(theme.fg("dim", "  src/")));
  assert.ok(settledTitleAnsi.includes(theme.bold("Read")));
  assert.ok(!settledTitleAnsi.includes(theme.bold("app.ts")));
  assert.deepEqual(result.render(80), []);

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
    "~ Writing src/new.ts",
  );
});

test("read renderer preserves summary variants", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const read = registered.find((tool) => tool.name === "read");
  assert.ok(read?.renderResult);

  const renderSummary = (
    content: Array<import("@earendil-works/pi-ai").TextContent | import("@earendil-works/pi-ai").ImageContent>,
    details: unknown = undefined,
  ) => {
    const context = createRenderContext({ args: { path: "fixture.txt" }, state: {}, expanded: false });
    const call = read.renderCall!(context.args, theme, context as never);
    read.renderResult!({ content, details }, { expanded: false, isPartial: false }, theme, context as never);
    return call.render(80).at(0) ?? "";
  };

  assert.equal(stripTerminalSequences(renderSummary([
    { type: "text" as const, text: "only" },
  ])), "@ Read fixture.txt  ./ · 1 line");

  const truncated = renderSummary(
    [{ type: "text" as const, text: "one\ntwo" }],
    { truncation: { truncated: true } },
  );
  assert.equal(stripTerminalSequences(truncated), "@ Read fixture.txt  ./ · 2 lines · truncated");
  assert.ok(truncated.includes(theme.fg("dim", " · 2 lines · truncated")));

  const image = renderSummary([
    { type: "text" as const, text: "Read image file [image/png]" },
    { type: "image", data: "base64", mimeType: "image/png" },
  ]);
  assert.equal(stripTerminalSequences(image), "@ Read fixture.txt  ./ · Image loaded");
  assert.ok(image.includes(theme.fg("dim", " · Image loaded")));
});

test("read renderer shows pending and failed states without false success or previews", () => {
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
    { content: [{ type: "text" as const, text: "alpha" }], details: undefined },
    { expanded: false, isPartial: true },
    theme,
    createRenderContext({ args, state, isPartial: true }) as never,
  );
  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "@ Read app.ts  src/ · Reading…\n  │ src/app.ts");
  assert.deepEqual(partial.render(80), []);

  const error = read.renderResult(
    { content: [{ type: "text" as const, text: "Permission denied\nstack" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, isError: true }) as never,
  );
  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "@ Read app.ts  src/ · Failed\n  │ src/app.ts\n  × Permission denied");
  assert.deepEqual(error.render(80), []);
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
    { content: [{ type: "text" as const, text: content }], details: undefined },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state }) as never,
  );

  const lines = call.render(80).map((line) => stripTerminalSequences(line));
  assert.equal(lines.length, 43);
  assert.match(lines[0]!, /42 lines$/u);
  assert.equal(lines[1], "  │ a/very/long/path/to/a/fixture.txt");
  assert.equal(lines[2], "  │   1  line 1");
  assert.equal(lines[41], "  │  40  line 40");
  assert.equal(lines[42], "  └ … 2 more lines");
  assert.deepEqual(result.render(80), []);

  for (const width of [1, 2, 8, 20]) {
    const narrowLines = [...call.render(width), ...result.render(width)];
    assert.ok(narrowLines.every((line) => visibleWidth(line) <= width));
  }
  assert.deepEqual(call.render(0), []);
  assert.deepEqual(result.render(0), []);
});

test("edit errors read the captured first line once without reading patch details", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
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
        type: "text" as const,
        get text(): string {
          textReads += 1;
          return `failed ${"x".repeat(5_000)}\nsecond line`;
        },
      }],
      details: {
        get patch() { throw new Error("failed edit must not read patch"); },
        get diff() { throw new Error("failed edit must not read diff"); },
      },
    },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, isError: true }) as never,
  );
  const lines = result.render(24);
  const output = stripTerminalSequences(lines.join("\n"));

  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "~ Edit failed src/app.ts");
  assert.match(output, /^  failed /u);
  assert.ok(!output.includes("\u0000"));
  assert.ok(!output.includes("second line"));
  assert.equal(textReads, 1);
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
  assert.equal(stripTerminalSequences(call.render(60).join("\n")), "~ Editing src/app.ts");

  const resultContext = createRenderContext({ args, state });
  const result = edit.renderResult(
    {
      content: [{ type: "text" as const, text: "Successfully replaced 1 block." }],
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

  assert.equal(title, "~ Edited src/app.ts (+2 -1)");
  assert.ok(titleAnsi.startsWith("\x1b[4m"));
  assert.ok(titleAnsi.endsWith("\x1b[24m"));
  assert.ok(diffLines.every(line => !line.includes("\x1b[4m")));
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

test("edit underlines only nonempty settled diff titles and fits narrow widths", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const edit = registered.find(tool => tool.name === "edit");
  assert.ok(edit?.renderCall && edit.renderResult);
  const args = { path: "src/中文目录/long-renderer-name.ts", edits: [] };
  const state = {};
  const context = createRenderContext({ args, state });
  const call = edit.renderCall(args, theme, context as never);
  assert.ok(!call.render(120).join("\n").includes("\x1b[4m"));

  for (const expanded of [false, true]) {
    const result = edit.renderResult({ content: [], details: { diff: "+1 const value = 1;", patch: "" } },
      { expanded, isPartial: false }, theme, context as never);
    for (const width of [0, 1, 2, 8, 24, 80, 120]) {
      const titleLines = call.render(width);
      assert.ok(titleLines.every(line => visibleWidth(line) <= width));
      assert.ok(result.render(width).every(line => visibleWidth(line) <= width));
    }
    assert.ok(call.render(120)[0]?.startsWith("\x1b[4m"));
    assert.match(stripTerminalSequences(result.render(80)[0] ?? ""), /1 \+ const value/u);
  }

  for (const [isPartial, isError, details] of [
    [true, false, { diff: "+1 partial", patch: "" }],
    [false, true, { diff: "+1 ignored", patch: "" }],
    [false, false, undefined],
    [false, false, { diff: "", patch: "--- a/app.ts\n+++ b/app.ts" }],
  ] as const) {
    edit.renderResult({ content: [{ type: "text" as const, text: "result" }], details },
      { expanded: false, isPartial }, theme, { ...context, isError } as never);
    assert.ok(!call.render(120).join("\n").includes("\x1b[4m"));
  }
});

test("collapsed edit diff shows a compact footer immediately after twelve rows", () => {
  for (const [totalLines, hiddenLabel] of [
    [13, "1 more lines"],
    [14, "2 more lines"],
  ] as const) {
    const registered: ToolDefinition[] = [];
    registerToolsForTest(registered);
    const edit = registered.find((tool) => tool.name === "edit");
    assert.ok(edit?.renderResult);

    const patchLines = Array.from({ length: totalLines }, (_, index) => ` line ${index + 1}`);
    const component = edit.renderResult(
      {
        content: [{ type: "text" as const, text: "Successfully replaced 1 block." }],
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

    assert.equal(lines.length, 13);
    assert.match(stripTerminalSequences(lines.at(-2) ?? ""), /line 12/u);
    assert.equal(plainFooter, `  │     … ${hiddenLabel}`);
    assert.ok(visibleWidth(footer) < 48);
    assert.equal(footer, theme.fg("dim", `  │     … ${hiddenLabel}`));

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
      content: [{ type: "text" as const, text: "Successfully replaced 1 block." }],
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
    content: [{ type: "text" as const, text: "Successfully replaced 1 block." }],
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
    content: [{ type: "text" as const, text: "Successfully replaced 1 block." }],
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
    content: [{ type: "text" as const, text: "Successfully replaced 1 block." }],
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
      content: [{ type: "text" as const, text: "Successfully replaced 1 block." }],
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
    content: [{ type: "text" as const, text: "Successfully replaced 1 block." }],
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

test("legacy write results skip pending metrics and count only final content", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
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
    { content: [{ type: "text" as const, get text(): string { throw new Error("partial result must stay hidden"); } }], details: undefined },
    { expanded: true, isPartial: true },
    theme,
    createRenderContext({ args, state, argsComplete: false, isPartial: true }) as never,
  );
  assert.equal(contentReads, 0);
  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "~ Writing src/new.ts");
  const completed = write.renderResult(
    { content: [{ type: "text" as const, get text(): string { throw new Error("success result must stay hidden"); } }], details: undefined },
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, argsComplete: true }) as never,
  );

  assert.equal(stripTerminalSequences(call.render(80).join("\n")), "~ Write src/new.ts (2 lines)");
  assert.deepEqual(partial.render(80), []);
  assert.deepEqual(completed.render(80), []);
  assert.equal(contentReads, 1);
});

test("pending write render follows a mutable theme proxy", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderCall);

  const mutableTheme = createMutableThemeProxy(createTheme());
  const args = {
    path: "src/new.ts",
    get content() {
      throw new Error("pending write must not read content");
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

test("write errors read one captured first line without inspecting arguments", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderResult);

  let textReads = 0;
  const errorText = `failure ${"x".repeat(5_000)}\nsecond line`;
  const args = {
    path: "src/new.ts",
    get content() {
      throw new Error("error rendering must not read write args content");
    },
  };
  const component = write.renderResult(
    {
      content: [{
        type: "text" as const,
        get text(): string {
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
  const output = stripTerminalSequences(component.render(24).join("\n"));

  assert.match(output, /^  failure /u);
  assert.ok(!output.includes("\u0000"));
  assert.ok(!output.includes("\r"));
  assert.ok(!output.includes("second line"));
  assert.ok(visibleWidth(output) <= 24);
  assert.equal(textReads, 1);
});

test("write renderer reports a compact summary without inventing a diff", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const write = registered.find((tool) => tool.name === "write");
  assert.ok(write?.renderResult);

  const args = { path: "src/new.ts", content: "one\ntwo" };
  const component = write.renderResult(
    { content: [{ type: "text" as const, text: "Successfully wrote 7 bytes" }], details: undefined },
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
    assert.equal(stripTerminalSequences(call!.render(80).join("\n")), "~ Writing fixture.ts");
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
    assert.equal(stripTerminalSequences(call.render(80).join("\n")), "~ Writing src/new.ts");

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
    assert.equal(stripTerminalSequences(call.render(80).join("\n")), "~ Writing src/new.ts");

    assert.equal(byteLengthSpy.mock.calls.filter(([value]) => value === finalArgs.content).length, 0);
    const result = write.renderResult(
      { content: [{ type: "text" as const, text: "Successfully wrote 8 bytes" }], details: undefined },
      { expanded: false, isPartial: false },
      theme,
      createRenderContext({ args: finalArgs, state, argsComplete: true }) as never,
    );
    assert.deepEqual(result.render(80), []);
    assert.match(stripTerminalSequences(call.render(80).join("\n")), /3 lines/u);
    result.invalidate();
    assert.deepEqual(result.render(80), []);
    const newlineSplits = splitSpy.mock.calls.filter(([separator]) => (separator as unknown) === "\n").length;
    assert.equal(newlineSplits, 0);
    assert.equal(byteLengthSpy.mock.calls.filter(([value]) => value === finalArgs.content).length, 0);
  } finally {
    splitSpy.mockRestore();
    byteLengthSpy.mockRestore();
  }
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
    content: [{ type: "text" as const, text: "Successfully replaced 1 block." }],
    details: { diff: "-1 old value\n+1 new value", patch: "" },
    isError: false,
  });

  for (const expanded of [false, true]) {
    component.setExpanded(expanded);
    const lines = component.render(80).map(stripTerminalSequences);
    const title = lines.findIndex(line => line.includes("Edited src/app.ts"));
    assert.ok(title >= 0);
    assert.match(lines[title + 1] ?? "", /1 - old value/u);
    const output = lines.join("\n");
    assert.equal(output.split("old value").length - 1, 1);
    assert.equal(output.split("new value").length - 1, 1);
  }
});
