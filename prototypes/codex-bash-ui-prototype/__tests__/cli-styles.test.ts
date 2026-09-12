import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ToolExecutionComponent, type ExtensionAPI, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { renderCliRows } from "../src/cli-renderers.js";
import { fixturesFor, SCENES, playbackRows, type BashFixture } from "../src/fixtures.js";
import { LabController } from "../src/controller.js";
import cliPrototype, { registerCliLab } from "../src/cli-index.js";
import { cliFixturesFor } from "../src/cli-fixtures.js";

const repository = resolve(process.env.PI_BASH_LAB_REPOSITORY ?? process.cwd());
const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const themeModule = await import(pathToFileURL(join(dirname(entry), "modes/interactive/theme/theme.js")).href);
const theme: Theme = themeModule.loadThemeFromPath(join(repository, "themes/codex-pi.json"), "truecolor");
themeModule.setThemeInstance(theme);
const plain = (lines: string[]) => lines.map(line => stripTerminalSequences(line));
const fixture = (overrides: Partial<BashFixture> = {}): BashFixture => ({
  ...fixturesFor("mixed")[0]!, command: "git status --short", output: [" M src/layout.ts"], ...overrides,
});

test("Codex shows command-led output without a Bash statistics header", () => {
  const result = renderCliRows([fixture()], "codex", false, theme, 120);
  assert.deepEqual(plain(result), ["• Ran git status --short", "  └  M src/layout.ts"]);
  assert(result[0]!.includes(theme.fg("success", "•")));
  assert.doesNotMatch(plain(result).join("\n"), /Bash|commands|succeeded|expand/u);
});

test("Codex folds long output to five rows and expands it into a complete transcript", () => {
  const row = fixture({ command: "printf '%s\\n' alpha\nprintf '%s\\n' beta\nprintf '%s\\n' gamma\nprintf '%s\\n' delta", output: Array.from({ length: 25 }, (_,i) => `line-${i+1}`), durationMs: 1400 });
  const collapsed = plain(renderCliRows([row], "codex", false, theme, 120));
  assert.deepEqual(collapsed.slice(-5), ["  └ line-1", "    line-2", "    … +21 lines (ctrl+o to expand)", "    line-24", "    line-25"]);
  assert(collapsed.some(line => line === "  │ … +1 lines"));
  const expanded = plain(renderCliRows([row], "codex", true, theme, 120));
  assert(expanded[0]!.startsWith("$ printf"));
  assert(expanded.includes("line-13"));
  assert(expanded.some(line => line.includes("delta")));
  assert.equal(expanded.at(-1), "✓ • 1.4s");
  assert.doesNotMatch(expanded.join("\n"), /… \+|to expand/u);
});

test("Claude uses Bash parentheses and a three-line preview with full expansion", () => {
  const row = fixture({ output: Array.from({ length: 25 }, (_,i) => `line-${i+1}`) });
  const collapsed = renderCliRows([row], "claude", false, theme, 120);
  assert.deepEqual(plain(collapsed), ["⏺ Bash(git status --short)", "  ⎿  line-1", "     line-2", "     line-3", "     … +22 lines (ctrl+o to expand)"]);
  assert(collapsed[0]!.includes(theme.fg("success", "⏺")));
  const expanded = plain(renderCliRows([row], "claude", true, theme, 120));
  assert.equal(expanded[0], "⏺ Bash(git status --short)");
  assert.equal(expanded.at(-1), "     line-25");
  assert.doesNotMatch(expanded.join("\n"), /succeeded|… \+|to expand/u);
  assert(expanded.includes("     line-13"));
});

