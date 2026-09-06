import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ToolExecutionComponent, type ExtensionAPI, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../../../extensions/codex-ui/src/tools.js";
import { fixturesFor, MCP_NAME, SCENES, type Scene } from "../src/fixtures.js";
import { registerSummaryLab } from "../src/index.js";
import { alignRight, codexPreview } from "../src/renderers.js";

const repository = process.env.PI_SUMMARY_LAB_REPOSITORY!;
const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const themeModule = await import(pathToFileURL(join(dirname(entry), "modes/interactive/theme/theme.js")).href);
const theme: Theme = themeModule.loadThemeFromPath(join(repository, "themes/codex-pi.json"), "truecolor");
themeModule.setThemeInstance(theme);
const plain = (row: ToolExecutionComponent, width = 120) => stripTerminalSequences(row.render(width).join("\n"));

function harness(scene: Scene = "success", expandKey = "ctrl+o") {
  const tools = new Map<string, ToolDefinition>();
  registerCodexTools({ registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); }, on() {} } as unknown as ExtensionAPI);
  const originalWrite = tools.get("write")!;
  const events = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, { handler: (...args: any[]) => any }>();
  const shortcuts = new Map<string, { handler: (...args: any[]) => any }>();
  const lab = registerSummaryLab({
    registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); },
    on(event: string, handler: (...args: any[]) => any) { events.set(event, handler); },
    registerCommand(name: string, command: { handler: (...args: any[]) => any }) { commands.set(name, command); },
    registerShortcut(key: string, command: { handler: (...args: any[]) => any }) { shortcuts.set(key, command); },
  } as unknown as ExtensionAPI, originalWrite);
  const editor = {};
  events.get("session_start")!({}, { mode: "tui", ui: {
    getEditorComponent: () => () => editor,
    setEditorComponent(factory: (...args: any[]) => any) {
      assert.equal(factory({}, theme, new KeybindingsManager({ "app.tools.expand": { defaultKeys: expandKey as "ctrl+o" } })), editor);
    }, setWidget() {},
  } });
  const rows = fixturesFor(scene).map(fixture => {
    const row = new ToolExecutionComponent(fixture.name, fixture.id, fixture.args, { showImages: false }, tools.get(fixture.name), { requestRender() {} } as TUI, repository);
    row.updateResult({ content: [{ type: "text", text: fixture.text }], isError: fixture.isError });
    // Session restoration can supply a final result without an argsComplete transition.
    return row;
  });
  const switchTo = (variant: number) => commands.get("summary-style")!.handler(String(variant), {});
  return { lab, tools, rows, events, commands, shortcuts, switchTo, dispose: () => events.get("session_shutdown")!() };
}

test("three variants switch existing host rows without replaying tools", async () => {
  const h = harness();
  try {
    await h.switchTo(1);
    assert.match(plain(h.rows[0]!), /└ Completed · Text · .*ctrl\+o expand/u);
    assert.equal(plain(h.rows[1]!).trim(), "• Write src/config.ts (20 lines)");
    await h.switchTo(2);
    assert.doesNotMatch(plain(h.rows[0]!), /Completed|└/u);
    assert.match(plain(h.rows[0]!), /\n  Text · .* +ctrl\+o expand/u);
    assert.equal((plain(h.rows[1]!).match(/20 lines/gu) ?? []).length, 1);
    await h.switchTo(3);
    for (const row of h.rows) assert.equal(plain(row).trim().split("\n").length, 1);
    assert.match(plain(h.rows[0]!), /Called context7 \/ resolve-library-id \(TypeScript\) +.*ctrl\+o expand/u);
    assert.equal(plain(h.rows[1]!).trim(), "• Write src/config.ts (20 lines)");
    await h.shortcuts.get("alt+1")!.handler();
    assert.match(plain(h.rows[0]!), /Completed/u);
  } finally { h.dispose(); }
});

test("the original three MCP success summaries do not use the success color", async () => {
  const successPrefix = theme.fg("success", "COLOR-SENTINEL").split("COLOR-SENTINEL")[0]!;
  const h = harness();
  try {
    for (const variant of [1, 2, 3]) {
      await h.switchTo(variant);
      for (const row of [h.rows[0]!, h.rows[2]!]) assert(!row.render(120).join("\n").includes(successPrefix));
    }
  } finally { h.dispose(); }
});

