import { hasWriteChange, writeChange, writePatch } from "./fixtures/write-result.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, vi } from "vitest";
import { initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parseDisplayDiff, parseUnifiedPatch, registerCodexTools } from "../src/tools.js";
import { sanitizeDiffSource } from "../src/diff-source.js";
import * as diffSource from "../src/diff-source.js";

// Interpret CR after removing only renderer SGR, not arbitrary terminal controls.
function paintRow(line: string): string {
  const cells: string[] = [];
  let column = 0;
  for (const character of line.replace(/\x1b\[[0-9;]*m/gu, "")) {
    if (character === "\r") column = 0;
    else cells[column++] = character;
  }
  return cells.join("").trimEnd();
}

test("real Write CRLF diffs retain source, line numbers and signs after terminal carriage returns", async () => {
  initTheme("dark", false);
  const cwd = await mkdtemp(join(process.cwd(), ".diff-display-"));
  const tools: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => tools.push(tool), on() {} } as unknown as ExtensionAPI);
  const write = tools.find(tool => tool.name === "write")!;
  try {
    for (const path of ["file.txt", "file.ts"]) {
      await writeFile(join(cwd, path), "old\r\n");
      const args = { path, content: "new\r\n" };
      const result = await write.execute(path, args, undefined, undefined, { cwd } as never);
      const patch = writePatch(result);
      assert.match(patch, /-old\r\n\+new\r\n/u);
      const row = new ToolExecutionComponent("write", path, args, { showImages: false }, write, { requestRender() {} } as never, cwd);
      row.updateResult({ ...result, isError: false });
      for (const expanded of [false, true]) {
        row.setExpanded(expanded);
        const lines = row.render(40);
        const painted = lines.map(paintRow).join("\n");
        assert.match(painted, /1 - old/u);
        assert.match(painted, /1 \+ new/u);
        assert(lines.every(line => visibleWidth(line) <= 40));
      }
      assert.equal(writeChange(result).patch, patch);
      assert.equal(await readFile(join(cwd, path), "utf8"), "new\r\n");
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("real Write sanitizes source controls without changing the file or saved patch", async () => {
  initTheme("dark", false);
  const cwd = await mkdtemp(join(process.cwd(), ".diff-display-"));
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool), on() {} } as unknown as ExtensionAPI);
  const write = registered.find(tool => tool.name === "write")!;
  try {
    for (const path of ["controls.txt", "controls.ts"]) {
      const content = 'const x = "before\x1b[2J\x1b[H\x1b]0;bad-title\x07after";\r\n';
      const args = { path, content };
      const result = await write.execute(path, args, undefined, undefined, { cwd } as never);
      assert(writePatch(result).includes(content));
      const row = new ToolExecutionComponent("write", path, args, { showImages: false }, write, { requestRender() {} } as never, cwd);
      row.updateResult({ ...result, isError: false });
      const rendered = row.render(100).join("\n").replace(/\x1b\[[0-9;]*m/gu, "");
      assert.doesNotMatch(rendered, /[\r\x1b\x07]/u);
      assert.match(rendered, /beforeafter/u);
      assert.equal(await readFile(join(cwd, path), "utf8"), content);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("real Write keeps ordinary source immediately after every CSI cursor terminator", async () => {
  initTheme("dark", false);
  const cwd = await mkdtemp(join(process.cwd(), ".diff-display-"));
  const tools: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => tools.push(tool), on() {} } as unknown as ExtensionAPI);
  const write = tools.find(tool => tool.name === "write")!;
  try {
    for (const path of ["cursor.txt", "cursor.ts"]) for (const terminator of ["A", "B", "C", "D", "E", "F", "f", "s", "u", "~"]) {
      await writeFile(join(cwd, path), "old\n");
      const source = path.endsWith(".ts") ? `const x = "before\x1b[1${terminator}middle";` : `left\x1b[1${terminator}right marker`;
      const expected = path.endsWith(".ts") ? 'const x = "beforemiddle";' : "leftright marker";
      const result = await write.execute(path, { path, content: source + "\r\n" }, undefined, undefined, { cwd } as never);
      const patch = writePatch(result);
      assert.equal(parseUnifiedPatch(patch).at(-1)?.text, expected);
      const row = new ToolExecutionComponent("write", path, { path, content: source + "\r\n" }, { showImages: false },
        write, { requestRender() {} } as never, cwd);
      row.updateResult({ ...result, isError: false });
      for (const expanded of [false, true]) {
        row.setExpanded(expanded);
        assert(row.render(100).map(paintRow).join("\n").includes(expected));
      }
      assert(patch.includes(source)); assert.equal(await readFile(join(cwd, path), "utf8"), source + "\r\n");
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("display parsers remove source terminal commands before syntax highlighting", () => {
  const hostile = 'before\x1b[2J\x1b[1;1H\x1b]0;injected\x07\x1b[31mred\x1b[0m\b\r\x7f\x9b1Cafter';
  const patch = `--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+${hostile}\n`;
  assert.equal(parseUnifiedPatch(patch).at(-1)?.text, "beforeredafter");
  assert.equal(parseDisplayDiff(`+1 ${hostile}`).at(-1)?.text, "beforeredafter");
  assert(patch.includes("\x1b[2J"), "The persisted patch is not rewritten");
});

test("source sanitization recognizes full CSI boundaries and terminated or incomplete string controls", () => {
  for (let final = 0x40; final <= 0x7e; final++) for (const introducer of ["\x1b[", "\x9b"]) {
    const source = `left${introducer}?1;2 ${String.fromCharCode(final)}right marker`;
    assert.equal(sanitizeDiffSource(source), "leftright marker");
    assert.equal(parseDisplayDiff(`+1 ${source}`)[0]?.text, "leftright marker");
  }
  for (const introducer of ["\x1b]", "\x1bP", "\x1bX", "\x1b^", "\x1b_", "\x9d", "\x90", "\x98", "\x9e", "\x9f"]) {
    for (const end of ["\x07", "\x1b\\", "\x9c"]) {
      assert.equal(sanitizeDiffSource(`left${introducer}hidden;\x1b[1C${end}right marker`), "leftright marker");
    }
    assert.equal(sanitizeDiffSource(`left${introducer}unterminated`), "left");
  }
  for (const source of ["left\x1b", "left\x1b[", "left\x1b[123;", "left\x1b[1 ", "left\x9b1;"]) {
    assert.equal(sanitizeDiffSource(source), "left");
  }
  assert.equal(sanitizeDiffSource("a\x1b(0b\x1b7c\x1b[1\x1b[2Jd\x1b[1💚e\t\r\bf"), "abcd💚e\tf");
  assert.deepEqual(parseUnifiedPatch("@@ -0,0 +1,2 @@\n+left\x1b]unclosed\n+next line\n").map(line => line.text), ["left", "next line"]);
});

test("stable Write diffs reuse sanitized source across paints, widths and expansion", async () => {
  initTheme("dark", false);
  const cwd = await mkdtemp(join(process.cwd(), ".diff-display-"));
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool: (tool: ToolDefinition) => registered.push(tool), on() {} } as unknown as ExtensionAPI);
  const write = registered.find(tool => tool.name === "write")!;
  const spy = vi.spyOn(diffSource, "sanitizeDiffSource");
  try {
    const args = { path: "cache.ts", content: 'const x = "before\x1b[1Cmiddle";\n'.repeat(100) };
    const result = await write.execute("cache", args, undefined, undefined, { cwd } as never);
    const row = new ToolExecutionComponent("write", "cache", args, { showImages: false }, write, { requestRender() {} } as never, cwd);
    row.updateResult({ ...result, isError: false }); row.render(80);
    const calls = spy.mock.calls.length; assert(calls > 0);
    for (const expanded of [true, false]) for (const width of [40, 80, 120]) {
      row.setExpanded(expanded); row.invalidate();
      const lines = row.render(width);
      assert(lines.some(line => /\x1b\[[\d;]*m/u.test(line)), "Renderer colors must survive source sanitization");
      assert(lines.map(paintRow).join("\n").includes("beforemiddle"));
    }
    assert.equal(spy.mock.calls.length, calls);
  } finally { spy.mockRestore(); await rm(cwd, { recursive: true, force: true }); }
});

test("dense and incomplete control scanning stays linear", () => {
  for (const count of [100, 1000]) for (const source of [
    "left\x1b[1Cright marker".repeat(count), "\x1b[".repeat(count) + "1".repeat(count),
    "\x1b]".repeat(count) + "unterminated".repeat(count), "ordinary 中文\t".repeat(count),
  ]) {
    let inspected = 0;
    const charCodeAt = String.prototype.charCodeAt;
    const spy = vi.spyOn(String.prototype, "charCodeAt").mockImplementation(function (this: string, index: number) {
      inspected++; return charCodeAt.call(this, index);
    });
    let clean: string;
    try { clean = sanitizeDiffSource(source); } finally { spy.mockRestore(); }
    assert(inspected <= source.length * 8, "Each source character must require bounded scanning work");
    assert.doesNotMatch(clean!, /[\x1b\x90-\x9f]/u);
  }
});

test("mixed line endings, blank lines, tabs and long source retain display structure", () => {
  const patch = `@@ -1,3 +1,3 @@\n-same\r\n-\r\n-old\n+same\n+\r\n+\t${"x".repeat(5000)}\r\n`;
  const lines = parseUnifiedPatch(patch);
  assert.deepEqual(lines.map(line => line.lineNumber), [1, 2, 3, 1, 2, 3]);
  assert.deepEqual(lines.map(line => line.text), ["same", "", "old", "same", "", "\t" + "x".repeat(5000)]);
});
