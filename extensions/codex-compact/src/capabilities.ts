import type { Model } from "@earendil-works/pi-ai";

export const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const OFFICIAL_BASE_URL = "https://chatgpt.com/backend-api";

export type CompactionHashSnapshot = Readonly<{
	status: "available" | "unavailable" | "unsupported";
	hashFor(model: Model<any>): string | undefined;
}>;

/** Return one canonical address for the three official Codex URL forms. */
export function normalizeCodexBaseUrl(value?: string): string | undefined {
	if (value === undefined) return OFFICIAL_BASE_URL;
	if (value.trim() !== value || value.includes("?") || value.includes("#")) return undefined;
	try {
		const url = new URL(value);
		if (url.origin !== "https://chatgpt.com" || url.username || url.password || url.search || url.hash) return undefined;
		const path = url.pathname.replace(/\/+$/, "");
		return path === "/backend-api" || path === "/backend-api/codex" || path === "/backend-api/codex/responses"
			? OFFICIAL_BASE_URL : undefined;
	} catch {
		return undefined;
	}
}

export function parseCompactionCatalog(value: unknown): ReadonlyMap<string, string | undefined> {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)
			|| !("models" in value) || !Array.isArray(value.models) || value.models.length > 4096) {
			throw new Error("Invalid Codex model catalog");
		}
		const catalog = new Map<string, string | undefined>();
		for (const entry of value.models) {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error("Invalid Codex model catalog");
			const { slug, comp_hash: hash } = entry as Record<string, unknown>;
			if (typeof slug !== "string" || !slug || slug.length > 256 || slug.trim() !== slug || catalog.has(slug)
				|| (hash !== undefined && hash !== null && (typeof hash !== "string" || hash.length > 256))) {
				throw new Error("Invalid Codex model catalog");
			}
			catalog.set(slug, typeof hash === "string" && hash.trim() ? hash : undefined);
		}
		return catalog;
	} catch {
		throw new Error("Invalid Codex model catalog");
	}
}

const unavailable = Object.freeze({ status: "unavailable" as const, hashFor: (_model: Model<any>) => undefined });
const unsupported = Object.freeze({ status: "unsupported" as const, hashFor: (_model: Model<any>) => undefined });

export function emptyCompactionHashSnapshot(status: "unavailable" | "unsupported"): CompactionHashSnapshot {
	return status === "unsupported" ? unsupported : unavailable;
}

export function createCompactionHashSnapshot(
	catalog: ReadonlyMap<string, string | undefined>, modelBaseUrl: string,
): CompactionHashSnapshot {
	const hashes = new Map(catalog);
	const baseUrl = normalizeCodexBaseUrl(modelBaseUrl);
	return Object.freeze({
		status: "available" as const,
		hashFor(model: Model<any>): string | undefined {
			if (model.provider !== "openai-codex" || model.api !== "openai-codex-responses") return undefined;
			if (!baseUrl || normalizeCodexBaseUrl(model.baseUrl) !== baseUrl) return undefined;
			return hashes.get(model.id);
		},
	});
}
