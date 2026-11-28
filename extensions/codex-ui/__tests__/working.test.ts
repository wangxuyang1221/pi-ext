import assert from "node:assert/strict";
import { test } from "vitest";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { getThemeByName } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { WORKING_FRAME_MS, Working, WorkingActivity, workingFrameKey } from "../src/working.js";
import { CodexFooter } from "../src/footer.js";
import { bindingText } from "../../../shared/ui/keybinding-hints.js";
import { TestKeybindingsManager } from "../../../test-support/keybindings.js";

const theme = getThemeByName("dark")!;
const defaultInterruptKey = () => bindingText(new TestKeybindingsManager(), "app.interrupt", { shortEscape: true });
test("working keeps ten 80ms frames, a static bold label and elapsed time until settlement", () => {
  let now = 0;
  const activity = new WorkingActivity(() => now);
  const working = new Working(activity, () => theme, defaultInterruptKey);
  assert.deepEqual(working.render(100), []);
  activity.start();
  const expectedLabel = theme.bold(theme.fg("text", "Working"));
  const frames: string[] = [];
  for (let i = 0; i < 10; i++) {
    now = i * WORKING_FRAME_MS;
    const line = working.render(100)[0]!;
    assert.ok(line.includes(expectedLabel));
    assert.match(stripTerminalSequences(line), /Working \(0s · esc to interrupt\)/u);
    assert.ok(line.includes(theme.fg("dim", "(0s · ") + theme.fg("muted", "esc") + theme.fg("dim", " to interrupt)")));
    frames.push(stripTerminalSequences(line).trim()[0]!);
  }
  assert.equal(frames.join(""), "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏");
  now = 0;
  const before = working.render(100)[0];
  now = WORKING_FRAME_MS;
  assert.notEqual(working.render(100)[0], before);
  now = 65_000; activity.start();
  assert.match(stripTerminalSequences(working.render(32)[0]!), /Working \(1m 05s\)/u);
  for (let width = 1; width < 101; width++) {
    const lines = working.render(width);
    assert.equal(lines.length, 1);
    assert.ok(visibleWidth(lines[0]!) <= width);
    if (width < 40) assert.ok(!stripTerminalSequences(lines[0]!).includes("interrupt"));
  }
  activity.stop();
  assert.deepEqual(working.render(100), []);
  assert.equal(activity.label(), undefined);
});

test("rate occupies the first footer row while the status row retains its full width", () => {
  let rate: string | undefined;
  const footer = new CodexFooter({ cwd: "/workspace/pi-ext", getModelId: () => "gpt-test", getThinkingLevel: () => "high",
    getContextUsage: () => ({ percent: 12 }), getBranch: () => "main", getTheme: () => theme,
    getExtensionStatuses: () => new Map([["status", "Status: active | long status with useful details"]]),
    getRate: () => rate,
  });
  const before = footer.render(100);
  rate = "-- t/s";
  const waiting = footer.render(100);
  assert.ok(waiting[0]!.includes(theme.fg("dim", "     -- t/s ")));
  rate = "≈1.2k t/s";
  const active = footer.render(100);
  assert.equal(active.length, 2);
  assert.equal(active[1], before[1]);
  assert.ok(active[0]!.includes(theme.fg("muted", "  ≈1.2k t/s ")));
  assert.match(stripTerminalSequences(active[0]!), /≈1\.2k t\/s\s*$/u);
  assert.match(stripTerminalSequences(active[0]!), /gpt-test high/u);
  for (let width = 1; width <= 100; width++) {
    const lines = footer.render(width);
    assert.equal(lines.length, 2);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    if ([32, 40, 100].includes(width)) assert.match(stripTerminalSequences(lines[0]!), /≈1\.2k t\/s/u);
  }
  rate = undefined; assert.deepEqual(footer.render(100), before);
});

test("static bold label, workingFrameKey and time boundaries remain stable over long tasks", () => {
  let now = 0;
  const activity = new WorkingActivity(() => now); activity.start();
  const working = new Working(activity, () => theme, defaultInterruptKey);
  for (const [time, label] of [[59000, "59s"], [60000, "1m 00s"], [3599000, "59m 59s"], [3600000, "1h 00m 00s"], [3661000, "1h 01m 01s"]] as const) {
    now = time; assert.ok(stripTerminalSequences(working.render(120)[0]!).includes(`(${label} · esc to interrupt)`));
  }
  const expectedLabel = theme.bold(theme.fg("text", "Working"));
  const labelSegment = (line: string) => {
    const start = line.indexOf(expectedLabel);
    assert.ok(start >= 0, `expected static bold theme text label in ${JSON.stringify(line)}`);
    return line.slice(start, start + expectedLabel.length);
  };
  now = 0; const firstLabel = labelSegment(working.render(100)[0]!);
  now = 1000; assert.equal(labelSegment(working.render(100)[0]!), firstLabel);
  now = 2000; assert.equal(labelSegment(working.render(100)[0]!), firstLabel);
  assert.equal(WORKING_FRAME_MS, 80);
  assert.equal(workingFrameKey(0), "0:0");
  assert.equal(workingFrameKey(79.9), "0:0");
  assert.equal(workingFrameKey(80), "1:0");
  assert.equal(workingFrameKey(999), "2:0");
  assert.equal(workingFrameKey(1000), "2:1");
  assert.deepEqual(working.render(0), []);
  assert.deepEqual(working.render(Number.NaN), []);
  now = -1; assert.equal(activity.elapsed(), 0);
  activity.stop(); now = 5000; activity.start(); now = 6000;
  assert.equal(activity.elapsed(), 1000);
  assert.match(stripTerminalSequences(working.render(40)[0]!), /esc to interrupt/u);
});

test("working follows remapped, multi-key, unbound, and missing interrupt bindings without overflow", () => {
  let now = 0;
  const activity = new WorkingActivity(() => now);
  activity.start();

  // Without a key source, Working omits the interrupt hint instead of assuming esc.
  const withoutSource = new Working(activity, () => theme);
  const bare = stripTerminalSequences(withoutSource.render(100)[0]!);
  assert.match(bare, /Working \(0s\)/u);
  assert.doesNotMatch(bare, /interrupt|·/u);

  const manager = new TestKeybindingsManager({ "app.interrupt": "f8" });
  const working = new Working(activity, () => theme, () => bindingText(manager, "app.interrupt", { shortEscape: true }));
  assert.match(stripTerminalSequences(working.render(100)[0]!), /Working \(0s · f8 to interrupt\)/u);
  assert.doesNotMatch(stripTerminalSequences(working.render(39)[0]!), /interrupt/u);

  // In-place manager updates (such as /reload) apply on the very next render.
  manager.setUserBindings({ "app.interrupt": ["escape", "ctrl+shift+backspace"] });
  const multi = working.render(40)[0]!;
  assert.ok(visibleWidth(multi) <= 40);
  assert.match(stripTerminalSequences(working.render(100)[0]!), /Working \(0s · esc\/ctrl\+shift\+backspace to interrupt\)/u);

  manager.setUserBindings({ "app.interrupt": [] });
  const unbound = stripTerminalSequences(working.render(100)[0]!);
  assert.match(unbound, /Working \(0s\)/u);
  assert.doesNotMatch(unbound, /interrupt|·/u);
});
