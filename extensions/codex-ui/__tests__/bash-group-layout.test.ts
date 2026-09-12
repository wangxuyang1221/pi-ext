import assert from "node:assert/strict";
import { test, vi } from "vitest";
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
  const group: BashGroup = { members: [] };
  const member = { id: "a", group, cache: new ToolRenderCache().scope(), command, commandRevision: 0, outputRevision: 0,
    status,
    content: [{ type: "text", text: "output\n\nlast" }] };
  group.members.push(member);
  return group;
}

test("Claude Bash shows one bracketed command and a text-colored capture with dim prefixes", () => {
  const theme = getThemeByName("dark");
  const lines = renderBashGroup(fixture(), false, theme, 180, "ctrl+shift+o/alt+o");
  assert.deepEqual(lines.map(stripTerminalSequences), ["⏺ Bash(git status --short)", "  ⎿  output", "     ", "     last"]);
  assert.equal(lines[0], theme.fg("success", "⏺") + " " + theme.bold("Bash") + "(git status --short)");
  assert.equal(lines[1], theme.fg("dim", "  ⎿  ") + theme.fg("text", "output"));
});

test("preview keeps the first three visual lines and reports an exact remainder with the active binding", () => {
  const theme = getThemeByName("dark");
  for (const count of [0, 1, 3, 4, 25]) {
    const group = fixture();
    group.members[0]!.content = [{ type: "text", text: Array.from({ length: count }, (_, i) => `line-${i}`).join("\n") }];
    const lines = renderBashGroup(group, false, theme, 80, "ctrl+x/alt+o").map(stripTerminalSequences);
    assert.deepEqual(lines.slice(1, 1 + Math.min(count, 3)), Array.from({ length: Math.min(count, 3) }, (_, i) => `${i ? "     " : "  ⎿  "}line-${i}`));
    if (count > 3) assert.equal(lines.at(-1), `     … +${count - 3} lines (ctrl+x/alt+o to expand)`);
    assert.equal(lines.length, 1 + Math.max(1, Math.min(count, 3)) + (count > 3 ? 1 : 0));
    const expanded = renderBashGroup(group, true, theme, 80, "ctrl+x/alt+o").map(stripTerminalSequences);
    assert.equal(expanded.length, Math.max(1, count) + 1);
  }
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: "x".repeat(50) }];
  const lines = renderBashGroup(group, false, theme, 15, "").map(stripTerminalSequences);
  assert.equal(lines.at(-1), "     … +2 lines");
});

test("pending calls stay hidden and live or empty results have explicit content", () => {
  const theme = getThemeByName("dark");
  const pending = fixture("pending");
  assert.deepEqual(renderBashGroup(pending, false, theme, 80, "ctrl+o"), []);
  for (const [status, expected] of [["running", "Running…"], ["completed", "(No content)"], ["failed", "Command failed"]] as const) {
    const group = fixture(status);
    group.members[0]!.content = [];
    assert.equal(stripTerminalSequences(renderBashGroup(group, false, theme, 80, "ctrl+o")[1]!), `  ⎿  ${expected}`);
  }
});

test("long commands use a single ellipsis and expand without losing text at narrow widths", () => {
  const theme = getThemeByName("dark");
  const group = fixture("completed", "x".repeat(200));
  assert.equal(stripTerminalSequences(renderBashGroup(group, false, theme, 64, "ctrl+o")[0]!), "⏺ Bash(" + "x".repeat(55) + "…)");
  const huge = fixture("completed", "q".repeat(50 * 1024));
  assert.equal(stripTerminalSequences(renderBashGroup(huge, true, theme, 1, "").join("")).match(/q/gu)?.length, 50 * 1024);
  for (const status of ["pending", "running", "completed", "failed"] as const) {
    const current = fixture(status, "中文👩‍💻é".repeat(30) + "\nsecond");
    for (const width of [0, 1, 7, 8, 16, 32, 63, 64, 80, 180]) for (const expanded of [false, true]) {
      const lines = renderBashGroup(current, expanded, theme, width, "ctrl+shift+o");
      assert(lines.every(line => visibleWidth(line) <= width));
      if (!width || status === "pending") assert.deepEqual(lines, []);
      else if (expanded) {
        const text = stripTerminalSequences(lines.join("\n"));
        assert(text.includes("last") || width < 12);
      }
    }
  }
});

