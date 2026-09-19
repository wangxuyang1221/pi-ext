import { describe, expect, test } from "vitest";
import { autoCompactTokenLimit, parseConfig } from "../src/config.js";

describe("Codex compaction config", () => {
	test("accepts a bounded effective-window percentage override", () => {
		expect(parseConfig({ effectiveContextWindowPercent: 95 })).toEqual({ effectiveContextWindowPercent: 95 });
		for (const value of [0, -1, 101, Infinity, NaN, "95"]) {
			expect(parseConfig({ effectiveContextWindowPercent: value })).toEqual({});
		}
	});

	test("parses supported settings", () => {
		expect(parseConfig({
			autoCompactTokenLimit: 128_000,
			autoCompactScope: "bodyAfterPrefix",
		})).toEqual({
			autoCompactTokenLimit: 128_000,
			autoCompactScope: "bodyAfterPrefix",
		});
	});

	test("clamps a configured limit to Codex's 90 percent cap", () => {
		expect(autoCompactTokenLimit({ autoCompactTokenLimit: 200, autoCompactScope: "total" }, 100)).toBe(90);
		expect(autoCompactTokenLimit({ autoCompactTokenLimit: 80, autoCompactScope: "total" }, 100)).toBe(80);
	});
});
