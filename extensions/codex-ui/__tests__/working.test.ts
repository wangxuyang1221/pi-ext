import assert from "node:assert/strict";
import { test } from "vitest";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { getThemeByName } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { WORKING_FRAME_MS, Working, WorkingActivity, workingFrameKey } from "../src/working.js";
import { CodexFooter } from "../src/footer.js";

const theme = getThemeByName("dark")!;
test("working keeps ten 80ms frames, a static bold label and elapsed time until settlement", () => {
  let now = 0;
  const activity = new WorkingActivity(() => now);
  const working = new Working(activity, () => theme);
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
  rate = "≈1008 t/s";
  const active = footer.render(100);
  assert.equal(active.length, 2);
  assert.equal(active[1], before[1]);
  assert.match(stripTerminalSequences(active[0]!), /≈1008 t\/s\s*$/u);
  assert.match(stripTerminalSequences(active[0]!), /gpt-test high/u);
  for (let width = 1; width <= 100; width++) {
    const lines = footer.render(width);
    assert.equal(lines.length, 2);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    if ([32, 40, 100].includes(width)) assert.match(stripTerminalSequences(lines[0]!), /≈1008 t\/s/u);
  }
  rate = undefined; assert.deepEqual(footer.render(100), before);
});

test("static bold label, workingFrameKey and time boundaries remain stable over long tasks", () => {
  let now = 0;
  const activity = new WorkingActivity(() => now); activity.start();
  const working = new Working(activity, () => theme);
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
