import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ToolExecutionComponent, type ExtensionAPI, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { LabController } from "../src/controller.js";
import { fixturesFor, LAST_FRAME, parseScene, playbackRows, SCENES } from "../src/fixtures.js";
import bashUiPrototype, { registerBashLab } from "../src/index.js";
import { clean, renderGroup } from "../src/renderers.js";
import { registerCodexTools } from "../../../extensions/codex-ui/src/tools.js";

const repository = process.env.PI_BASH_LAB_REPOSITORY!;
const agentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const themeModule = await import(pathToFileURL(join(dirname(agentEntry), "modes/interactive/theme/theme.js")).href);
const theme: Theme = themeModule.loadThemeFromPath(join(repository, "themes/codex-pi.json"), "truecolor");
themeModule.setThemeInstance(theme);
const plain = (lines: string[]) => stripTerminalSequences(lines.join("\n"));

function harness(expandKey: "ctrl+o" | "ctrl+shift+o" = "ctrl+o") {
  const controller = new LabController();
  let tool: ToolDefinition | undefined;
  const events = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, { handler: (...args: any[]) => any }>();
  const shortcuts = new Set<string>();
  registerBashLab({
    registerTool(value: ToolDefinition) { tool = value; },
    on(event: string, handler: (...args: any[]) => any) { events.set(event, handler); },
    registerCommand(name: string, command: { handler: (...args: any[]) => any }) { commands.set(name, command); },
    registerShortcut(key: string) { shortcuts.add(key); },
  } as unknown as ExtensionAPI, controller);
  assert(tool);
  const injectedKeybindings = new KeybindingsManager({ "app.tools.expand": { defaultKeys: expandKey } });
  const editor = {};
  events.get("session_start")?.({}, { mode: "tui", ui: {
    getEditorComponent: () => () => editor,
    setEditorComponent(factory: (...args: any[]) => any) { assert.equal(factory({}, {}, injectedKeybindings), editor); },
    setWidget() {},
  } });
  const ui = { requestRender() {} } as TUI;
  const rows = fixturesFor("mixed").map(fixture => {
    const row = new ToolExecutionComponent("bash", fixture.id, { command: fixture.command, timeout: fixture.timeout }, { showImages: false }, tool, ui, repository);
    row.updateResult({ content: [{ type: "text", text: fixture.output.join("\n") }], isError: fixture.status === "failed" });
    row.setArgsComplete();
    return row;
  });
  return { controller, tool, rows, events, commands, shortcuts, dispose: () => events.get("session_shutdown")?.() };
}

test("grouped rendering fits every fixture state and terminal width", () => {
  for (const scene of SCENES) for (const frame of [null, 0, 2, 7, LAST_FRAME]) {
    const rows = playbackRows(scene, frame);
    for (const expanded of [false, true]) for (const width of [0, 1, 2, 6, 24, 48, 64, 80, 120]) {
      const lines = renderGroup(rows, expanded, theme, width, `ctrl+o ${expanded ? "collapse" : "expand"}`);
      assert(lines.every(line => visibleWidth(line) <= width), `${scene}/${frame}/${expanded}/${width}`);
      if (!width) assert.equal(lines.length, 0);
    }
  }
});

test("collapsed results keep every command visible without diagnostic previews", () => {
  const lines = renderGroup(fixturesFor("mixed"), false, theme, 120, "ctrl+o expand");
  assert.equal(lines.length, 4);
  const text = plain(lines);
  assert.match(text, /^  Bash · 3 commands · 2 succeeded · 1 failed +ctrl\+o expand/u);
  for (const row of fixturesFor("mixed")) assert(text.includes(row.command));
  assert.doesNotMatch(text, /AssertionError|Build completed|successful commands folded/u);
  assert(lines.every(line => stripTerminalSequences(line).trim() !== ""));
});

test("an all-success group retains its three commands while hiding results", () => {
  const lines = renderGroup(fixturesFor("success"), false, theme, 120, "ctrl+o expand");
  assert.equal(lines.length, 4);
  assert.match(plain(lines), /3 succeeded/u);
  for (const row of fixturesFor("success")) assert(plain(lines).includes(row.command));
  assert.doesNotMatch(plain(lines), /Typecheck completed|Build completed/u);
});

