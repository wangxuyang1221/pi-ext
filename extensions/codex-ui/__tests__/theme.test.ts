import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";

const themeModule = await import(
  pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")).href
) as { loadThemeFromPath: (path: string, mode?: "truecolor" | "256color") => Theme };

const REQUIRED_COLORS = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "bashMode",
] as const;

test("package publishes the complete codex-pi theme and compiled extension", async () => {
  const theme = JSON.parse(
    await readFile(new URL("../themes/codex-pi.json", import.meta.url), "utf8"),
  );
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(theme.$schema, "https://pi.dev/schemas/theme.schema.json");
  assert.equal(theme.name, "codex-pi");
  assert.equal(theme.appearance, "dark");
  for (const token of REQUIRED_COLORS) {
    assert.ok(Object.hasOwn(theme.colors, token), `Missing theme token: ${token}`);
  }
  assert.equal(theme.colors.scrollbarTrack, "userBg");
  assert.equal(theme.colors.scrollbarThumb, "dim");
  assert.equal(theme.colors.userMessageBg, "userBg");
  assert.equal(theme.colors.selectedBg, "composerBg");
  assert.equal(theme.colors.accent, "cyan");
  assert.equal(theme.colors.mdCode, "cyan");
  assert.equal(theme.colors.thinkingText, "thinking");
  assert.equal(theme.colors.mdQuote, "thinking");
  assert.equal(theme.colors.mdQuoteBorder, "quoteBorder");
  assert.equal(theme.colors.mdHeading, "white");
  assert.equal(theme.vars.foreground, "#d4d4d8");
  assert.equal(theme.vars.thinking, "#787882");
  assert.equal(theme.vars.quoteBorder, "#44444c");
  assert.equal(theme.vars.cyan, "#7fd4e6");
  assert.equal(theme.export.pageBg, "#292929");
  assert.equal(theme.vars.toolSuccessBg, "#1c3024");
  assert.equal(theme.vars.toolErrorBg, "#3a2023");
  assert.equal(theme.vars.syntaxText, "#cdd6f4");
  assert.deepEqual(
    [
      "syntaxKeyword",
      "syntaxFunction",
      "syntaxVariable",
      "syntaxString",
      "syntaxNumber",
      "syntaxType",
      "syntaxOperator",
      "syntaxPunctuation",
    ].map((token) => theme.vars[token]),
    [
      "#cba6f7",
      "#89b4fa",
      "#eba0ac",
      "#a6e3a1",
      "#fab387",
      "#f9e2af",
      "#94e2d5",
      "#9399b2",
    ],
  );
  assert.equal(theme.colors.toolDiffContext, "syntaxText");
  assert.ok(packageJson.pi.extensions.includes("./dist/index.js"));
  assert.ok(packageJson.pi.themes.includes("./themes/codex-pi.json"));
  assert.ok(packageJson.files.includes("dist/index.js"));
  assert.ok(packageJson.files.includes("themes/codex-pi.json"));

  const loaded = themeModule.loadThemeFromPath(resolve("extensions/codex-ui/themes/codex-pi.json"), "truecolor");
  assert.equal(loaded.name, "codex-pi");
  assert.equal(loaded.appearance, "dark");
  assert.notEqual(loaded.getFgAnsi("scrollbarTrack"), loaded.getFgAnsi("scrollbarThumb"));
  assert.notEqual(loaded.getFgAnsi("text"), loaded.getFgAnsi("toolOutput"));
  assert.notEqual(loaded.getFgAnsi("toolOutput"), loaded.getFgAnsi("thinkingText"));
  assert.equal(loaded.getFgAnsi("thinkingText"), loaded.getFgAnsi("mdQuote"));
});
