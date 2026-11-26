import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { initTheme, loadThemeFromPath, setThemeInstance, theme } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { CodemodeStore } from "../src/codemode-model.js";
import { CodemodePresentation } from "../src/codemode-presentation.js";
import { hostKeybindingHints } from "../src/keybinding-hints.js";
import { registerCodexTools } from "../src/tools.js";

const samples = [
  { path: "fixture.ts", code: "const flag = true;", token: "syntaxKeyword", fragment: "const" },
  { path: "fixture.c", code: "#define FLAG 1", token: "muted", fragment: "#" },
];
const cases = ["edit", "write"].flatMap(name => samples.map(sample => ({ name, ...sample })));

test.each(cases)("$name diff follows $token in the tool, tree and inspector", ({ name, path, code, token, fragment }) => {
  const directory = mkdtempSync(join(tmpdir(), "codemode-theme-"));
  const file = join(directory, "theme.json");
  const palette = JSON.parse(readFileSync("themes/codex-pi.json", "utf8"));
  function recolor(color: string) {
    palette.colors[token] = color;
    writeFileSync(file, JSON.stringify(palette));
    setThemeInstance(loadThemeFromPath(file, "truecolor"));
  }
  try {
    const renderers = registerCodexTools({ registerTool() {}, on() {} } as unknown as ExtensionAPI);
    const store = new CodemodeStore();
    store.event({ type: "tool_execution_start", toolName: "codemode", toolCallId: "p" });
    const call = { toolName: name, toolCallId: "p/1", parentToolCallId: "p" };
    const args = { path, content: code, edits: [] };
    store.event({ ...call, type: "tool_execution_start", args });
    const details = name === "edit" ? { diff: `+1 ${code}` } : {
      codexWrite: { version: 1, action: "Added", patch: `@@ -0,0 +1 @@\n+${code}` },
    };
    const result = { content: [], details };
    store.event({ ...call, type: "tool_execution_end", result });
    const row = store.get("p")!;
    function mount() {
      const view = new CodemodePresentation(store, renderers);
      const context = { ...hostKeybindingHints({}), toolCallId: call.toolCallId, args, state: {}, cwd: directory,
        lastComponent: undefined, executionStarted: true, argsComplete: true, isPartial: false, expanded: true,
        showImages: false, isError: false, durationMs: undefined, outputPad: 0, invalidate() {} };
      const direct = renderers.get(name)!.renderResult!(result, { expanded: true, isPartial: false }, theme, context);
      return () => {
        direct.invalidate();
        return [
          direct.render(100),
          view.tree(row, theme, 100, true, directory, "ctrl+o"),
          view.detail(row, { tab: "Calls", selected: 0, scroll: 0 }, theme, 100, directory),
        ];
      };
    }
    recolor("#ff0000");
    const draw = mount();
    for (const lines of draw()) assert.ok(lines.join("\n").includes(`38;2;255;0;0m${fragment}`));
    recolor("#00ff00");
    const drawFresh = mount();
    const expected = drawFresh();
    for (const lines of expected) assert.ok(lines.join("\n").includes(`38;2;0;255;0m${fragment}`));
    assert.deepEqual(draw(), expected);
  } finally {
    initTheme("dark", false);
    rmSync(directory, { recursive: true, force: true });
  }
});
