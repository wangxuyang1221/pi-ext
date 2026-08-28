import { describe, expect, test } from "vitest";
import { autoCompactTokenLimit, parseConfig } from "../src/config.js";

describe("Codex compaction config", () => {
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
