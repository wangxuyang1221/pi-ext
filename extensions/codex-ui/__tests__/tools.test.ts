import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  initTheme,
  ToolExecutionComponent,
  truncateToVisualLines,
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
      highlightCodeMock(...args);
      return actual.highlightCode(...args);
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

function legacySanitizeBash(text: string): string {
  return Array.from(text)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return false;
      if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return true;
      if (codePoint <= 0x1f) return false;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
      return codePoint < 0xfff9 || codePoint > 0xfffb;
    })
    .join("");
}

function legacyBashCommandLines(
  command: string,
  status: "pending" | "completed" | "failed",
  width: number,
): string[] {
  const displayCommand = legacySanitizeBash(stripTerminalSequences(command)) || "…";
  const text = theme.fg("toolTitle", theme.bold(`$ ${displayCommand}`));
  const rail = width >= 2 ? theme.fg("success", "▌") : "";
  const gap = width >= 3 ? " " : "";
  const trailingPadding = width >= 4 ? 1 : 0;
  const prefix = `${rail}${gap}`;
  const contentWidth = Math.max(1, width - visibleWidth(prefix) - trailingPadding);
  const commandLines = wrapTextWithAnsi(text, contentWidth);
  const shellBackground = status === "completed"
    ? "toolSuccessBg"
    : status === "failed"
      ? "toolErrorBg"
      : "toolPendingBg";

  return (commandLines.length > 0 ? commandLines : [""]).map((line) => fitToWidth(
    `${theme.getBgAnsi("toolPendingBg")}${fitToWidth(`${prefix}${line}`, width, { pad: true })}${theme.getBgAnsi(shellBackground)}`,
    width,
  ));
}

function legacyAlignedLines(left: string, right: string, width: number): string[] {
  if (!right) return wrapTextWithAnsi(left, width);

  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap >= 1) return [`${left}${" ".repeat(gap)}${right}`];

  return [
    ...wrapTextWithAnsi(left, width),
    ...wrapTextWithAnsi(right, width).map((line) => (
      `${" ".repeat(Math.max(0, width - visibleWidth(line)))}${line}`
    )),
  ];
}

function legacyBashResultLines(
  output: string,
  expanded: boolean,
  width: number,
  warning = "",
): string[] {
  const sanitized = legacySanitizeBash(stripTerminalSequences(output)).replace(/\r/gu, "").trim();
  let visualLines: string[] = [];
  let skippedCount = 0;
  if (sanitized) {
    const styled = sanitized
      .split("\n")
      .map((line) => theme.fg("toolOutput", line))
      .join("\n");
    const preview = truncateToVisualLines(
      styled,
      expanded ? Number.MAX_SAFE_INTEGER : 5,
      width,
    );
    visualLines = preview.visualLines;
    skippedCount = preview.skippedCount;
  }

  const totalVisualLines = visualLines.length + skippedCount;
  const lineLabel = `${totalVisualLines} visual ${totalVisualLines === 1 ? "line" : "lines"}`;
  const footerLabel = !expanded && skippedCount > 0
    ? `${skippedCount} earlier visual lines hidden`
    : lineLabel;
  const lines = ["", ...visualLines];
  if (warning) {
    lines.push("", ...wrapTextWithAnsi(theme.fg("warning", `[${warning}]`), width));
  }
  lines.push(
    "",
    ...legacyAlignedLines(
      theme.fg("dim", footerLabel),
      `[app.tools.expand] ${expanded ? "collapse" : "expand"}`,
      width,
    ),
  );
  return lines.map((line) => fitToWidth(line, width));
}

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

