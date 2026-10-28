import { expect, it } from "vitest";
import { isAccountUsageLimit } from "../src/quota.js";

it.each(["usage_limit_reached", "insufficient_quota"])("recognizes adapter and compaction wrappers for %s", code => {
  for (const body of [code, JSON.stringify({ error: { code } })]) {
    for (const prefix of ["Codex error: ", "Summarization failed: Codex error: ", "Auto-compaction failed: Turn prefix summarization failed: Codex error: 429 "]) {
      expect(isAccountUsageLimit(prefix + body), prefix + body).toBe(true);
    }
  }
});

it.each(["429", "429 Too many requests", "rate_limit", "authentication_error", "Network error", "billing failed", "quota exceeded", "Documentation mentions insufficient_quota", "not_insufficient_quota", '{"error":{"code":"rate_limit","message":"quota lookup failed"}}'])(
  "does not broaden account exhaustion through a Codex wrapper: %s", error => {
    expect(isAccountUsageLimit(`Codex error: ${error}`)).toBe(false);
  },
);

it("bounds wrapper traversal", () => {
  expect(isAccountUsageLimit("Codex error: ".repeat(1000) + "insufficient_quota")).toBe(false);
});