test("Bash aligns with the actual production Read and Edited labels", () => {
  const tools = new Map<string, ToolDefinition>();
  registerCodexTools({ registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); }, on() {} } as unknown as ExtensionAPI);
  const bashColumn = stripTerminalSequences(renderGroup(fixturesFor("success"), false, theme, 120, "ctrl+o expand")[0]!).indexOf("Bash");
  for (const [name, label] of [["read", "Read"], ["edit", "Edited"]]) {
    const row = new ToolExecutionComponent(name!, `reference-${name}`, { path: "fixture.ts", edits: [] },
      { showImages: false }, tools.get(name!), { requestRender() {} } as TUI, repository);
    row.updateResult({ content: [{ type: "text", text: "fixture" }], isError: false });
    row.setArgsComplete();
    const title = row.render(120).map(line => stripTerminalSequences(line)).find(line => line.includes(label!));
    assert(title);
    assert.equal(bashColumn, title.indexOf(label!));
  }
});

test("collapsed commands use a one-line preview capped at 120 columns", () => {
  const row = { ...fixturesFor("success")[0]!, command: "alpha\n  beta " + "long-command-".repeat(12) + " END-MARKER", output: ["OUTPUT-MARKER"] };
  for (const width of [24, 48, 120, 300]) {
    const collapsed = renderGroup([row], false, theme, width, "ctrl+o expand").slice(1);
    const expanded = renderGroup([row], true, theme, width, "ctrl+o collapse").slice(1);
    assert.equal(collapsed.length, 1);
    assert.match(plain(collapsed), /\.\.\./u);
    assert.doesNotMatch(plain(collapsed), /END-MARKER|OUTPUT-MARKER/u);
    assert.match(plain(expanded), /END-MARKER/u);
    assert.match(plain(expanded), /OUTPUT-MARKER/u);
    const command = stripTerminalSequences(collapsed[0]!).slice(8).split(/ {3,}/u)[0]!;
    assert(visibleWidth(command) <= 120);
  }
});

test("collapsed results are not read for any execution state", () => {
  for (const status of ["completed", "failed", "timeout", "cancelled", "running", "pending"] as const) {
    const row = { ...fixturesFor("success")[0]!, status, get output(): string[] { throw new Error("Collapsed capture must not be read"); } };
    const text = plain(renderGroup([row], false, theme, 120, "ctrl+o expand"));
    assert(text.includes(row.command));
  }
});

test("expanded commands have no duplicated command or synthetic gap before output", () => {
  const rows = fixturesFor("success").map((row, index) => ({ ...row, command: `command-${index + 1}`, output: [`output-${index + 1}`] }));
  const lines = renderGroup(rows, true, theme, 120, "ctrl+o collapse").map(line => stripTerminalSequences(line).trimEnd());
  assert.equal(lines.length, 9);
  assert.match(lines[0]!, /ctrl\+o collapse/u);
  assert.match(lines[1]!, /^  ├ ✓ \$ command-1/u);
  assert.equal(lines[2], "  │     output-1");
  assert.equal(lines[3], "  │");
  assert.match(lines[4]!, /^  ├ ✓ \$ command-2/u);
  assert.equal(lines[5], "  │     output-2");
  assert.equal(lines[6], "  │");
  assert.match(lines[7]!, /^  ╰ ✓ \$ command-3/u);
  assert.equal(lines[8], "        output-3");
  for (const row of rows) assert.equal(lines.filter(line => line.includes(row.command)).length, 1);
});

test("expanded output preserves long captures and multiline commands without a second disclosure level", () => {
  const long = plain(renderGroup(fixturesFor("long"), true, theme, 120, "ctrl+o collapse"));
  for (let index = 1; index <= 240; index++) assert(long.includes(`module-${String(index).padStart(3, "0")}.ts`));
  assert.match(long, /Build completed in 14.1s/u);
  assert.match(long, /Process exited with code 1/u);
  assert.match(long, /\(no output\)/u);
  assert.doesNotMatch(long, /more lines|bash-logs|captured lines/u);
  const row = { ...fixturesFor("success")[0]!, command: "alpha\n  beta", output: ["one", "", "three"] };
  const lines = renderGroup([row], true, theme, 120, "ctrl+o collapse").map(line => stripTerminalSequences(line));
  assert.match(lines[1]!, /\$ alpha/u);
  assert.equal(lines[2], "          beta");
  assert.deepEqual(lines.slice(3), ["        one", "        ", "        three"]);
});

test("real Pi rows toggle only two states and hide grouped siblings without blank cards", () => {
  const h = harness();
  try {
    const collapsed = h.rows[0]!.render(120);
    assert.equal(collapsed[0], "");
    assert.equal(collapsed.length, 5);
    assert.match(plain(collapsed), /git status/u);
    assert.doesNotMatch(plain(collapsed), /AssertionError|Build completed/u);
    for (const row of h.rows.slice(1)) assert.deepEqual(row.render(120), []);
    h.rows.forEach(row => row.setExpanded(true));
    const expanded = plain(h.rows[0]!.render(120));
    assert.match(expanded, /git status/u);
    assert.match(expanded, /Build completed/u);
    assert.match(expanded, /ctrl\+o collapse/u);
    h.rows.forEach(row => row.setExpanded(false));
    assert.deepEqual(h.rows[0]!.render(120), collapsed);
    h.rows.forEach(row => row.setExpanded(true));
    assert.equal(plain(h.rows[0]!.render(120)), expanded);
  } finally { h.dispose(); }
});