test("verified host diagnostics lead collapsed errors without changing the expanded capture", () => {
  const theme = getThemeByName("dark");
  for (const [suffix, diagnostic, color] of [
    ["Command exited with code 7", "Error: Exit code 7", "error"],
    ["Command aborted", "Interrupted", "warning"],
    ["Command timed out after 0.1 seconds", "Error: Command timed out after 0.1 seconds", "warning"],
  ] as const) {
    const group = fixture("failed");
    const original = `first\nsecond\nthird\nfourth\n\n${suffix}`;
    group.members[0]!.content = [{ type: "text", text: original }];
    const collapsed = renderBashGroup(group, false, theme, 100, "ctrl+o");
    assert.equal(collapsed[1], theme.fg("dim", "  ⎿  ") + theme.fg(color, diagnostic));
    assert.equal(stripTerminalSequences(collapsed[0]!).startsWith("⏺ Bash("), true);
    const expanded = renderBashGroup(group, true, theme, 100, "ctrl+o").slice(1).map(line => stripTerminalSequences(line).slice(5)).join("\n");
    assert.equal(expanded, original);
  }
  const success = fixture("completed");
  success.members[0]!.content = [{ type: "text", text: "Error: harmless\n\nCommand exited with code 7" }];
  assert(renderBashGroup(success, false, theme, 100, "")[0]!.includes(theme.fg("success", "⏺")));
  assert.doesNotMatch(renderBashGroup(success, false, theme, 100, "").join("\n"), /Error: Exit code/u);
  const unknown = fixture("failed");
  unknown.members[0]!.content = [{ type: "text", text: "Permission denied" }];
  assert.equal(stripTerminalSequences(renderBashGroup(unknown, false, theme, 100, "")[1]!), "  ⎿  Permission denied");
});

test("truncation remains visible from structured details or the host error footer without reading files", () => {
  const theme = getThemeByName("dark");
  for (const expanded of [false, true]) {
    const group = fixture("completed");
    group.members[0]!.details = { truncation: { truncated: true }, fullOutputPath: "/unreadable/capture.log" } as never;
    assert.match(renderBashGroup(group, expanded, theme, 120, "").map(stripTerminalSequences).join("\n"), /Truncated capture · \/unreadable\/capture.log/u);
    const failed = fixture("failed");
    failed.members[0]!.content = [{ type: "text", text: "one\ntwo\nthree\nfour\n\n[Showing lines 101-2100 of 2100. Full output: /unreadable/error.log]\n\nCommand exited with code 9" }];
    assert.match(renderBashGroup(failed, expanded, theme, 120, "").map(stripTerminalSequences).join("\n"), /Truncated capture · \/unreadable\/error.log/u);
  }
});

test("the host empty-success sentinel uses the selected no-content wording", () => {
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: "(no output)" }];
  assert.equal(stripTerminalSequences(renderBashGroup(group, false, getThemeByName("dark"), 80, "")[1]!), "  ⎿  (No content)");
});

test("warmed captures do not repeat styling and collapsed captures style only three lines", () => {
  const base = getThemeByName("dark");
  const fg = vi.fn(base.fg.bind(base));
  const theme = Object.assign(Object.create(base), { fg }) as Theme;
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: Array.from({ length: 1800 }, (_, i) => `output ${i}`).join("\n") }];
  renderBashGroup(group, false, theme, 120, "ctrl+o");
  assert.equal(fg.mock.calls.filter(([color, text]) => color === "text" && text.startsWith("output")).length, 3);
  for (const expanded of [false, true]) {
    renderBashGroup(group, expanded, theme, 120, "ctrl+o");
    fg.mockClear();
    for (let i = 0; i < 10; i++) renderBashGroup(group, expanded, theme, 120, "ctrl+o");
    assert.equal(fg.mock.calls.filter(([color, text]) => color === "text" && text.startsWith("output")).length, 0);
  }
});

test("unchanged capture counts survive completion and theme changes", () => {
  const group = fixture("running");
  const cache = new ToolRenderCache();
  group.members[0]!.cache = cache.scope();
  group.members[0]!.content = [{ type: "text", text: "one\ntwo\nthree\nfour" }];
  renderBashGroup(group, false, getThemeByName("dark"), 100, "ctrl+o");
  const misses = cache.stats().counts.misses;
  group.members[0]!.status = "completed";
  renderBashGroup(group, false, getThemeByName("light"), 100, "ctrl+o");
  assert.equal(cache.stats().counts.misses, misses);
});

test("theme changes restyle the preview without rereading the capture", () => {
  const group = fixture();
  let reads = 0;
  Object.defineProperty(group.members[0]!, "content", { get() { reads++; return [{ type: "text", text: "output" }]; } });
  const themes: Theme[] = [getThemeByName("dark"), getThemeByName("light"), themeModule.loadThemeFromPath(resolve("themes/codex-pi.json"), "truecolor")];
  for (const theme of themes) {
    const collapsed = renderBashGroup(group, false, theme, 180, "ctrl+x");
    assert.equal(reads, 1);
    assert(collapsed[0]!.includes(theme.fg("success", "⏺")));
    assert.equal(collapsed[1], theme.fg("dim", "  ⎿  ") + theme.fg("text", "output"));
  }
  renderBashGroup(group, true, themes[0]!, 180, "ctrl+x");
  const warmedReads = reads;
  for (const theme of themes) {
    const expanded = renderBashGroup(group, true, theme, 180, "ctrl+x");
    assert(expanded[0]!.includes(theme.fg("success", "⏺")));
    assert.equal(expanded[1], theme.fg("dim", "  ⎿  ") + theme.fg("text", "output"));
    assert.equal(reads, warmedReads);
  }
});
