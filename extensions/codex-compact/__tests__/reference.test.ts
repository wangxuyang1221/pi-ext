import { describe, expect, test, vi } from "vitest";
import reference from "./fixtures/codex-reference.json";
import { approximateResponseItemTokens, retainRecentMessages } from "../src/native-compaction.js";
import { imageBytes, textTokens, truncateText } from "../src/token-estimation.js";
import { autoCompactTokenLimit, effectiveContextWindow } from "../src/config.js";
import { shouldAutoCompact } from "../src/scheduler.js";
import * as decoder from "../src/media-decoder.js";

describe("pinned Codex Rust oracle", () => {
	for (const [index, vector] of reference.vectors.entries()) {
		test(`${vector.operation} vector ${index}`, () => {
			if (vector.operation === "count") expect(textTokens(vector.text)).toBe(vector.expected);
			if (vector.operation === "truncate") expect(truncateText(vector.text, vector.budget)).toBe(vector.expected);
			if (vector.operation === "reasoning") expect(approximateResponseItemTokens([{ type: "compaction", encrypted_content: "x".repeat(vector.budget) }])).toBe(vector.expected);
			if (vector.operation === "output") {
				const item = { type: "function_call_output", output: [{ type: "encrypted_content", encrypted_content: "x".repeat(vector.budget) }] };
				expect(approximateResponseItemTokens([item])).toBe(Math.ceil((Buffer.byteLength(JSON.stringify(item)) - vector.budget + Number(vector.expected)) / 4));
			}
		});
	}
	test.each(reference.imageVectors)("official image boundary at $budget tokens", ({ input, budget, expected }) => {
		expect(retainRecentMessages(input, budget)).toEqual(expected);
	});
	test("keeps image labels atomic and retains later audio and text", () => {
		const parts = [
			{ type: "input_text", text: "earlier text" },
			{ type: "input_text", text: '<image name=[Image #7] path="image.png">' },
			{ type: "input_image", image_url: "data:image/png;base64,abc" },
			{ type: "input_text", text: "</image>" },
			{ type: "input_text", text: "keep" },
			{ type: "input_audio", audio_url: "data:audio/wav;base64,abc" },
		];
		const imageCost = 1844 + textTokens(parts[1]!.text!) + textTokens(parts[3]!.text!);
		const message = { type: "message", role: "user", content: parts };
		for (const [budget, start] of [[imageCost, 4], [imageCost + 1, 1]]) {
			expect(retainRecentMessages([message], budget)).toEqual([{ ...message, content: parts.slice(start) }]);
		}
	});
	test("keeps the raw auto limit separate from the effective cap", () => {
		const config = { autoCompactScope: "total" as const };
		expect(autoCompactTokenLimit(config, 272000)).toBe(244800);
		expect(effectiveContextWindow(config, 272000)).toBe(258400);
		expect(effectiveContextWindow({ ...config, effectiveContextWindowPercent: 100 }, 272000)).toBe(272000);
		for (const [tokens, expected] of [[258399, false], [258400, true]] as const) {
			expect(shouldAutoCompact({ status: { activeContextTokens: tokens, contextWindow: 258400, prefillTokens: 100000 }, limit: 244800, scope: "bodyAfterPrefix" })).toBe(expected);
		}
	});
	test("bounds original-image decoding and reuses repeated image estimates", () => {
		const decode = vi.spyOn(decoder, "decodeOriginalImageBytes").mockReturnValue(8);
		try {
			const image = { type: "input_image", image_url: `data:image/png;base64,${Buffer.from("unique-original-image-test").toString("base64")}`, detail: "original" };
			for (let index = 0; index < 100; index++) expect(imageBytes(image)).toBe(8);
			expect(decode).toHaveBeenCalledTimes(1);
			for (let index = 0; index < 40; index++) imageBytes({ ...image, image_url: `data:image/png;base64,${Buffer.from(`eviction-${index}`).toString("base64")}` });
			imageBytes(image);
			expect(decode).toHaveBeenCalledTimes(42);
		} finally { decode.mockRestore(); }
	});
	test("falls back for unreadable original images without fetching URLs", () => {
		const fetch = vi.spyOn(globalThis, "fetch");
		try {
			for (const image_url of ["https://example.invalid/picture", "data:image/png;base64,???", "data:image/png;base64,YWJj"]) {
				expect(imageBytes({ image_url, detail: "original" })).toBe(7373);
			}
			expect(fetch).not.toHaveBeenCalled();
		} finally { fetch.mockRestore(); }
	});
});
