import type { Theme } from "@earendil-works/pi-coding-agent";

export function getEditSyntaxFingerprint(theme: Theme): string {
  // Match the foregrounds used by Pi's buildCliHighlightTheme and highlightCode fallback.
  return (["text", "muted", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
    "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation", "toolDiffAdded", "toolDiffRemoved", "mdCodeBlock"] as const)
    .map(color => theme.fg(color, "x")).join("\0");
}
