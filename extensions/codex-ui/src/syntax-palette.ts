import type { Theme } from "@earendil-works/pi-coding-agent";

export function getEditSyntaxFingerprint(theme: Theme): string {
  // The host passes the live theme proxy also consumed by highlightCode.
  return (["text", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
    "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation", "mdCodeBlock"] as const)
    .map(color => theme.fg(color, "x")).join("\0");
}
