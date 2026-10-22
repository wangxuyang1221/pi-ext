import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullEstimatorCases } from "../../../scripts/codex-compact-full-cases.mjs";
import { approximateCompactionRequestTokens, approximateResponseItemTokens } from "../src/native-compaction.js";
import * as decoder from "../src/media-decoder.js";
import { textTokens } from "../src/token-estimation.js";

const reference = JSON.parse(readFileSync(new URL("./fixtures/codex-full-reference-darwin.json", import.meta.url), "utf8"));
const originalDecode = decoder.decodeOriginalImageBytes;
// The native oracle was built with macOS CLI features. Other platform policies
// are independently exercised by media-decoder.test.ts, without mocking bytes.
beforeEach(() => { vi.spyOn(decoder, "decodeOriginalImageBytes").mockImplementation((url) => originalDecode(url, "darwin")); });
afterEach(() => vi.restoreAllMocks());

describe("original Rust full ResponseItem estimator", () => {
	it.each(fullEstimatorCases())("normalizes and estimates $name like pinned serde and history.rs", (entry) => {
		const expected = reference.vectors.find((vector: { name: string }) => vector.name === entry.name);
		expect(expected).toBeDefined();
		expect(expected.error).toBeUndefined();
		const before = JSON.stringify(entry);
		expect(createHash("sha256").update(before).digest("hex")).toBe(expected.inputSha256);
		expect(entry.items.map((item: object) => approximateResponseItemTokens([item]))).toEqual(expected.counts);
		expect(approximateResponseItemTokens(entry.items) + textTokens(entry.instructions ?? "")).toBe(expected.total);
		expect(approximateResponseItemTokens(expected.normalized)).toBe(expected.roundTripTotal);
		if (entry.name.startsWith("prefix/")) {
			const canonicalItems = expected.counts.reduce((a: number, b: number) => a + b, 0);
			expect(approximateCompactionRequestTokens({ input: entry.items, instructions: entry.instructions, tools: entry.tools })).toBe(canonicalItems + Math.ceil(expected.wirePrefixBytes / 4));
		}
		expect(JSON.stringify(entry)).toBe(before);
	});
});
