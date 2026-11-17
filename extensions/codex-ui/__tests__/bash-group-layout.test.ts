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

test("Bash shows one bracketed command and an output-colored capture hanging from a dim elbow", () => {
  const theme = getThemeByName("dark");
  const lines = renderBashGroup(fixture(), false, theme, 180, "ctrl+shift+o/alt+o");
  assert.deepEqual(lines.map(stripTerminalSequences), ["$ Bash(git status --short)", "  └ output", "    ", "    last"]);
  assert.equal(lines[0], theme.fg("muted", "$") + " " + theme.bold("Bash") + "(git status --short)");
  assert.equal(lines[1], theme.fg("dim", "  └ ") + theme.fg("toolOutput", "output"));
});

test("collapsed preview shows the first and last two visual lines around an exact remainder with the active binding", () => {
  const theme = getThemeByName("dark");
  const numbered = (count: number) => Array.from({ length: count }, (_, i) => `line-${i}`);
  for (const count of [0, 1, 3, 4, 5, 6, 25]) {
    const group = fixture();
    group.members[0]!.content = [{ type: "text", text: numbered(count).join("\n") }];
    const lines = renderBashGroup(group, false, theme, 80, "ctrl+x/alt+o").map(stripTerminalSequences);
    const shown = count === 0 ? ["(no output)"] : count <= 5 ? numbered(count)
      : ["line-0", "line-1", `… +${count - 4} lines (ctrl+x/alt+o to expand)`, `line-${count - 2}`, `line-${count - 1}`];
    assert.deepEqual(lines.slice(1), shown.map((line, i) => `${i ? "    " : "  └ "}${line}`));
    const expanded = renderBashGroup(group, true, theme, 80, "ctrl+x/alt+o").map(stripTerminalSequences);
    assert.deepEqual(expanded.slice(1), (count ? numbered(count) : ["(no output)"]).map((line, i) => `${i ? "    " : "  └ "}${line}`));
  }
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: "x".repeat(70) }];
  assert.deepEqual(renderBashGroup(group, false, theme, 15, "").map(stripTerminalSequences).slice(1),
    ["  └ " + "x".repeat(11), "    " + "x".repeat(11), "    … +3 lines", "    " + "x".repeat(11), "    xxxx"]);
  group.members[0]!.content = [{ type: "text", text: "head\n\nmid-0\nmid-1\nmid-2\n\ntail" }];
  group.members[0]!.outputRevision++;
  assert.deepEqual(renderBashGroup(group, false, theme, 80, "").map(stripTerminalSequences).slice(1),
    ["  └ head", "    … +5 lines", "    tail"]);
});

test("Bash output drops shared indentation and edge blanks and keeps one blank row per run in both views", () => {
  const theme = getThemeByName("dark");
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: "\n\n    ok 1\n      detail\n\n\n\n    ok 2\n\n" }];
  for (const expanded of [false, true]) {
    assert.deepEqual(renderBashGroup(group, expanded, theme, 80, "ctrl+o").map(line => stripTerminalSequences(line).trimEnd()).slice(1),
      ["  └ ok 1", "      detail", "", "    ok 2"]);
  }
});

test("pending calls stay hidden and live or empty results have explicit content", () => {
  const theme = getThemeByName("dark");
  const pending = fixture("pending");
  assert.deepEqual(renderBashGroup(pending, false, theme, 80, "ctrl+o"), []);
  for (const [status, title, expected] of [["running", "", "Running…"], ["completed", "", "(no output)"], ["failed", " · failed", "(no output)"]] as const) {
    const group = fixture(status);
    group.members[0]!.content = [];
    const lines = renderBashGroup(group, false, theme, 80, "ctrl+o");
    assert.deepEqual(lines.map(stripTerminalSequences), [`$ Bash(git status --short)${title}`, `  └ ${expected}`]);
    assert.equal(lines[1], theme.fg("dim", "  └ ") + theme.fg("dim", expected));
  }
});