test("real expansion keeps identical production text and JSON details across variants", async () => {
  const h = harness();
  try {
    const bodies: string[][] = [];
    for (const variant of [1, 2, 3, 4]) {
      await h.switchTo(variant);
      for (const row of h.rows) row.setExpanded(true);
      bodies.push([0, 2].map(index => plain(h.rows[index]!).split("\n").filter(line => line.startsWith("    ")).join("\n")));
      assert.match(plain(h.rows[0]!), /Available Libraries:/u);
      assert.match(plain(h.rows[2]!), /"source": "fixture"/u);
      assert.doesNotMatch(plain(h.rows[1]!), /export const setting/u);
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[1], bodies[2]);
    assert.deepEqual(bodies[2], bodies[3]);
    await h.switchTo(3);
    for (const row of h.rows) row.setExpanded(false);
    assert.doesNotMatch(plain(h.rows[0]!), /Available Libraries:/u);
  } finally { h.dispose(); }
});

test("all scenes and variants fit narrow, wide, and Unicode terminal widths", async () => {
  for (const scene of SCENES) {
    const h = harness(scene);
    try {
      for (const variant of [1, 2, 3, 4]) {
        await h.switchTo(variant);
        for (const expanded of [false, true]) for (const row of h.rows) {
          row.setExpanded(expanded);
          for (const width of [0, 1, 2, 8, 24, 48, 60, 80, 120, 200]) {
            const lines = row.render(width);
            assert(lines.every(line => visibleWidth(line) <= width), `${scene}/${variant}/${expanded}/${width}`);
          }
        }
      }
    } finally { h.dispose(); }
  }
});

test("single-line layout drops metadata before shortening a long path", async () => {
  const h = harness("long");
  try {
    await h.switchTo(3);
    const title = plain(h.rows[1]!, 60);
    assert.match(title, /Write src\/中文目录\/deeply-nested-component/u);
    assert.doesNotMatch(title, /20 lines|\d+ B/u);
    assert.equal(title.trim().split("\n").length, 1);
    assert.equal(visibleWidth(alignRight("left", "right", 20)), 20);
  } finally { h.dispose(); }
});

test("failure status remains explicit and red in every variant", async () => {
  const h = harness("error");
  try {
    for (const variant of [1, 2, 3, 4]) {
      await h.switchTo(variant);
      assert.match(plain(h.rows[0]!), /Failed/u);
      assert.match(plain(h.rows[1]!), /Write failed: permission denied/u);
      assert(h.rows[0]!.render(120).join("\n").includes(theme.fg("error", "Failed")));
      assert.doesNotMatch(plain(h.rows[1]!), /Written|20 lines ·/u);
    }
  } finally { h.dispose(); }
});

test("partial MCP keeps Running while Write uses only the pending marker", async () => {
  const h = harness();
  try {
    for (const row of h.rows) row.updateResult({ content: [{ type: "text", text: "" }], isError: false }, true);
    for (const variant of [1, 2, 3, 4]) {
      await h.switchTo(variant);
      assert.match(plain(h.rows[0]!), /Running/u);
      assert.equal(plain(h.rows[1]!).trim(), "• Write src/config.ts");
      assert(h.rows[1]!.render(120).join("\n").includes(theme.fg("warning", "•")));
      assert.doesNotMatch(plain(h.rows[0]!), /Completed/u);
    }
  } finally { h.dispose(); }
});

test("expand hints use the injected host keybinding", async () => {
  const h = harness("success", "ctrl+shift+o");
  try {
    for (const variant of [1, 2, 3]) {
      await h.switchTo(variant);
      assert.match(plain(h.rows[0]!), /ctrl\+shift\+o expand/u);
    }
  } finally { h.dispose(); }
});

