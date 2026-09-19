import { describe, expect, it } from "vitest";
// @ts-expect-error The evaluation runner is an executable JavaScript fixture.
import { scenarioInput, scenarios, scoreAnswer } from "../../../scripts/codex-compact-cases.mjs";

describe("live evaluation scoring", () => {
	const { expected } = scenarioInput(scenarios[0], 1);
	const valid = { ...expected, code: `export const deployment = ${JSON.stringify({ mode: expected.decision, field: expected.field, timeoutMs: expected.timeout })};` };
	it("accepts all facts and a matching declarative code artifact", () => {
		expect(scoreAnswer(JSON.stringify(valid), expected)).toMatchObject({ correct: 7, total: 7, taskPassed: true });
	});
	it("rejects stale decisions and missing invariants", () => {
		expect(scoreAnswer(JSON.stringify({ ...valid, decision: "MODE_A_1", prohibition: "UNKNOWN" }), expected)).toMatchObject({ correct: 5, taskPassed: false, invariantPreserved: false });
	});
	it("does not execute code and rejects non-JSON expressions", () => {
		expect(scoreAnswer(JSON.stringify({ ...valid, code: "export const deployment = {mode: process.exit()};" }), expected).codePassed).toBe(false);
	});
	it("keeps the expected denominator when extra audit facts are required", () => {
		expect(scoreAnswer("invalid", { ...expected, audit_early: "a", audit_middle: "b", audit_late: "c" })).toMatchObject({ correct: 0, total: 10, taskPassed: false });
	});
	it("does not count malformed responses as successful", () => {
		for (const text of ["ACK", "[]", "null", "{invalid}"]) expect(scoreAnswer(text, expected).taskPassed).toBe(false);
	});
});
