import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

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
    await readFile(new URL("../../../themes/codex-pi.json", import.meta.url), "utf8"),
  );
  const packageJson = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  );

  assert.equal(theme.name, "codex-pi");
  for (const token of REQUIRED_COLORS) {
    assert.ok(Object.hasOwn(theme.colors, token), `Missing theme token: ${token}`);
  }
  assert.equal(theme.colors.userMessageBg, "userBg");
  assert.equal(theme.colors.selectedBg, "composerBg");
  assert.ok(packageJson.pi.extensions.includes("./extensions/codex-ui/dist/index.js"));
  assert.ok(packageJson.pi.themes.includes("./themes/codex-pi.json"));
  assert.ok(packageJson.files.includes("extensions/codex-ui/dist"));
  assert.ok(packageJson.files.includes("themes/codex-pi.json"));
});
