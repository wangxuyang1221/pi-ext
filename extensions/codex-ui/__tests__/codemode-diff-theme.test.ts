import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { initTheme, loadThemeFromPath, setThemeInstance, theme } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { CodemodeStore } from "../src/codemode-model.js";
import { CodemodePresentation } from "../src/codemode-presentation.js";
import { registerCodexTools } from "../src/tools.js";

test.each(["edit", "write"])("nested %s diff follows syntax-only theme changes in the tree and inspector", name => {
  const directory = mkdtempSync(join(tmpdir(), "codemode-theme-"));
  const file = join(directory, "theme.json");
  const palette = JSON.parse(readFileSync("themes/codex-pi.json", "utf8"));
  function recolor(keyword: string) {
    palette.colors.syntaxKeyword = keyword;
    writeFileSync(file, JSON.stringify(palette));
    setThemeInstance(loadThemeFromPath(file, "truecolor"));
  }
  try {
    const renderers = registerCodexTools({ registerTool() {}, on() {} } as unknown as ExtensionAPI);
    const store = new CodemodeStore();
    store.event({ type: "tool_execution_start", toolName: "codemode", toolCallId: "p" });
    const call = { toolName: name, toolCallId: "p/1", parentToolCallId: "p" };
    const code = "const flag = true;";
    store.event({ ...call, type: "tool_execution_start", args: { path: "fixture.ts", content: code, edits: [] } });
    const details = name === "edit" ? { diff: `+1 ${code}` } : {
      codexWrite: { version: 1, action: "Added", patch: `@@ -0,0 +1 @@\n+${code}` },
    };
    store.event({ ...call, type: "tool_execution_end", result: { content: [], details } });
    const row = store.get("p")!;
    const draw = (view: CodemodePresentation) => [
      view.tree(row, theme, 100, true, directory, "ctrl+o"),
      view.detail(row, { tab: "Calls", selected: 0, scroll: 0 }, theme, 100, directory),
    ];
    const view = new CodemodePresentation(store, renderers);
    recolor("#ff0000");
    for (const lines of draw(view)) assert.match(lines.join("\n"), /38;2;255;0;0mconst/);
    recolor("#00ff00");
    const expected = draw(new CodemodePresentation(store, renderers));
    for (const lines of expected) assert.match(lines.join("\n"), /38;2;0;255;0mconst/);
    assert.deepEqual(draw(view), expected);
  } finally {
    initTheme("dark", false);
    rmSync(directory, { recursive: true, force: true });
  }
});