test("both layouts distinguish running, failure, empty completion, and incomplete captures", () => {
  for (const style of ["codex", "claude"] as const) {
    const failed = renderCliRows([fixture({ status: "failed", exitCode: 7, output: ["permission denied"] })], style, false, theme, 120);
    assert(failed[0]!.includes(theme.fg("error", style === "codex" ? "•" : "⏺")));
    assert(plain(failed).join("\n").includes("permission denied"));
    assert(renderCliRows([fixture({ status: "pending" })], style, false, theme, 120).length === 0);
    const running = plain(renderCliRows([fixture({ status: "running", exitCode: undefined, output: [] })], style, true, theme, 120)).join("\n");
    assert.match(running, /Running/u);
    assert.doesNotMatch(running, /✓|no output|No content/u);
    const empty = plain(renderCliRows([fixture({ output: [] })], style, false, theme, 120)).join("\n");
    assert.match(empty, /no output|No content/u);
    const truncated = plain(renderCliRows([fixture({ truncated: true })], style, false, theme, 120)).join("\n");
    assert.match(truncated, /Truncated capture/u);
    for (const status of ["cancelled", "timeout"] as const) {
      const abnormal = plain(renderCliRows([fixture({ status, exitCode: undefined, output: [] })], style, true, theme, 120)).join("\n");
      assert.match(abnormal, status === "cancelled" ? /Interrupted/u : /timed out/u);
      assert.doesNotMatch(abnormal, /✓/u);
    }
  }
  assert.match(plain(renderCliRows([fixture({ status: "failed", exitCode: 7 })], "claude", false, theme, 120)).join("\n"), /Error: Exit code 7/u);
});

test("Claude keeps output readable and colors failed output separately from its gutter", () => {
  const success = renderCliRows([fixture({output:["build complete"]})], "claude", false, theme, 120);
  assert(success[1]!.includes(theme.fg("text", "build complete")));
  const failure = renderCliRows([fixture({status:"failed",exitCode:1,output:["assertion failed"]})], "claude", false, theme, 120);
  assert(failure[1]!.includes(theme.fg("error", "Error: Exit code 1")));
  assert(failure[2]!.includes(theme.fg("error", "assertion failed")));
});

test("both layouts respect terminal width, sanitize fixtures, and use the actual expansion key", () => {
  for (const style of ["codex", "claude"] as const) for (const scene of SCENES) {
    for (const frame of [null, 0, 2, 7]) for (const expanded of [false, true]) {
      for (const width of [0, 1, 2, 8, 24, 60, 120]) {
        const lines = renderCliRows(playbackRows(scene, frame), style, expanded, theme, width);
        assert(lines.every(line => visibleWidth(line) <= width), `${style}/${scene}/${frame}/${expanded}/${width}`);
      }
    }
    const row = fixture({command: "echo \x1b]52;c;YQ==\x07safe\x1b[2J", output:Array.from({length:20}, () => "log")});
    const result = renderCliRows([row], style, false, theme, 120, "ctrl+shift+o").join("\n");
    assert.doesNotMatch(result, /\x1b\]52|\x1b\[2J/u);
    assert.match(result, /ctrl\+shift\+o/u);
    assert.doesNotMatch(renderCliRows([row], style, false, theme, 120, "").join("\n"), /ctrl\+o/u);
  }
});

