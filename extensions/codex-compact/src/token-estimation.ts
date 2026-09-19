// Adapted from OpenAI Codex 0.154.0. See ../CODEX-LICENSE and ../NOTICE.
import { createHash } from "node:crypto";
import { decodeAudioDuration, decodeOriginalImageBytes } from "./media-decoder.js";
import type { JsonObject, ResponseItem } from "./native-compaction.js";

const RESIZED_IMAGE_BYTES = 7373;
const originalImageCache = new Map<string, number>();
const audioCache = new Map<string, bigint>();
const U64_MAX = (1n << 64n) - 1n;

export function textTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

/** Parse metadata only; never fetch external images for token estimation. */
function inlineMediaPayload(url: string, prefix: "image/" | "audio/"): { mime: string; payload: string } | undefined {
	const comma = url.indexOf(",");
	if (comma < 0 || url.slice(0, 5).toLowerCase() !== "data:") return undefined;
	const [mime = "", ...parameters] = url.slice(5, comma).split(";");
	if (!mime.toLowerCase().startsWith(prefix) || !parameters.some((part) => part.toLowerCase() === "base64")) return undefined;
	return { mime: mime.toLowerCase(), payload: url.slice(comma + 1) };
}

export function inlineImagePayload(url: string): { mime: string; payload: string } | undefined {
	return inlineMediaPayload(url, "image/");
}

export function inlineAudioPayload(url: string): { mime: string; payload: string } | undefined {
	return inlineMediaPayload(url, "audio/");
}

/** Preserve Codex's 64-bit saturation even for corrupt, enormous duration metadata. */
export function audioTokenCount(url: string): bigint {
	const key = createHash("sha1").update(url).digest("hex");
	const cached = audioCache.get(key);
	if (cached !== undefined) {
		audioCache.delete(key);
		audioCache.set(key, cached);
		return cached;
	}
	const duration = decodeAudioDuration(url);
	const value = duration === undefined ? textTokens(url) : Math.ceil(duration * 10);
	const tokens = value >= Number(U64_MAX) ? U64_MAX : BigInt(Math.max(0, value));
	audioCache.set(key, tokens);
	if (audioCache.size > 32) audioCache.delete(audioCache.keys().next().value!);
	return tokens;
}

/** Numeric convenience view; integer accounting uses audioTokenCount directly. */
export function audioTokens(url: string): number {
	return Number(audioTokenCount(url));
}

/** Codex 0.154.0 heuristic with the pinned Rust full-image decoder. */
export function imageBytes(part: JsonObject): number {
	if (part.detail !== "original" || typeof part.image_url !== "string") return RESIZED_IMAGE_BYTES;
	const key = createHash("sha1").update(part.image_url).digest("hex");
	const cached = originalImageCache.get(key);
	if (cached !== undefined) {
		originalImageCache.delete(key);
		originalImageCache.set(key, cached);
		return cached;
	}
	const bytes = decodeOriginalImageBytes(part.image_url) ?? RESIZED_IMAGE_BYTES;
	originalImageCache.set(key, bytes);
	if (originalImageCache.size > 32) originalImageCache.delete(originalImageCache.keys().next().value!);
	return bytes;
}

export function contentTokens(part: JsonObject): number {
	if (part.type === "input_image" || part.type === "image_url") return Math.ceil(imageBytes(part) / 4);
	return typeof part.text === "string" ? textTokens(part.text) : 0;
}

/** Match Codex's UTF-8 middle truncation, including its marker outside the text budget. */
export function truncateText(text: string, maxTokens: number): string {
	const bytes = Buffer.from(text, "utf8");
	const budget = Math.max(0, Math.floor(maxTokens)) * 4;
	if (bytes.length <= budget) return text;
	const leftBudget = Math.floor(budget / 2);
	const rightTarget = bytes.length - (budget - leftBudget);
	// UTF-8 continuation bytes cannot start a retained slice. Inspect only the
	// two boundaries instead of walking every code point in a large message.
	let leftEnd = leftBudget;
	while (leftEnd > 0 && (bytes[leftEnd]! & 0xc0) === 0x80) leftEnd--;
	let rightStart = rightTarget;
	while (rightStart < bytes.length && (bytes[rightStart]! & 0xc0) === 0x80) rightStart++;
	const marker = `…${Math.ceil((bytes.length - budget) / 4)} tokens truncated…`;
	return bytes.subarray(0, leftEnd).toString("utf8") + marker + bytes.subarray(rightStart).toString("utf8");
}

/** Retain newest content first, with adjacent image labels kept or removed atomically. */
export function truncateImageMessage(item: ResponseItem, maxTokens: number): ResponseItem | undefined {
	if (!Array.isArray(item.content)) return undefined;
	const content = item.content as JsonObject[];
	const costs = content.map(contentTokens);
	const retained: JsonObject[] = [];
	let remaining = maxTokens;
	for (let end = content.length; end > 0;) {
		const last = end - 1;
		const part = content[last]!;
		const imageIndex = part.type === "input_image" || part.type === "image_url" ? last
			: part.type === "input_text" && part.text === "</image>" && last > 0 && content[last - 1]?.type === "input_image" ? last - 1 : -1;
		if (imageIndex >= 0) {
			const previous = content[imageIndex - 1];
			const text = previous?.type === "input_text" ? previous.text : undefined;
			const hasLabel = typeof text === "string" && (text === "<image>" || (text.startsWith("<image name=") && text.endsWith(">")));
			const start = imageIndex - Number(hasLabel);
			let cost = 0;
			for (let index = start; index < end; index++) cost += costs[index]!;
			if (cost <= remaining) {
				remaining -= cost;
				for (let index = end - 1; index >= start; index--) retained.push(structuredClone(content[index]!));
			} else remaining = 0;
			end = start;
			continue;
		}
		end--;
		if (typeof part.text === "string") {
			if (remaining <= 0) continue;
			const text = costs[last]! <= remaining ? part.text : truncateText(part.text, remaining);
			remaining = Math.max(0, remaining - costs[last]!);
			if (text) retained.push({ ...part, text });
		} else if (part.type === "input_audio") retained.push(structuredClone(part));
	}
	return retained.length ? { ...structuredClone(item), content: retained.reverse() } : undefined;
}
