import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { turnBoundaryCases } from "../../../scripts/codex-compact-boundary-cases.mjs";
import { isUserTurnBoundary } from "../src/turn-boundary.js";
import { WindowUsageAccounting } from "../src/usage-accounting.js";
import { approximateResponseItemTokens, type ResponseItem } from "../src/native-compaction.js";

const reference = JSON.parse(readFileSync(new URL("./fixtures/codex-full-reference-darwin.json", import.meta.url), "utf8"));

describe("original Codex turn boundaries", () => {
	it("does not backtrack across whitespace inside long ordinary user text", () => {
		const text = `prefix ${" ".repeat(100000)}suffix`;
		const start = performance.now();
		expect(isUserTurnBoundary({ type: "message", role: "user", content: [{ type: "input_text", text }] })).toBe(true);
		// Only the outer edges and fixed-length markers need inspection. A 500ms
		// allowance is generous for 100KB and detects the prior quadratic regex.
		expect(performance.now() - start).toBeLessThan(500);
	}, 10000);

	// Exercise malformed wire values through the same runtime normalizer as the oracle.
	it.each(turnBoundaryCases() as unknown as Array<{name: string; items: ResponseItem[]}>)("matches $name including old reasoning accounting", (entry) => {
		const expected = reference.vectors.find((vector: { name: string }) => vector.name === entry.name);
		expect(expected.error).toBeUndefined();
		expect(entry.items.map(isUserTurnBoundary)).toEqual(expected.turnBoundaries);
		const accounting = new WindowUsageAccounting();
		const response = { role: "assistant", stopReason: "stop", usage: { totalTokens: 1000 } };
		accounting.observeRequest("boundary", entry.items.slice(0, -2));
		accounting.observeResponse(response);
		expect(accounting.estimate("boundary", entry.items, response, approximateResponseItemTokens)).toBe(1000 + expected.oldReasoningTokens);
	});
});
