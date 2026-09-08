import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ToolExecutionComponent, type ExtensionAPI, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../../../extensions/codex-ui/src/tools.js";
import { fixturesFor, type Scene } from "../src/fixtures.js";
import { wrapReadTool, type LabState, type Variant } from "../src/renderers.js";
import { registerReadLab } from "../src/index.js";
const repository = process.env.PI_READ_LAB_REPOSITORY!;
const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const themeModule = await import(pathToFileURL(join(dirname(entry), "modes/interactive/theme/theme.js")).href);
const theme: Theme = themeModule.loadThemeFromPath(join(repository, "themes/codex-pi.json"), "truecolor");
themeModule.setThemeInstance(theme);
function harness(scene: Scene = "single") {
  const tools = new Map<string, ToolDefinition>();
  registerCodexTools({ registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); }, on() {} } as unknown as ExtensionAPI);
  const lab: LabState = { variant: 0, pending: false, fixtures: fixturesFor(scene), invalidators: new Map() };
  const tool = wrapReadTool(tools.get("read")!, lab);
  const rows = lab.fixtures.map(f => {
    const row = new ToolExecutionComponent("read", f.id, f.args, { showImages: false }, tool, { requestRender() {} } as TUI, repository);
    row.updateResult({ content: [{ type: "text", text: f.text }], isError: f.isError ?? false,
      details: { truncation: { truncated: f.truncated ?? false } } });
    return row;
  });
  const switchTo = (variant: Variant) => { lab.variant = variant; for (const invalidate of lab.invalidators.values()) invalidate(); };
  const plain = (width = 120) => stripTerminalSequences(rows.flatMap(row => row.render(width)).join("\n"));
  return { lab, tool, rows, switchTo, plain };
}
test("compact style switches existing host rows to a single summary and restores the baseline", () => {
  const h = harness();
  const baseline = h.plain();
  assert.match(baseline, /Read repository-language-policy.md.*docs\/agents\//u);
  h.switchTo(1);
  assert.equal(h.plain().trim(), "✓ Read repository-language-policy.md · 31 lines");
  h.switchTo(0);
  assert.equal(h.plain(), baseline);
});
test("card, preview, group and timeline have distinct layouts with recoverable detail", () => {
  const h = harness("batch");
  h.switchTo(2);
  assert.match(h.plain(), /╭/u);
  assert.match(h.plain(), /docs\/agents\//u);
  h.switchTo(3);
  assert.match(h.plain(), /1  # Repository language policy/u);
  assert.doesNotMatch(h.plain(), /Fixture policy rule 28/u);
  h.switchTo(4);
  assert.match(h.plain(), /Read 3 files/u);
  assert.equal(h.rows.filter(row => row.render(120).length > 0).length, 1);
  assert.equal(h.plain().trim().split("\n").length, 4);
  for (const row of h.rows) row.setExpanded(true);
  assert.match(h.plain(), /Fixture policy rule 28/u);
  assert.match(h.plain(), /extensions\/codex-ui\/src\/index.ts/u);
  for (const row of h.rows) row.setExpanded(false);
  h.switchTo(5);
  assert.match(h.plain(), /● Read/u);
  assert.match(h.plain(), /│/u);
  h.switchTo(1);
  assert.equal(h.rows.filter(row => row.render(120).length > 0).length, 3);
});
test("group preview combines one group with bounded previews and restores summary-only layout", () => {
  const h = harness("batch");
  h.switchTo(6);
  assert.match(h.plain(), /Read 3 files/u);
  assert.equal(h.rows.filter(row => row.render(120).length > 0).length, 1);
  assert.match(h.plain(), /1  # Repository language policy/u);
  assert.match(h.plain(), /20  export function activate/u);
  assert.doesNotMatch(h.plain(), /Fixture policy rule 28/u);
  for (const row of h.rows) row.setExpanded(true);
  assert.match(h.plain(), /Fixture policy rule 28/u);
  for (const row of h.rows) row.setExpanded(false);
  h.switchTo(4);
  assert.equal(h.plain().trim().split("\n").length, 4);
  assert.doesNotMatch(h.plain(), /# Repository language policy/u);
  const long = harness("long");
  long.switchTo(6);
  long.rows[0]!.updateResult({ content: [{ type: "text", text: "x".repeat(20000) + "\nsecond\nthird\nfourth" }], isError: false });
  for (const width of [12, 40, 80, 120]) {
    const lines = long.rows[0]!.render(width);
    assert(lines.length <= 6, "Preview must use at most three content rows plus a remainder hint");
    for (const line of lines) assert(visibleWidth(line) <= width);
  }
  assert.match(long.plain(), /second/u);
  assert.doesNotMatch(long.plain(), /fourth/u);
});
test("color commands repaint filenames only and preserve layout, preview and baseline", async () => {
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void>; getArgumentCompletions?: (prefix: string) => { value: string }[] | null }>();
  registerCodexTools({ registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); }, on() {} } as unknown as ExtensionAPI);
  const lab = registerReadLab({
    registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerShortcut() {}, on() {},
  } as unknown as ExtensionAPI, tools.get("read")!);
  lab.variant = 6;
  const rows = lab.fixtures.map(f => {
    const row = new ToolExecutionComponent("read", f.id, f.args, { showImages: false }, tools.get("read"), { requestRender() {} } as TUI, repository);
    row.updateResult({ content: [{ type: "text", text: f.text }], isError: false });
    return row;
  });
  const command = commands.get("read-color");
  assert(command, "Register a slash command for filename colors");
  const raw = () => rows.flatMap(row => row.render(120)).join("\n");
  const before = stripTerminalSequences(raw());
  const ctx = { ui: { notify() {} } };
  for (const [color, prefix] of [["cyan", theme.getFgAnsi("accent")], ["soft", "\u001b[38;2;138;191;196m"], ["blue", "\u001b[38;2;157;181;206m"]]) {
    await command.handler(color!, ctx);
    const output = raw();
    assert(output.includes(`${prefix}repository-language-policy.md`));
    assert(output.includes(theme.fg("dim", "  docs/agents/")));
    assert.equal(stripTerminalSequences(output), before);
    assert.equal(lab.variant, 6);
    await commands.get("read-style")!.handler("0", ctx);
    assert(raw().includes(theme.fg("accent", "repository-language-policy.md")));
    assert(!raw().includes(theme.fg("accent", "docs/agents/repository-language-policy.md")));
    await commands.get("read-style")!.handler("6", ctx);
  }
  const last = raw();
  await command.handler("invalid", ctx);
  assert.equal(raw(), last);
  assert.deepEqual(command.getArgumentCompletions?.("s")?.map(item => item.value), ["soft"]);
});
test("all alternatives retain errors, actual ranges, truncation and pending state at narrow widths", () => {
  for (const scene of ["single", "long", "error"] as const) {
    const h = harness(scene);
    for (const variant of [1, 2, 3, 4, 5, 6] as const) {
      h.switchTo(variant);
      if (scene === "long") {
        assert.match(h.plain(), /L120–125/u);
        assert.match(h.plain(), /truncated/u);
      }
      if (scene === "error") assert.match(h.plain(), /ENOENT/u);
      for (const width of [1, 8, 24, 40, 60, 100, 160]) {
        for (const expanded of [false, true]) {
          for (const row of h.rows) {
            row.setExpanded(expanded);
            for (const line of row.render(width)) assert(visibleWidth(line) <= width, `Overflow at ${width}`);
          }
        }
      }
      h.lab.pending = true;
      for (const invalidate of h.lab.invalidators.values()) invalidate();
      assert.match(h.plain(), /Reading/u);
      assert.doesNotMatch(h.plain(), /✓|31 lines|ENOENT/u);
      h.lab.pending = false;
    }
  }
});
