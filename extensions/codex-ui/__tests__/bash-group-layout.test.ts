import assert from "node:assert/strict";
import { test } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
const themeModule = await import(pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")).href);
const getThemeByName = (name: string): Theme => themeModule.getThemeByName(name);
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderBashGroup } from "../src/bash-group-layout.js";
import type { BashGroup, BashStatus } from "../src/bash-groups.js";
import { ToolRenderCache } from "../src/render-cache.js";

function fixture(status: BashStatus = "completed", command = "git status --short"): BashGroup {
  const group: BashGroup = { timerKey: "test", members: [], counts: { pending: 0, running: 0, completed: 0, failed: 0 }, running: new Set() };
  group.counts[status] = 1;
  const member = { id: "a", group, cache: new ToolRenderCache().scope(), command, commandRevision: 0, outputRevision: 0,
    status, startedAt: status === "pending" ? undefined : 0, endedAt: 100,
    content: [{ type: "text", text: "output\n\nlast" }] };
  group.members.push(member);
  if (status === "running") group.running.add(member);
  return group;
}

test("group metadata separates numbers and units and limits the keycap background to configured keys", () => {
  const theme = getThemeByName("dark")!;
  const lines = renderBashGroup(fixture(), false, theme, 180, "ctrl+shift+o/alt+o");
  const header = lines[0]!;
  assert(header.includes(theme.fg("muted", "1") + " " + theme.fg("dim", "command")));
  assert(header.includes(theme.fg("borderMuted", "  ·  ")));
  assert(header.includes(theme.fg("muted", "1") + " " + theme.fg("dim", "succeeded")));
  assert(header.endsWith(theme.bg("selectedBg", theme.fg("muted", " ctrl+shift+o/alt+o ")) + " " + theme.fg("dim", "expand") + "  "));
  assert.equal(stripTerminalSequences(header).indexOf("Bash"), 2);
  assert(lines[1]!.endsWith(theme.fg("muted", "0.1") + theme.fg("dim", "s") + "  "));
  assert.equal(visibleWidth(header), 180);
  assert.equal(visibleWidth(lines[1]!), 180);
});

test("metadata padding never takes columns from a command and failure clocks retain warning color", () => {
  const theme = getThemeByName("dark");
  const group = fixture("completed", "x".repeat(200));
  const crowded = stripTerminalSequences(renderBashGroup(group, false, theme, 64, "ctrl+o")[1]!);
  assert.equal(crowded, "  ╰ ✓ $ " + "x".repeat(46) + "...   0.1s");
  const spacious = stripTerminalSequences(renderBashGroup(group, false, theme, 180, "ctrl+o")[1]!);
  assert(spacious.startsWith("  ╰ ✓ $ " + "x".repeat(117) + "..."));
  assert(spacious.endsWith("0.1s  "));
  const failed = renderBashGroup(fixture("failed"), false, theme, 180, "ctrl+o");
  assert(failed[1]!.endsWith(theme.fg("warning", "0.1s") + "  "));
  for (const status of ["pending", "running", "completed", "failed"] as const) {
    const current = fixture(status, "中文👩‍💻é".repeat(30) + "\nsecond");
    for (const width of [0, 1, 7, 8, 16, 32, 63, 64, 80, 180]) for (const expanded of [false, true]) {
      const lines = renderBashGroup(current, expanded, theme, width, "ctrl+shift+o");
      assert(lines.every(line => visibleWidth(line) <= width));
      if (!width) assert.deepEqual(lines, []);
      else if (expanded) {
        const text = stripTerminalSequences(lines.join("\n"));
        assert(text.includes("last") || width < 12);
      }
    }
  }
});

test("theme changes rebuild metadata without reprocessing warmed command and output caches", () => {
  const group = fixture();
  let reads = 0;
  Object.defineProperty(group.members[0]!, "content", { get() { reads++; return [{ type: "text", text: "output" }]; } });
  const themes: Theme[] = [getThemeByName("dark"), getThemeByName("light"), themeModule.loadThemeFromPath(resolve("themes/codex-pi.json"), "truecolor")];
  for (const theme of themes) {
    const collapsed = renderBashGroup(group, false, theme, 180, "ctrl+x");
    assert.equal(reads, 0);
    assert(collapsed[0]!.includes(theme.bg("selectedBg", theme.fg("muted", " ctrl+x "))));
    assert(collapsed[1]!.includes(theme.fg("muted", "0.1") + theme.fg("dim", "s")));
  }
  renderBashGroup(group, true, themes[0]!, 180, "ctrl+x");
  const warmedReads = reads;
  for (const theme of themes) {
    const expanded = renderBashGroup(group, true, theme, 180, "ctrl+x");
    assert(expanded[0]!.includes(theme.bg("selectedBg", theme.fg("muted", " ctrl+x "))));
    assert(expanded[0]!.endsWith(theme.fg("dim", "collapse") + "  "));
    assert.equal(expanded[2], theme.fg("borderMuted", "        ") + theme.fg("toolOutput", "output"));
    assert.equal(reads, warmedReads);
  }
});
