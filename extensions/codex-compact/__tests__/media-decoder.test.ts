import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeAudioDuration, decodeOriginalImageBytes } from "../src/media-decoder.js";
import * as decoder from "../src/media-decoder.js";
import { audioTokens, textTokens } from "../src/token-estimation.js";

afterEach(() => vi.restoreAllMocks());

function image(extension: string): string {
	return `data:image/${extension};base64,${readFileSync(new URL(`./fixtures/media/patch-boundary.${extension}`, import.meta.url)).toString("base64")}`;
}

describe("pinned Codex image decoder", () => {
	it.each(["png", "jpg", "gif", "webp"])("fully decodes %s and rounds each patch dimension", (extension) => {
		expect(decodeOriginalImageBytes(image(extension))).toBe(16);
	});

	it("matches platform-specific CLI TIFF and BMP feature unification", () => {
		const decode = decodeOriginalImageBytes;
		for (const platform of ["darwin", "win32", "linux"]) {
			expect(decode(image("tiff"), platform)).toBe(platform === "darwin" ? 16 : undefined);
			expect(decode(image("bmp"), platform)).toBe(platform === "win32" ? 16 : undefined);
		}
	});
});

describe("pinned Codex audio decoder", () => {
	it.each(["wav", "x-wav", "wave", "vnd.wave", "WAV"])("accepts the official %s MIME alias", (mime) => {
		const payload = readFileSync(new URL("./fixtures/media/one-second.wav", import.meta.url)).toString("base64");
		expect(decodeAudioDuration(`data:audio/${mime};base64,${payload}`)).toBe(1);
		expect(audioTokens(`data:audio/${mime};base64,${payload}`)).toBe(10);
	});

	it.each(["data:audio/wav;base64,!!!!", "data:audio/flac;base64,YWJj", "data:audio/wav;base64,", "https://example.invalid/audio.wav"])("falls back to the complete URL without fetching %s", (url) => {
		expect(decodeAudioDuration(url)).toBeUndefined();
		expect(audioTokens(url)).toBe(textTokens(url));
	});

	it("caches failures and successes with bounded LRU eviction", () => {
		const decode = vi.spyOn(decoder, "decodeAudioDuration").mockReturnValue(undefined);
		const prefix = "data:audio/unknown;test=bounded-cache;base64,";
		expect(audioTokens(prefix)).toBe(textTokens(prefix));
		expect(audioTokens(prefix)).toBe(textTokens(prefix));
		expect(decode).toHaveBeenCalledTimes(1);
		decode.mockReturnValue(1.01);
		for (let index = 0; index < 32; index++) expect(audioTokens(`${prefix}${index}`)).toBe(11);
		expect(audioTokens(`${prefix}0`)).toBe(11);
		expect(decode).toHaveBeenCalledTimes(33);
		expect(audioTokens(prefix)).toBe(11);
		expect(decode).toHaveBeenCalledTimes(34);
	});
});
