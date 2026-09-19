import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { imageBytes } from "../src/token-estimation.js";
import { approximateResponseItemTokens, approximateTokenCount, retainRecentMessages } from "../src/native-compaction.js";

describe("Codex token accounting", () => {
	test("falls back for an original image whose header is valid but pixel data is missing", () => {
		const header = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");
		expect(imageBytes({ detail: "original", image_url: `data:image/png;base64,${header.toString("base64")}` })).toBe(7373);
	});
	test("estimates inline WAV by duration while preserving its data URL and JSON framing", () => {
		const payload = readFileSync(new URL("./fixtures/media/one-second.wav", import.meta.url)).toString("base64");
		const item = { type: "message", role: "user", content: [{ type: "input_audio", audio_url: `data:audio/wav;base64,${payload}` }] };
		expect(approximateResponseItemTokens([item])).toBe(Math.ceil((Buffer.byteLength(JSON.stringify(item)) - payload.length + 10 * 4) / 4));
	});
	test("handles large original image payloads without regex stack overflow", () => {
		expect(() => imageBytes({ detail: "original", image_url: `data:image/png;base64,${"AAAA".repeat(1000000)}` })).not.toThrow();
	});
	test("discounts inline image payload bytes while retaining JSON framing", () => {
		const item = { type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${"x".repeat(40000)}` }] };
		expect(approximateResponseItemTokens([item])).toBe(Math.ceil((Buffer.byteLength(JSON.stringify(item)) - 40000 + 7373) / 4));
		const external = { type: "message", role: "user", content: [{ type: "input_image", image_url: "https://example.invalid/image.png" }] };
		expect(approximateResponseItemTokens([external])).toBe(Math.ceil(Buffer.byteLength(JSON.stringify(external)) / 4));
	});
	test("retains both ends of a boundary text message using the official marker", () => {
		expect(retainRecentMessages([{ type: "message", role: "user", content: [{ type: "input_text", text: "abcdefghijklmnop" }] }], 2))
			.toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "abcd…2 tokens truncated…mnop" }] }]);
	});
	test("charges images against the retained budget and stops at the boundary", () => {
		const older = { type: "message", role: "user", content: [{ type: "input_text", text: "old" }] };
		const image = { type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,x" }] };
		expect(retainRecentMessages([older, image], 1843)).toEqual([]);
		expect(retainRecentMessages([older, image], 1844)).toEqual([image]);
	});
	test.each(["reasoning", "compaction", "context_compaction"])("discounts encrypted %s framing like Codex", (type) => {
		expect(approximateResponseItemTokens([{ type, encrypted_content: "x".repeat(4000) }])).toBe(588);
		expect(approximateResponseItemTokens([{ type, encrypted_content: "opaque" }])).toBe(0);
	});
	test("counts UTF-8 bytes and message framing instead of UTF-16 text length", () => {
		const item = { type: "message", role: "user", content: [{ type: "input_text", text: "中文🙂" }] };
		expect(approximateTokenCount({ instructions: "中文🙂" })).toBe(Math.ceil(Buffer.byteLength(JSON.stringify({ instructions: "中文🙂" })) / 4));
		expect(approximateResponseItemTokens([item])).toBe(Math.ceil(Buffer.byteLength(JSON.stringify(item)) / 4));
	});
});