test("Hybrid merges the title into the command tree and keeps output folded", () => {
  const single = plain(renderCliRows([fixture()], "hybrid", false, theme, 120));
  assert.equal(single.length, 1);
  assert.match(single[0]!, /^▸ Bash  ✓ \$ git status --short +0\.2s  $/u);
  const rows = fixturesFor("mixed");
  const collapsed = plain(renderCliRows(rows, "hybrid", false, theme, 120));
  assert.equal(collapsed.length, 3);
  assert.match(collapsed[0]!, /^▸ Bash  ┬ ✓ \$ git status/u);
  assert.match(collapsed[1]!, /^        ├ ✓ \$ pnpm run check/u);
  assert.match(collapsed[2]!, /^        ╰ × \$ pnpm test/u);
  assert.doesNotMatch(collapsed.join("\n"), /commands|succeeded|failed|expand|PASS|Bash\(/u);
  const expanded = plain(renderCliRows(rows, "hybrid", true, theme, 120));
  assert.match(expanded[0]!, /^▾ Bash  ┬ ✓ \$/u);
  assert.match(expanded.join("\n"), /PASS render-case-08/u);
  assert.equal((expanded.join("\n").match(/Bash/gu) ?? []).length, 1);
});

test("Hybrid aligns metadata at a fixed right inset for long and short commands", () => {
  const long = cliFixturesFor("long")[0]!.command;
  for (const width of [80, 120, 180, 240]) for (const expanded of [false, true]) {
    const rows = [
      fixture({ command: long, durationMs: 100 }),
      fixture({ command: "pnpm run build", durationMs: 14100 }),
      fixture({ command: "pnpm test", status: "failed", durationMs: 9400 }),
    ];
    for (const group of [rows, [rows[0]!], [rows[1]!]]) {
      const lines = plain(renderCliRows(group, "hybrid", expanded, theme, width));
      const commands = lines.filter(line => /[✓×] \$ /u.test(line));
      assert.equal(commands.length, group.length);
      commands.forEach((line, index) => {
        assert.match(line, new RegExp(`   ${(group[index]!.durationMs / 1000).toFixed(1).replace(".", "\\.")}s  $`, "u"));
        assert.equal(visibleWidth(line.trimEnd()), width - 2, `Metadata shifted at ${width}/${expanded}: ${line}`);
        assert.equal(visibleWidth(line), width);
      });
    }
  }
  for (const status of ["running", "pending"] as const) for (const durationMs of [9900, 10000]) {
    const rows = [fixture({ command: long, status, durationMs }), fixture({ command: "pnpm test", status, durationMs })];
    const lines = plain(renderCliRows(rows, "hybrid", false, theme, 120));
    assert(lines.every(line => visibleWidth(line.trimEnd()) === 118));
  }
  const output = ["0.1s", "14.1s  ", "9.4s", "queued"];
  const expanded = plain(renderCliRows([fixture({ output })], "hybrid", true, theme, 120));
  assert.deepEqual(expanded.slice(1), output.map(line => "            " + line), "Duration-like output must not be realigned");
});

test("the long scene exposes long and multiline commands through playback and expansion", () => {
  const rows = cliFixturesFor("long");
  assert(rows[0]!.command.length > 300, "The long scene must include an overflowing single-line command");
  assert(!rows[0]!.command.includes("\n"));
  assert(rows[1]!.command.includes("\n"), "The long scene must include a multiline command");
  assert.equal(cliFixturesFor("long", 1)[0]!.status, "running");
  assert.equal(cliFixturesFor("long", 1)[0]!.command, rows[0]!.command);
  const collapsed = plain(renderCliRows(rows, "hybrid", false, theme, 120));
  assert.equal(collapsed.length, 3);
  assert.match(collapsed[0]!, /\.\.\./u);
  assert.doesNotMatch(collapsed.join("\n"), /long-command-end|multiline-command-end/u);
  const expanded = plain(renderCliRows(rows, "hybrid", true, theme, 80)).join("\n");
  assert.match(expanded, /long-command-end/u);
  assert.match(expanded, /multiline-command-end/u);
  assert.doesNotMatch(expanded, /\.\.\./u);
});

test("Hybrid keeps queued rows and separates disclosure from running status and tail clocks", () => {
  const queued = plain(renderCliRows(cliFixturesFor("mixed", 0), "hybrid", false, theme, 120));
  assert.equal(queued.length, 3);
  assert(queued.every(line => line.includes("○") && line.includes("queued")));
  const running = renderCliRows(cliFixturesFor("mixed", 1), "hybrid", false, theme, 120);
  assert.equal(running.length, 3);
  assert.match(plain(running)[0]!, /^▸ Bash  ┬ ◌ \$/u);
  assert(running[0]!.includes(theme.fg("accent", "◌")));
  assert.doesNotMatch(plain(running).join("\n"), /✓|succeeded/u);
  const command = cliFixturesFor("long")[0]!.command;
  const before = fixture({ command, status: "running", durationMs: 9900, output: [] });
  const after = { ...before, durationMs: 10000 };
  const expandedBefore = plain(renderCliRows([before], "hybrid", true, theme, 100));
  const expandedAfter = plain(renderCliRows([after], "hybrid", true, theme, 100));
  assert.deepEqual(expandedBefore.slice(0, -1), expandedAfter.slice(0, -1), "Clock updates must not rewrap expanded commands");
  assert.match(expandedBefore[0]!, /^▾ Bash  ◌ \$/u);
  assert.match(expandedBefore.join("\n"), /Waiting for output…/u);
  assert.match(expandedBefore.at(-1)!, /1: 9\.9s running/u);
  assert.match(expandedAfter.at(-1)!, /1: 10\.0s running/u);
  assert.match(plain(renderCliRows([after], "hybrid", false, theme, 100))[0]!, /10\.0s/u);
  const streaming = plain(renderCliRows([{ ...after, output: ["streamed chunk"] }], "hybrid", true, theme, 100));
  assert.match(streaming.join("\n"), /streamed chunk/u);
  assert.doesNotMatch(streaming.join("\n"), /Waiting for output|✓/u);
});

test("Hybrid reuses safe production wrapping and never reads folded captures", () => {
  const unreadable = fixture();
  Object.defineProperty(unreadable, "output", { get() { throw new Error("Folded output must remain unread"); } });
  assert.equal(renderCliRows([unreadable], "hybrid", false, theme, 120).length, 1);
  assert.deepEqual(renderCliRows([], "hybrid", true, theme, 120), []);
  for (const scene of SCENES) for (const frame of [null, 0, 1, 7]) for (const expanded of [false, true]) {
    for (const width of [0, 1, 2, 8, 24, 31, 32, 60, 68, 70, 120, 240]) {
      const lines = renderCliRows(cliFixturesFor(scene, frame), "hybrid", expanded, theme, width);
      assert(lines.every(line => visibleWidth(line) <= width), `${scene}/${frame}/${expanded}/${width}`);
    }
  }
  const row = fixture({ command: "echo \x1b]52;c;YQ==\x07safe\x1b[2J", output: ["\x1b[2Jlog"], truncated: true });
  for (const expanded of [false, true]) {
    const result = renderCliRows([row], "hybrid", expanded, theme, 120).join("\n");
    assert.doesNotMatch(result, /\x1b\]52|\x1b\[2J/u);
    assert.match(plain([result])[0]!, /Truncated capture/u);
  }
  const empty = plain(renderCliRows([fixture({ output: [] })], "hybrid", true, theme, 120)).join("\n");
  assert.match(empty, /\(no output\)/u);
  for (const status of ["failed", "timeout", "cancelled"] as const) {
    const result = renderCliRows([fixture({ status })], "hybrid", false, theme, 120);
    assert(result[0]!.includes(theme.fg("error", "×")));
    assert.doesNotMatch(plain(result).join("\n"), /✓/u);
  }
});

test("the isolated identity rejects model requests and the single scene matches the worktree example", () => {
  let provider: any;
  const events = new Map<string, (...args: any[]) => any>();
  cliPrototype({
    registerProvider(_name: string, config: unknown) { provider = config; },
    registerTool() {}, registerCommand() {}, registerShortcut() {},
    on(name: string, handler: (...args: any[]) => any) { events.set(name, handler); },
  } as unknown as ExtensionAPI);
  try {
    assert.throws(() => provider.streamSimple(), /Model requests are disabled/u);
    assert.equal(provider.baseUrl, "http://127.0.0.1:1");
    assert.match(cliFixturesFor("single")[0]!.command, /worktree list --porcelain/u);
    assert.equal(cliFixturesFor("single", 0)[0]!.output.length, 0);
    assert.equal(cliFixturesFor("single", 2)[0]!.status, "running");
    assert(cliFixturesFor("single", 2)[0]!.output.length < cliFixturesFor("single")[0]!.output.length);
    assert.deepEqual(cliFixturesFor("mixed"), fixturesFor("mixed"));
  } finally { events.get("session_shutdown")?.(); }
});

test("the real Pi tool row switches styles without losing expansion or executing tools", async () => {
  const controller = new LabController("mixed");
  let tool: ToolDefinition | undefined;
  const commands = new Map<string, { handler: (...args: any[]) => any }>();
  const shortcuts = new Map<string, { handler: (...args: any[]) => any }>();
  const events = new Map<string, (...args: any[]) => any>();
  let invalidations = 0;
  const widgets: unknown[] = [];
  const ctx = { mode: "tui", ui: {
    getEditorComponent: () => () => ({}),
    setEditorComponent(factory: (...args: any[]) => any) { factory({}, theme, new KeybindingsManager({ "app.tools.expand": {defaultKeys:"ctrl+shift+o"} })); },
    setWidget(_name: string, widget: unknown) { widgets.push(widget); },
    notify() {},
  } };
  registerCliLab({
    registerTool(value: ToolDefinition) { tool = value; },
    registerCommand(name: string, value: {handler: (...args: any[]) => any}) { commands.set(name, value); },
    registerShortcut(name: string, value: {handler: (...args: any[]) => any}) { shortcuts.set(name, value); },
    on(name: string, handler: (...args: any[]) => any) { events.set(name, handler); },
  } as unknown as ExtensionAPI, controller, "codex");
  try {
    assert(tool, "The isolated extension must register a Bash renderer");
    events.get("session_start")?.({}, ctx);
    const rows = fixturesFor("mixed").map(f => {
      const row = new ToolExecutionComponent("bash", f.id, {command:f.command}, {showImages:false}, tool, {requestRender() { invalidations++; }} as TUI, repository);
      row.setArgsComplete();
      row.updateResult({ content:[{type:"text",text:f.output.join("\n")}], isError:f.status === "failed" });
      return row;
    });
    assert.match(plain(rows[0]!.render(120)).join("\n"), /• Ran git status/u);
    assert.deepEqual(rows[1]!.render(120), []);
    rows.forEach(row => row.setExpanded(true));
    await commands.get("bash-style")!.handler("claude", ctx);
    const expanded = plain(rows[0]!.render(120)).join("\n");
    assert.match(expanded, /⏺ Bash\(git status/u);
    assert.match(expanded, /PASS render-case-08/u);
    assert.doesNotMatch(expanded, /to expand/u);
    await commands.get("bash-style")!.handler("hybrid", ctx);
    const hybrid = plain(rows[0]!.render(120)).join("\n");
    assert.match(hybrid, /▾ Bash  ┬ ✓ \$/u);
    assert.match(hybrid, /PASS render-case-08/u);
    rows.forEach(row => row.setExpanded(false));
    assert.doesNotMatch(plain(rows[0]!.render(120)).join("\n"), /PASS|commands|succeeded/u);
    await commands.get("bash-style")!.handler("claude", ctx);
    await shortcuts.get("alt+3")!.handler();
    assert.match(plain(rows[0]!.render(120)).join("\n"), /▸ Bash  ┬ ✓ \$/u);
    await commands.get("bash-style")!.handler("claude", ctx);
    const collapsed = plain(rows[0]!.render(120)).join("\n");
    assert.match(collapsed, /ctrl\+shift\+o/u);
    controller.step(); controller.step();
    assert.match(plain(rows[0]!.render(120)).join("\n"), /Running/u);
    controller.settle();
    await commands.get("bash-style")!.handler("codex", ctx);
    assert.match(plain(rows[0]!.render(120)).join("\n"), /• Ran git status/u);
    assert.equal(events.get("input")?.({}, ctx).action, "handled");
    assert.equal(events.get("tool_call")?.().block, true);
    assert.equal(events.get("user_bash")?.().result.exitCode, 1);
    await assert.rejects(() => tool!.execute("blocked", {}, undefined, undefined, ctx as any), /disabled/u);
    controller.replay();
    assert(controller.playing);
    assert(invalidations > 0);
    assert(widgets.length > 0);
  } finally {
    events.get("session_shutdown")?.();
    controller.dispose();
  }
  assert.equal(controller.playing, false);
});