test("long commands use a single ellipsis and expand without losing text at narrow widths", () => {
  const theme = getThemeByName("dark");
  const group = fixture("completed", "x".repeat(200));
  assert.equal(stripTerminalSequences(renderBashGroup(group, false, theme, 64, "ctrl+o")[0]!), "$ Bash(" + "x".repeat(55) + "…)");
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

test("verified host diagnostics become the title status and leave the output in both views", () => {
  const theme = getThemeByName("dark");
  for (const [suffix, label, color] of [
    ["Command exited with code 7", "exit 7", "error"],
    ["Command aborted", "interrupted", "warning"],
    ["Command timed out after 0.1 seconds", "timed out", "warning"],
  ] as const) {
    const group = fixture("failed");
    group.members[0]!.content = [{ type: "text", text: `first\nsecond\nthird\nfourth\n\n${suffix}` }];
    for (const expanded of [false, true]) {
      const lines = renderBashGroup(group, expanded, theme, 100, "ctrl+o");
      assert.deepEqual(lines.map(stripTerminalSequences),
        [`$ Bash(git status --short) · ${label}`, "  └ first", "    second", "    third", "    fourth"]);
      assert.equal(lines[0], theme.fg(color, "$") + " " + theme.bold("Bash") + "(git status --short)" + theme.fg("dim", " · ") + theme.fg(color, label));
      assert.equal(lines[1], theme.fg("dim", "  └ ") + theme.fg("toolOutput", "first"));
    }
    assert.equal(stripTerminalSequences(renderBashGroup(group, false, theme, 23, "")[0]!), "$ Bash(git status --s…)");
  }
  const long = fixture("failed", "x".repeat(65));
  long.members[0]!.content = [{ type: "text", text: "out\n\nCommand exited with code 2" }];
  assert.deepEqual(renderBashGroup(long, true, theme, 40, "").map(stripTerminalSequences).slice(0, 3),
    ["$ Bash(" + "x".repeat(33), "  " + "x".repeat(32) + ")", "   · exit 2"]);
  const success = fixture("completed");
  success.members[0]!.content = [{ type: "text", text: "Error: harmless\n\nCommand exited with code 7" }];
  const succeeded = renderBashGroup(success, false, theme, 100, "");
  assert(succeeded[0]!.includes(theme.fg("muted", "$")));
  assert.deepEqual(succeeded.map(line => stripTerminalSequences(line).trimEnd()),
    ["$ Bash(git status --short)", "  └ Error: harmless", "", "    Command exited with code 7"]);
  const unknown = fixture("failed");
  unknown.members[0]!.content = [{ type: "text", text: "Permission denied" }];
  assert.deepEqual(renderBashGroup(unknown, false, theme, 100, "").map(stripTerminalSequences),
    ["$ Bash(git status --short) · failed", "  └ Permission denied"]);
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

test("the host empty-success sentinel uses the selected no-output wording", () => {
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: "(no output)" }];
  const theme = getThemeByName("dark");
  assert.equal(renderBashGroup(group, false, theme, 80, "")[1], theme.fg("dim", "  └ ") + theme.fg("dim", "(no output)"));
});

test("warmed captures do not repeat styling and collapsed captures style only the four preview lines", () => {
  const base = getThemeByName("dark");
  const fg = vi.fn(base.fg.bind(base));
  const theme = Object.assign(Object.create(base), { fg }) as Theme;
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: Array.from({ length: 1800 }, (_, i) => `output ${i}`).join("\n") }];
  renderBashGroup(group, false, theme, 120, "ctrl+o");
  assert.equal(fg.mock.calls.filter(([color, text]) => color === "toolOutput" && text.startsWith("output")).length, 4);
  for (const expanded of [false, true]) {
    renderBashGroup(group, expanded, theme, 120, "ctrl+o");
    fg.mockClear();
    for (let i = 0; i < 10; i++) renderBashGroup(group, expanded, theme, 120, "ctrl+o");
    assert.equal(fg.mock.calls.filter(([color, text]) => color === "toolOutput" && text.startsWith("output")).length, 0);
  }
});

test("unchanged captures survive completion without recomputing any layout", () => {
  const group = fixture("running");
  const cache = new ToolRenderCache();
  group.members[0]!.cache = cache.scope();
  group.members[0]!.content = [{ type: "text", text: Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n") }];
  for (const expanded of [false, true]) renderBashGroup(group, expanded, getThemeByName("dark"), 100, "ctrl+o");
  const before = cache.stats();
  group.members[0]!.status = "completed";
  for (const expanded of [false, true]) renderBashGroup(group, expanded, getThemeByName("dark"), 100, "ctrl+o");
  assert.equal(cache.stats().layouts.misses, before.layouts.misses);
  assert.equal(cache.stats().counts.misses, before.counts.misses);
});

test("theme changes restyle the preview without rereading the capture", () => {
  const group = fixture();
  let reads = 0;
  Object.defineProperty(group.members[0]!, "content", { get() { reads++; return [{ type: "text", text: "output" }]; } });
  const themes: Theme[] = [getThemeByName("dark"), getThemeByName("light"), themeModule.loadThemeFromPath(resolve("themes/codex-pi.json"), "truecolor")];
  for (const theme of themes) {
    const collapsed = renderBashGroup(group, false, theme, 180, "ctrl+x");
    assert.equal(reads, 1);
    assert(collapsed[0]!.includes(theme.fg("muted", "$")));
    assert.equal(collapsed[1], theme.fg("dim", "  └ ") + theme.fg("toolOutput", "output"));
  }
  renderBashGroup(group, true, themes[0]!, 180, "ctrl+x");
  const warmedReads = reads;
  for (const theme of themes) {
    const expanded = renderBashGroup(group, true, theme, 180, "ctrl+x");
    assert(expanded[0]!.includes(theme.fg("muted", "$")));
    assert.equal(expanded[1], theme.fg("dim", "  └ ") + theme.fg("toolOutput", "output"));
    assert.equal(reads, warmedReads);
  }
});