test("collapsing an expanded edit releases hidden highlight state", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
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
  assert.ok(state.expandedLayout);

  component.invalidate();
  component = edit.renderResult(
    result,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: false, lastComponent: component }) as never,
  );
  component.render(100);
  assert.equal(state.expandedLayout, undefined);
  assert.ok((state.collapsedLayouts as unknown[]).length <= 2);

  component.invalidate();
  component = edit.renderResult(
    result,
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, expanded: true, lastComponent: component }) as never,
  );
  component.render(100);

  assert.ok(highlightCodeMock.mock.calls.length > highlightsAfterExpanded);
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
    const call = write.renderCall(
      args,
      theme,
      createRenderContext({ args, state: {}, argsComplete: false, isPartial: true }) as never,
    );
    assert.match(stripTerminalSequences(call.render(80).join("\n")), new RegExp(expected, "u"));
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
    assert.match(stripTerminalSequences(call.render(80).join("\n")), /1 line/u);

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
    assert.match(stripTerminalSequences(call.render(80).join("\n")), /3 lines/u);

    const finalByteReads = byteLengthSpy.mock.calls.filter(([value]) => value === finalArgs.content).length;
    const result = write.renderResult(
      { content: [{ type: "text", text: "Successfully wrote 8 bytes" }], details: undefined },
      { expanded: false, isPartial: false },
      theme,
      createRenderContext({ args: finalArgs, state, argsComplete: true }) as never,
    );
    assert.match(stripTerminalSequences(result.render(80).join("\n")), /3 lines · 8 B/u);

    const newlineSplits = splitSpy.mock.calls.filter(([separator]) => separator === "\n").length;
    assert.equal(newlineSplits, 0);
    assert.equal(
      byteLengthSpy.mock.calls.filter(([value]) => value === finalArgs.content).length,
      finalByteReads,
    );
  } finally {
    splitSpy.mockRestore();
    byteLengthSpy.mockRestore();
  }
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

test("bash command cache follows a mutable theme proxy", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);

  const mutableTheme = createMutableThemeProxy(createTheme());
  const args = { command: "printf 'theme-sensitive command'" };
  const state = {};
  const component = bash.renderCall(
    args,
    mutableTheme.theme,
    createRenderContext({ args, state, executionStarted: false }) as never,
  );
  const initial = component.render(48);

  mutableTheme.setBackend(createTheme(1));
  component.invalidate();
  const rebound = bash.renderCall(
    args,
    mutableTheme.theme,
    createRenderContext({
      args,
      state,
      lastComponent: component,
      executionStarted: false,
    }) as never,
  );
  const hotAfterThemeChange = rebound.render(48);
  const coldAfterThemeChange = bash.renderCall(
    args,
    mutableTheme.theme,
    createRenderContext({ args, state: {}, executionStarted: false }) as never,
  ).render(48);

  assert.deepEqual(hotAfterThemeChange, coldAfterThemeChange);
  assert.notDeepEqual(hotAfterThemeChange, initial);
});

test("bash command cache preserves legacy ANSI output across widths and controls", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);

  const commands = [
    "echo plain",
    "printf '\t状态 👩🏽‍💻 e\u0301'",
    "\x1b[31mecho\x1b[0m a\r\nb\u0000\ud800\ufff9safe",
    "a long ASCII command with spaces and /punctuation/ that wraps",
  ];
  const statuses = [
    { status: "pending" as const, isPartial: true, isError: false },
    { status: "completed" as const, isPartial: false, isError: false },
    { status: "failed" as const, isPartial: false, isError: true },
  ];

  for (const command of commands) {
    for (const status of statuses) {
      for (const width of [1, 2, 3, 8, 20, 80, 120]) {
        const args = { command };
        const call = bash.renderCall(
          args,
          theme,
          createRenderContext({
            args,
            state: {},
            executionStarted: false,
            isPartial: status.isPartial,
            isError: status.isError,
          }) as never,
        );
        const pendingBackground = theme.getBgAnsi("toolPendingBg");
        const commandLines = call.render(width)
          .filter((line) => line.startsWith(pendingBackground));
        assert.deepEqual(
          commandLines,
          legacyBashCommandLines(command, status.status, width),
          `status=${status.status}, width=${width}, command=${JSON.stringify(command)}`,
        );
      }
    }
  }
});

