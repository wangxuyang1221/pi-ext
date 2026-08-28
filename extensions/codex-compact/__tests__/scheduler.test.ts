import { describe, expect, test } from "vitest";
import { shouldAutoCompact } from "../src/scheduler.js";

const cases = [
	["configured total scope", { activeContextTokens: 100, prefillTokens: 0, contextWindow: 200 }, 100, "total", true],
	["body-after-prefix baseline", { activeContextTokens: 150, prefillTokens: 100, contextWindow: 200 }, 49, "bodyAfterPrefix", true],
	["body-after-prefix ignores total", { activeContextTokens: 850, prefillTokens: 200, contextWindow: 1_000 }, 700, "bodyAfterPrefix", false],
	["missing prefix baseline starts at zero", { activeContextTokens: 100, contextWindow: 200 }, 99, "bodyAfterPrefix", false],
	["configured 90-percent limit", { activeContextTokens: 180, prefillTokens: 0, contextWindow: 200 }, 180, "total", true],
	["body-after-prefix counts prefix once", { activeContextTokens: 1_050, prefillTokens: 200, contextWindow: 1_000 }, 800, "bodyAfterPrefix", true],
	["body-after-prefix respects hard cap", { activeContextTokens: 1_001, prefillTokens: 200, contextWindow: 1_000 }, 2_000, "bodyAfterPrefix", true],
	["missing prefix baseline still respects hard cap", { activeContextTokens: 200, contextWindow: 200 }, 2_000, "bodyAfterPrefix", true],
	["total scope respects hard cap", { activeContextTokens: 200, prefillTokens: 0, contextWindow: 200 }, 180, "total", true],
] as const;

describe("Codex-style token scheduler", () => {
	test.each(cases)("%s", (_name, status, limit, scope, expected) => {
		expect(shouldAutoCompact({ status, limit, scope })).toBe(expected);
	});

	test("downshift uses Codex's strict total limit and body cap", () => {
		const status = { activeContextTokens: 900, prefillTokens: 200, contextWindow: 1_000 };
		expect(shouldAutoCompact({ status, limit: 900, scope: "total", reason: "downshift" })).toBe(false);
		expect(shouldAutoCompact({
			status: { ...status, activeContextTokens: 901 },
			limit: 900,
			scope: "total",
			reason: "downshift",
		})).toBe(true);
		expect(shouldAutoCompact({ status, limit: 500, scope: "bodyAfterPrefix", reason: "downshift" })).toBe(false);
		expect(shouldAutoCompact({
			status: { ...status, activeContextTokens: 1_000 },
			limit: 500,
			scope: "bodyAfterPrefix",
			reason: "downshift",
		})).toBe(true);
	});
});
