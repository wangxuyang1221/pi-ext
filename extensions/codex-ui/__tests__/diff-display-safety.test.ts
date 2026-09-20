import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parseDisplayDiff, parseUnifiedPatch, registerCodexTools } from "../src/tools.js";

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
      const patch = result.details.codexWrite.patch;
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
      assert.equal(result.details.codexWrite.patch, patch);
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
      assert(result.details.codexWrite.patch.includes(content));
      const row = new ToolExecutionComponent("write", path, args, { showImages: false }, write, { requestRender() {} } as never, cwd);
      row.updateResult({ ...result, isError: false });
      const rendered = row.render(100).join("\n").replace(/\x1b\[[0-9;]*m/gu, "");
      assert.doesNotMatch(rendered, /[\r\x1b\x07]/u);
      assert.match(rendered, /beforeafter/u);
      assert.equal(await readFile(join(cwd, path), "utf8"), content);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("display parsers remove source terminal commands before syntax highlighting", () => {
  const hostile = 'before\x1b[2J\x1b[1;1H\x1b]0;injected\x07\x1b[31mred\x1b[0m\b\r\x7f\x9bafter';
  const patch = `--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+${hostile}\n`;
  assert.equal(parseUnifiedPatch(patch).at(-1)?.text, "beforeredafter");
  assert.equal(parseDisplayDiff(`+1 ${hostile}`).at(-1)?.text, "beforeredafter");
  assert(patch.includes("\x1b[2J"), "The persisted patch is not rewritten");
});

test("mixed line endings, blank lines, tabs and long source retain display structure", () => {
  const patch = `@@ -1,3 +1,3 @@\n-same\r\n-\r\n-old\n+same\n+\r\n+\t${"x".repeat(5000)}\r\n`;
  const lines = parseUnifiedPatch(patch);
  assert.deepEqual(lines.map(line => line.lineNumber), [1, 2, 3, 1, 2, 3]);
  assert.deepEqual(lines.map(line => line.text), ["same", "", "old", "same", "", "\t" + "x".repeat(5000)]);
});