test("bash duration ticks reuse static command geometry", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(0));

  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);

  const args = { command: "printf 'static command body'", timeout: 30 };
  const state = {};
  const invalidate = vi.fn();
  const call = bash.renderCall(
    args,
    theme,
    createRenderContext({ args, state, invalidate, executionStarted: true, isPartial: true }) as never,
  );
  invalidate.mockImplementation(() => call.invalidate());

  const initial = call.render(60);
  const wrapsAfterInitialRender = wrapTextWithAnsiMock.mock.calls.length;
  assert.ok(wrapsAfterInitialRender > 0);

  vi.advanceTimersByTime(1250);
  const rebound = bash.renderCall(
    args,
    theme,
    createRenderContext({
      args,
      state,
      invalidate,
      lastComponent: call,
      executionStarted: true,
      isPartial: true,
    }) as never,
  );
  const updated = rebound.render(60);

  assert.equal(rebound, call);
  assert.match(stripTerminalSequences(updated.join("\n")), /1\.3s/u);
  assert.equal(wrapTextWithAnsiMock.mock.calls.length, wrapsAfterInitialRender);
  assert.deepEqual(updated.slice(2), initial.slice(2));
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

test("bash result optimizations preserve legacy ANSI output for all render modes", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  const output = [
    "\x1b[31mred\x1b[0m\r",
    "状态\t👩🏽‍💻 e\u0301",
    "control\u0000\ud800\ufff9safe",
    "a long line with spaces and /punctuation/ that wraps repeatedly",
    "tail",
  ].join("\n");
  const states = [
    { isPartial: true, isError: false },
    { isPartial: false, isError: false },
    { isPartial: false, isError: true },
  ];

  for (const renderState of states) {
    for (const expanded of [false, true]) {
      for (const width of [1, 2, 3, 8, 20, 80, 120]) {
        const args = { command: "printf fixture" };
        const component = bash.renderResult(
          { content: [{ type: "text", text: output }], details: undefined },
          { expanded, isPartial: renderState.isPartial },
          theme,
          createRenderContext({
            args,
            state: {},
            expanded,
            isPartial: renderState.isPartial,
            isError: renderState.isError,
            executionStarted: false,
          }) as never,
        );
        assert.deepEqual(
          component.render(width),
          legacyBashResultLines(output, expanded, width),
          `partial=${renderState.isPartial}, error=${renderState.isError}, expanded=${expanded}, width=${width}`,
        );
      }
    }
  }
});

test("expanded bash truncation warning matches legacy bytes across widths", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  const output = "alpha\n状态 👩🏽‍💻\nomega";
  const fullOutputPath = "/tmp/pi-bash-output.log";
  const warning = `Full output: ${fullOutputPath}. Truncated: showing 3 of 8 lines`;
  const details = {
    fullOutputPath,
    truncation: {
      content: output,
      truncated: true,
      truncatedBy: "lines" as const,
      totalLines: 8,
      totalBytes: 128,
      outputLines: 3,
      outputBytes: Buffer.byteLength(output, "utf8"),
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines: 3,
      maxBytes: 51_200,
    },
  };

  for (const width of [1, 2, 3, 8, 20, 80, 120]) {
    const component = bash.renderResult(
      { content: [{ type: "text", text: output }], details },
      { expanded: true, isPartial: false },
      theme,
      createRenderContext({
        args: { command: "printf fixture" },
        state: {},
        expanded: true,
        executionStarted: false,
      }) as never,
    );
    assert.deepEqual(
      component.render(width),
      legacyBashResultLines(output, true, width, warning),
      `width=${width}`,
    );
  }
});

