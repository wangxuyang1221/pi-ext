import { describe, expect, test } from "vitest";
import { createCompactionHashSnapshot, parseCompactionCatalog } from "../src/capabilities.js";

const model = (id: string, extras: Record<string, unknown> = {}) => ({
	provider: "openai-codex", api: "openai-codex-responses", id,
	baseUrl: "https://chatgpt.com/backend-api", ...extras,
}) as never;

describe("Codex compaction catalog", () => {
	test("uses exact model IDs and keeps snapshots immutable", () => {
		const catalog = parseCompactionCatalog({ models: [
			{ slug: "model-a", comp_hash: "opaque-a", context_window: 100 },
			{ slug: "model-b", comp_hash: "opaque-a", context_window: 200 },
			{ slug: "future-model", comp_hash: " opaque-z " },
		] });
		const snapshot = createCompactionHashSnapshot(catalog, "https://chatgpt.com/backend-api");
		expect(snapshot.hashFor(model("future-model"))).toBe(" opaque-z ");
		expect(snapshot.hashFor(model("namespace/future-model"))).toBeUndefined();
		expect(snapshot.hashFor(model("future-model-variant"))).toBeUndefined();
		expect(snapshot.hashFor(model("model-a", { compHash: "forged" }))).toBe("opaque-a");
		expect(snapshot.hashFor(model("model-b", { baseUrl: "https://example.test" }))).toBeUndefined();
		expect(snapshot.hashFor(model("model-b", { provider: "anthropic" }))).toBeUndefined();
		expect(snapshot.hashFor(model("model-b", { api: "other" }))).toBeUndefined();
		(catalog as Map<string, string>).set("future-model", "changed");
		expect(snapshot.hashFor(model("future-model"))).toBe(" opaque-z ");
		expect(Object.keys(snapshot)).toEqual(["status", "hashFor"]);
	});

	test("rejects invalid catalogs and treats absent hashes as unknown", () => {
		for (const hash of [undefined, null, "", "  "]) {
			expect(parseCompactionCatalog({ models: [{ slug: "a", comp_hash: hash }] }).get("a")).toBeUndefined();
		}
		for (const value of [null, {}, { models: {} }, { models: [{ slug: "a", comp_hash: 3 }] },
			{ models: [{ slug: "a" }, { slug: "a" }] }, { models: [{ slug: " a" }] },
			{ models: [{ slug: "a".repeat(257) }] }, { models: [{ slug: "a", comp_hash: "x".repeat(257) }] },
			{ models: Array.from({ length: 4097 }, (_, index) => ({ slug: String(index) })) }]) {
			expect(() => parseCompactionCatalog(value)).toThrow();
		}
		expect(parseCompactionCatalog({ models: [{ slug: "a".repeat(256), comp_hash: "x".repeat(256) }] }).size).toBe(1);
		expect(parseCompactionCatalog({ models: Array.from({ length: 4096 }, (_, index) => ({ slug: String(index) })) }).size).toBe(4096);
		expect(() => parseCompactionCatalog({ get models() { throw new Error("synthetic-secret"); } })).toThrow("Invalid Codex model catalog");
	});

	test("indexes large catalogs once for repeated exact lookups", () => {
		for (const size of [10, 1000, 4096]) {
			const catalog = parseCompactionCatalog({ models: Array.from({ length: size }, (_, index) => ({
				slug: `model-${index}`, comp_hash: `hash-${index}`,
			})) });
			const snapshot = createCompactionHashSnapshot(catalog, "https://chatgpt.com/backend-api");
			for (let index = 0; index < 10_000; index++) {
				expect(snapshot.hashFor(model(`model-${index % size}`))).toBe(`hash-${index % size}`);
			}
		}
	});
});