test("Codex variant colors only the MCP success marker and folds output to a preview", async () => {
  const h = harness();
  try {
    await h.shortcuts.get("alt+4")!.handler();
    assert.equal(h.lab.variant, 4);
    const lines = h.rows[0]!.render(120).filter(line => stripTerminalSequences(line).trim());
    assert(lines[0]!.includes(theme.fg("success", theme.bold("•"))));
    assert.match(plain(h.rows[0]!), /└ Available Libraries:/u);
    assert.match(plain(h.rows[0]!), /\.\.\./u);
    assert(lines.length <= 6);
    assert.doesNotMatch(plain(h.rows[0]!), /Completed|Text ·|\d+ B|expand/u);
    for (const line of lines.slice(1)) assert.equal(line, theme.fg("dim", stripTerminalSequences(line)));
    assert.equal(plain(h.rows[1]!).trim(), "• Write src/config.ts (20 lines)");
    h.rows[0]!.setExpanded(true);
    assert.match(plain(h.rows[0]!), /TypeScript examples/u);
    h.rows[0]!.setExpanded(false);
    assert.doesNotMatch(plain(h.rows[0]!), /TypeScript examples/u);
    await h.switchTo(1);
    assert.match(plain(h.rows[0]!), /Completed/u);
    assert.doesNotMatch(plain(h.rows[0]!), /Available Libraries:/u);
  } finally { h.dispose(); }
});

test("Codex preview bounds rows, preserves JSON strings, and handles empty output", () => {
  assert.deepEqual(codexPreview("", theme, 120), []);
  const value = { label: 'a,b:c \\"quoted\\"', path: "中文目录/路径", count: 2 };
  const lines = codexPreview(JSON.stringify(value), theme, 200);
  const text = stripTerminalSequences(lines.join("\n")).replace(/^  └ /u, "");
  assert.deepEqual(JSON.parse(text), value);
  assert.match(text, /"count": 2/u);
  for (const width of [0, 1, 2, 4, 5, 20, 60, 120]) {
    const preview = codexPreview("中文内容 ".repeat(100) + "\n".repeat(10), theme, width);
    assert(preview.length <= 5);
    assert(preview.every(line => visibleWidth(line) <= width));
  }
});

test("Write hides streaming line counts and reveals only the final total", async () => {
  const h = harness();
  const row = h.rows[1]!;
  try {
    for (const variant of [1, 2, 3, 4]) {
      await h.switchTo(variant);
      row.updateResult({ content: [{ type: "text", text: "" }], isError: false }, true);
      for (const count of [0, 3, 10, 20]) {
        row.updateArgs({ path: "src/config.ts", content: Array(count).fill("fixture").join("\n") });
        assert.equal(plain(row).trim(), "• Write src/config.ts");
        assert(row.render(120).join("\n").includes(theme.fg("warning", "•")));
      }
      row.updateResult({ content: [{ type: "text", text: "Written" }], isError: false });
      assert.equal(plain(row).trim(), "• Write src/config.ts (20 lines)");
      assert(row.render(120).join("\n").includes(theme.fg("success", "•")));
      row.setExpanded(true);
      assert.equal(plain(row).trim(), "• Write src/config.ts (20 lines)");
      row.setExpanded(false);
    }
  } finally { h.dispose(); }
});

test("Write replay settles automatically and clears timers on restart and shutdown", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  try {
    await h.shortcuts.get("alt+r")!.handler();
    assert(h.lab.writeInProgress);
    assert.equal(plain(h.rows[1]!).trim(), "• Write src/config.ts");
    t.mock.timers.tick(3000);
    await h.commands.get("write-replay")!.handler();
    t.mock.timers.tick(1000);
    assert(h.lab.writeInProgress);
    t.mock.timers.tick(3000);
    assert.equal(h.lab.writeInProgress, false);
    assert.equal(plain(h.rows[1]!).trim(), "• Write src/config.ts (20 lines)");
    await h.commands.get("write-replay")!.handler();
    await h.commands.get("write-settle")!.handler();
    assert.equal(h.lab.writeInProgress, false);
    await h.commands.get("write-replay")!.handler();
  } finally { h.dispose(); }
  t.mock.timers.tick(5000);
  assert.equal(h.lab.writeInProgress, false);
  assert.equal(h.lab.invalidators.size, 0);
});

test("execution is blocked and shutdown releases all row invalidators", async () => {
  const h = harness();
  assert(h.lab.invalidators.size > 0);
  assert.deepEqual(h.events.get("input")!({}, { ui: { notify() {} } }), { action: "handled" });
  assert.equal(h.events.get("tool_call")!().block, true);
  assert.equal(h.events.get("user_bash")!().result.exitCode, 1);
  for (const name of ["write", MCP_NAME]) await assert.rejects(h.tools.get(name)!.execute("test", {}, undefined, undefined, {} as never), /disabled/u);
  h.dispose();
  assert.equal(h.lab.invalidators.size, 0);
});