test("expanded bash avoids a second full-output fit pass", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  const countFinalFits = (lineCount: number): number => {
    const output = Array.from({ length: lineCount }, (_, index) => `line ${index}`).join("\n");
    const component = bash.renderResult(
      { content: [{ type: "text", text: output }], details: undefined },
      { expanded: true, isPartial: false },
      theme,
      createRenderContext({
        args: { command: "seq fixture" },
        state: {},
        expanded: true,
        executionStarted: false,
      }) as never,
    );

    truncateToWidthMock.mockClear();
    const actual = component.render(80);
    const fitCount = truncateToWidthMock.mock.calls.length;
    assert.deepEqual(actual, legacyBashResultLines(output, true, 80));
    return fitCount;
  };

  assert.equal(countFinalFits(200), countFinalFits(20));
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

test("settled bash result reuses visual layout after host invalidation", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  let outputPaints = 0;
  const countingTheme = {
    ...theme,
    fg(name: string, text: string) {
      if (name === "toolOutput" && text !== "x") outputPaints += 1;
      return theme.fg(name as never, text);
    },
  } as Theme;
  const args = { command: "seq 20" };
  const result = {
    content: [{ type: "text", text: Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n") }],
    details: undefined,
  };
  const state = {};
  const component = bash.renderResult(
    result,
    { expanded: false, isPartial: false },
    countingTheme,
    createRenderContext({ args, state, executionStarted: false }) as never,
  );
  const initial = component.render(40);
  const paintsAfterInitialRender = outputPaints;
  assert.ok(paintsAfterInitialRender > 0);

  component.invalidate();
  const rebound = bash.renderResult(
    result,
    { expanded: false, isPartial: false },
    countingTheme,
    createRenderContext({
      args,
      state,
      lastComponent: component,
      executionStarted: false,
    }) as never,
  );
  const repeated = rebound.render(40);

  assert.equal(rebound, component);
  assert.equal(outputPaints, paintsAfterInitialRender);
  assert.deepEqual(repeated, initial);
});

test("bash result cache follows a mutable theme proxy", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderResult);

  for (const expanded of [false, true]) {
    const mutableTheme = createMutableThemeProxy(createTheme());
    const args = { command: "printf fixture" };
    const result = {
      content: [{ type: "text", text: "alpha\n状态\nomega" }],
      details: undefined,
    };
    const state = {};
    const component = bash.renderResult(
      result,
      { expanded, isPartial: false },
      mutableTheme.theme,
      createRenderContext({ args, state, expanded, executionStarted: false }) as never,
    );
    const initial = component.render(32);

    mutableTheme.setBackend(createTheme(1));
    component.invalidate();
    const rebound = bash.renderResult(
      result,
      { expanded, isPartial: false },
      mutableTheme.theme,
      createRenderContext({
        args,
        state,
        expanded,
        lastComponent: component,
        executionStarted: false,
      }) as never,
    );
    const hotAfterThemeChange = rebound.render(32);
    const coldAfterThemeChange = bash.renderResult(
      result,
      { expanded, isPartial: false },
      mutableTheme.theme,
      createRenderContext({ args, state: {}, expanded, executionStarted: false }) as never,
    ).render(32);

    assert.deepEqual(
      hotAfterThemeChange,
      coldAfterThemeChange,
      `expanded=${expanded}`,
    );
    assert.notDeepEqual(hotAfterThemeChange, initial, `expanded=${expanded}`);
  }
});

test("bash row caches stay within the fixed geometry policy", () => {
  const registered: ToolDefinition[] = [];
  registerToolsForTest(registered);
  const bash = registered.find((tool) => tool.name === "bash");
  assert.ok(bash?.renderCall);
  assert.ok(bash.renderResult);

  const args = { command: "printf 'cached geometry'" };
  const state: Record<string, unknown> = {};
  const call = bash.renderCall(
    args,
    theme,
    createRenderContext({ args, state, executionStarted: false, isPartial: false }) as never,
  );
  for (const width of [20, 40, 60]) call.render(width);

  const resultValue = {
    content: [{ type: "text", text: Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n") }],
    details: undefined,
  };
  const result = bash.renderResult(
    resultValue,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, executionStarted: false }) as never,
  );
  for (const width of [20, 40, 60]) result.render(width);

  assert.ok((state.commandGeometry as unknown[]).length <= 2);
  assert.ok(state.commandPaint);
  assert.ok((state.collapsedResultLayouts as unknown[]).length <= 2);

  result.invalidate();
  bash.renderResult(
    resultValue,
    { expanded: true, isPartial: false },
    theme,
    createRenderContext({ args, state, executionStarted: false, lastComponent: result }) as never,
  ).render(80);
  assert.ok(state.expandedResultLayout);

  result.invalidate();
  bash.renderResult(
    resultValue,
    { expanded: false, isPartial: false },
    theme,
    createRenderContext({ args, state, executionStarted: false, lastComponent: result }) as never,
  ).render(40);
  assert.equal(state.expandedResultLayout, undefined);
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
