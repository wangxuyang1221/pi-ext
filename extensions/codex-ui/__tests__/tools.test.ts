import assert from "node:assert/strict";
import { test } from "vitest";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

import {
  parseDisplayDiff,
  registerCodexTools,
  renderDisplayDiff,
  type CodexToolFactories,
} from "../src/tools.js";

function createTheme(): Theme {
  return {
    fg: (name: string, text: string) => {
      const code = name === "error" ? 196 : name === "success" ? 82 : 81;
      return `\x1b[38;5;${code}m${text}\x1b[39m`;
    },
    bg: (name: string, text: string) => {
      const code = name === "toolErrorBg" ? 52 : 22;
      return `\x1b[48;5;${code}m${text}\x1b[49m`;
    },
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  } as unknown as Theme;
}

const theme = createTheme();

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
      prepareArguments: name === "edit" ? (args: unknown) => args : undefined,
      async execute() {
        executed.push({ name, cwd });
        return { content: [{ type: "text", text: "ok" }], details: undefined };
      },
    };
  };

  const factories = {
    read: factory("read"),
    edit: factory("edit"),
    write: factory("write"),
  } as unknown as CodexToolFactories;
  const registered: ToolDefinition[] = [];
  const pi = {
    registerTool(tool: ToolDefinition) {
      registered.push(tool);
    },
  } as unknown as ExtensionAPI;

  registerCodexTools(pi, factories);

  assert.deepEqual(registered.map((tool) => tool.name), ["read", "edit", "write"]);
  for (const tool of registered) {
    assert.equal(tool.promptSnippet, `${tool.name} snippet`);
    assert.deepEqual(tool.promptGuidelines, [`Use ${tool.name}.`]);
    assert.deepEqual(tool.constrainedSampling, { mode: "strict" });
    assert.equal(tool.renderShell, "self");
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
