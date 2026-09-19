import { expect, test } from "vitest";
import { approximateResponseItemTokens } from "../src/native-compaction.js";
import { responseItemEstimationView } from "../src/response-item-estimation.js";

test.each(["future_item", "constructor", "toString", "__proto__", "hasOwnProperty"])("treats unknown type %s as an unknown item without inheriting schema properties", (type) => {
	const input = { type, content: [{ type: "input_text", text: "unchanged" }] };
	const before = structuredClone(input);
	expect(responseItemEstimationView(input)).toEqual({ type: "other" });
	expect(approximateResponseItemTokens([input])).toBe(approximateResponseItemTokens([{ type: "other" }]));
	expect(input).toEqual(before);
});

test("keeps known-item normalization separate from the wire input", () => {
	const input = { type: "message", role: "user", content: [{ type: "input_text", text: "task", extra: "ignored" }], status: "completed" };
	const before = structuredClone(input);
	expect(responseItemEstimationView(input)).toEqual({ type: "message", role: "user", content: [{ type: "input_text", text: "task" }] });
	expect(input).toEqual(before);
});

test.each([
	{ type: "message", content: [{ type: "input_text", text: "missing role" }] },
	{ role: "user", content: "shorthand message" },
])("preserves raw estimation for malformed known or shorthand input %#", (input) => {
	const before = structuredClone(input);
	expect(responseItemEstimationView(input)).toBe(input);
	expect(approximateResponseItemTokens([input])).toBe(Math.ceil(Buffer.byteLength(JSON.stringify(input)) / 4));
	expect(input).toEqual(before);
});