test("explicit expansion survives playback completion and scenario changes", () => {
  const h = harness();
  try {
    h.rows.forEach(row => row.setExpanded(true));
    h.controller.replay();
    h.controller.pause();
    assert.match(plain(h.rows[0]!.render(120)), /Queued/u);
    for (let frame = 0; frame < LAST_FRAME; frame++) h.controller.step();
    assert.match(plain(h.rows[0]!.render(120)), /Build completed/u);
    h.controller.setScene("success");
    assert.match(plain(h.rows[0]!.render(120)), /Typecheck completed/u);
    h.rows.forEach(row => row.setExpanded(false));
    assert.equal(h.rows[0]!.render(120).length, 5);
    h.controller.setScene("edge");
    assert.match(plain(h.rows[0]!.render(120)), /Truncated capture/u);
    assert.match(plain(h.rows[0]!.render(120)), /timeout/u);
    h.rows.forEach(row => row.setExpanded(true));
    assert.match(plain(h.rows[0]!.render(48)), /中文路径/u);
  } finally { h.dispose(); }
});

test("tool hints use the host-injected binding instead of a module-global default", () => {
  const h = harness("ctrl+shift+o");
  try {
    assert.match(plain(h.rows[0]!.render(120)), /ctrl\+shift\+o expand/u);
    h.rows.forEach(row => row.setExpanded(true));
    assert.match(plain(h.rows[0]!.render(120)), /ctrl\+shift\+o collapse/u);
  } finally { h.dispose(); }
});

test("a successful truncated result is never silently folded", () => {
  const row = { ...fixturesFor("edge")[2]!, status: "completed" as const, exitCode: 0 };
  for (const expanded of [false, true]) assert.match(plain(renderGroup([row], expanded, theme, 120, "ctrl+o")), /Truncated capture/u);
});

test("playback supports pending and running frames and disposes its timer", () => {
  const controller = new LabController();
  let changes = 0;
  controller.subscribe(() => changes++);
  controller.replay();
  assert(controller.playing);
  assert(controller.rows.every(row => row.status === "pending"));
  controller.pause();
  assert(!controller.playing);
  controller.step();
  assert.equal(controller.rows[0]!.status, "running");
  for (let frame = 1; frame < LAST_FRAME; frame++) controller.step();
  assert.equal(controller.rows[2]!.status, "failed");
  controller.replay();
  controller.dispose();
  assert(!controller.playing);
  assert(changes > 3);
});

test("prototype removes variant and inspector controls and blocks all execution", async () => {
  const h = harness();
  try {
    assert(!h.commands.has("bash-ui"));
    assert(!h.commands.has("bash-logs"));
    assert.deepEqual([...h.shortcuts].sort(), ["alt+p", "alt+r"]);
    let notice = "";
    assert.deepEqual(h.events.get("input")?.({}, { ui: { notify(text: string) { notice = text; } } }), { action: "handled" });
    assert.match(notice, /No model request/u);
    assert.equal(h.events.get("tool_call")?.().block, true);
    assert.equal(h.events.get("user_bash")?.().result.exitCode, 1);
    await assert.rejects(() => h.tool.execute("blocked", {}, undefined, undefined, {} as never), /does not execute/u);
    await h.commands.get("bash-scene")!.handler("success", {});
    assert.equal(h.controller.scene, "success");
  } finally { h.dispose(); }
});

test("the identity fixture rejects model requests before any transport is opened", () => {
  let request: (() => unknown) | undefined;
  bashUiPrototype({
    registerProvider(name: string, config: { streamSimple: () => unknown }) {
      assert.equal(name, "bash-ui-fixture");
      request = config.streamSimple;
    },
    registerTool() {}, registerCommand() {}, registerShortcut() {}, on() {},
  } as unknown as ExtensionAPI);
  assert(request);
  assert.throws(request, /Model requests are disabled/u);
});

test("sanitization preserves Unicode and fixture scene parsing is strict", () => {
  assert.equal(clean("\u001b[31m中文\u001b[0m\u0007\u202e"), "中文");
  assert.equal(parseScene("success"), "success");
  assert.equal(parseScene("missing"), undefined);
});
