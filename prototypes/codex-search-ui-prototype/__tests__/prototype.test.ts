import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ToolExecutionComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { args, fixture, productionTool, styleTool } from "../src/lab.js";
import { FRAME_MS, LAST_FRAME, SearchPlayback, type Scheduler } from "../src/controller.js";

const root = process.env.PI_SEARCH_LAB_REPOSITORY!;
const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const themeModule = await import(pathToFileURL(join(dirname(entry), "modes/interactive/theme/theme.js")).href);
const theme: Theme = themeModule.loadThemeFromPath(join(root, "themes/codex-pi.json"), "truecolor");
themeModule.setThemeInstance(theme);
const base = await productionTool(process.cwd());
const fakeScheduler: Scheduler = { every() { return 1; }, cancel() {} };
const green = "\x1b[38;2;120;217;154m";
function harness(playback = new SearchPlayback(fakeScheduler)) {
  const tool = styleTool(base, playback);
  const component = new ToolExecutionComponent(tool.name, "animated", args,
    { showImages: false }, tool, { requestRender() {} } as TUI, process.cwd());
  component.updateResult(fixture());
  const lines = (width = 130) => { component.invalidate(); return component.render(width); };
  return { playback, component, lines, output: () => lines().join("\n") };
}

test("minimal stays background-free, preserves one mode label, and does not change the host theme", () => {
  const { output } = harness();
  const raw = output();
  assert(!/\x1b\[48;/.test(raw));
  assert(!raw.includes(theme.getBgAnsi("toolSuccessBg")));
  assert.equal(stripTerminalSequences(raw).match(/responses\/medium\/live/g)?.length, 1);
  assert(raw.includes("\x1b[38;2;160;168;176mresponses/medium/live\x1b[39m"));
  assert(raw.includes("\x1b[38;2;120;131;141m[\x1b[39m"));
  assert(stripTerminalSequences(raw).includes("5 web actions · 3 sources"));
  assert.equal(theme.getBgAnsi("toolSuccessBg"), "\x1b[48;2;33;58;43m");
});

test("playback replays without multiplying timers and stops on completion or disposal", () => {
  const timers = new Map<number, () => void>();
  let sequence = 0;
  const scheduler: Scheduler = {
    every(callback, ms) { assert.equal(ms, FRAME_MS); timers.set(++sequence, callback); return sequence; },
    cancel(handle) { timers.delete(handle as number); },
  };
  const playback = new SearchPlayback(scheduler);
  let updates = 0;
  playback.subscribe(() => updates++);
  playback.replay();
  assert.equal(timers.size, 1);
  playback.replay();
  assert.equal(timers.size, 1);
  for (let i = 0; i < 20; i++) [...timers.values()][0]!();
  assert.equal(playback.completed, 1);
  playback.pause();
  assert.equal(timers.size, 0);
  assert.equal(playback.frame, 20);
  playback.pause();
  assert.equal(timers.size, 1);
  while (!playback.done) [...timers.values()][0]!();
  assert.equal(playback.frame, LAST_FRAME);
  assert.equal(timers.size, 0);
  const settledUpdates = updates;
  playback.step();
  assert.equal(updates, settledUpdates);
  playback.replay();
  playback.dispose();
  assert.equal(timers.size, 0);
});

test("minimal playback shows a spinner, progress, then only a green completion check", () => {
  const { playback, component, output } = harness();
  playback.replay();
  let raw = output();
  assert(stripTerminalSequences(raw).includes("Searching 0/2"));
  assert(stripTerminalSequences(raw).includes(playback.spinner));
  assert(!raw.includes("✓"));
  const first = raw;
  playback.step();
  assert.notEqual(output(), first, "Spinner must advance between frames");
  component.setExpanded(true);
  assert(!stripTerminalSequences(output()).includes("Sources:"), "Pending playback must not leak final fixture content");
  while (playback.frame < 25) playback.step();
  assert(stripTerminalSequences(output()).includes("Searching 1/2"));
  playback.pause();
  const paused = output();
  assert(paused.includes("paused"));
  assert.equal(output(), paused);
  playback.pause();
  while (playback.frame < 45) playback.step();
  assert(stripTerminalSequences(output()).includes("finalizing"));
  playback.finish();
  raw = output();
  assert(raw.includes(`${green}✓\x1b[39m`));
  assert.equal(raw.split(green).length - 1, 1, "Only the check may be green");
  assert(!raw.includes("Searching"));
  assert(stripTerminalSequences(raw).includes("Sources:"));
  assert(stripTerminalSequences(raw).includes("Did 2 searches in 6s"));
  playback.setCheck("gray");
  assert(!output().includes(green));
  assert.equal(playback.frame, LAST_FRAME, "Color switching must not restart playback");
  playback.dispose();
});

test("search, finalizing, success, and failure keep width, expansion, and stable collapsed height", () => {
  const { playback, component, lines, output } = harness();
  playback.replay();
  let height: number | undefined;
  for (let frame = 0; frame <= LAST_FRAME; frame++) {
    const rendered = lines();
    height ??= rendered.length;
    assert.equal(rendered.length, height, "Collapsed playback must not add or remove rows");
    assert(!/\x1b\[48;/.test(rendered.join("\n")));
    for (const width of [32, 60, 100, 160]) assert(lines(width).every(line => visibleWidth(line) <= width));
    playback.step();
  }
  component.setExpanded(true);
  assert(output().includes("https://platform.openai.com/docs/guides/tools-web-search"));
  playback.setScene("error");
  playback.finish();
  assert(output().includes("Web search failed"));
  assert(output().includes(theme.getFgAnsi("warning")));
  assert(!output().includes("✓"));
  assert(!output().includes(green));
  for (const width of [32, 60, 100, 160]) assert(lines(width).every(line => visibleWidth(line) <= width));
  component.setExpanded(false);
  assert(!output().includes("Failures (2)"));
  playback.dispose();
});

test("accent is brighter and reversible while preserving text and playback", () => {
  const { playback, output } = harness();
  const minimal = output();
  playback.setStyle("accent");
  const accented = output();
  assert(accented.includes("\x1b[38;2;166;218;220mWeb Search\x1b[39m"));
  assert(accented.includes("\x1b[38;2;168;204;236m3 sources\x1b[39m"));
  assert(accented.includes("\x1b[38;2;193;199;206m"), "Queries must use brighter gray");
  assert(accented.includes("\x1b[38;2;185;194;203m"), "Results must use brighter gray");
  assert(accented.includes("\x1b[38;2;184;192;200mresponses/medium/live"));
  assert.equal(stripTerminalSequences(accented), stripTerminalSequences(minimal));
  assert.equal(accented.split(green).length - 1, 1);
  assert(!/\x1b\[48;/.test(accented));
  playback.setStyle("minimal");
  assert.equal(output(), minimal);
  playback.replay();
  playback.step();
  const frame = playback.frame;
  playback.setStyle("accent");
  assert.equal(playback.frame, frame);
  assert(playback.playing);
  assert(output().includes("Searching 0/2"));
  assert(output().includes(playback.spinner));
  assert(!output().includes("3 sources"));
  playback.setScene("error");
  playback.finish();
  assert(output().includes("Web search failed"));
  assert(!output().includes("3 sources"));
  playback.dispose();
});

test("prototype search execution is blocked", async () => {
  const tool = styleTool(base, new SearchPlayback(fakeScheduler));
  await assert.rejects(() => tool.execute("fixture", args, undefined, undefined, {} as never), /disabled/);
});
