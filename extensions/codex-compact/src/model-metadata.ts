import { createHash } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CODEX_MODELS_URL, createCompactionHashSnapshot, emptyCompactionHashSnapshot,
	normalizeCodexBaseUrl, parseCompactionCatalog, type CompactionHashSnapshot,
} from "./capabilities.js";
import { buildCodexHeaders } from "./native-compaction.js";

const TTL_MS = 300_000;
const RETRY_MS = 30_000;
const HTTP_TIMEOUT_MS = 3_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_SCOPES = 4;

type ResolveParams = {
	ctx: Pick<ExtensionContext, "modelRegistry">;
	model: Model<any>;
	clientVersion: string;
	signal?: AbortSignal;
};

export type ModelMetadataStore = {
	resolve(params: ResolveParams): Promise<CompactionHashSnapshot>;
	cancelPending(): void;
	clear(): void;
};

type Pending = {
	controller: AbortController;
	promise: Promise<CompactionHashSnapshot>;
	waiters: number;
	lastAttemptAt?: number;
	retryAt?: number;
};

type Entry = {
	snapshot?: CompactionHashSnapshot;
	fetchedAt?: number;
	lastAttemptAt?: number;
	retryAt?: number;
	lastUsedAt: number;
	pending?: Pending;
};

function cancelled(): Error {
	return Object.assign(new Error("Codex metadata request cancelled"), { name: "AbortError" });
}

function awaitWithSignals<T>(promise: Promise<T>, signals: readonly (AbortSignal | undefined)[]): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
		const cleanup = () => { for (const signal of active) signal.removeEventListener("abort", onAbort); };
		const onAbort = () => { cleanup(); reject(cancelled()); };
		if (active.some((signal) => signal.aborted)) {
			void promise.catch(() => {});
			reject(cancelled());
			return;
		}
		for (const signal of active) signal.addEventListener("abort", onAbort, { once: true });
		promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
	});
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<unknown> {
	if (!response.body) throw new Error("Empty Codex model catalog");
	const reader = response.body.getReader();
	let bytes = new Uint8Array(64 * 1024);
	let size = 0;
	try {
		while (true) {
			const result = await awaitWithSignals(reader.read(), [signal]);
			if (result.done) break;
			const nextSize = size + result.value.byteLength;
			if (nextSize > MAX_BODY_BYTES) throw new Error("Codex model catalog too large");
			if (nextSize > bytes.length) {
				const grown = new Uint8Array(Math.min(MAX_BODY_BYTES, Math.max(nextSize, bytes.length * 2)));
				grown.set(bytes.subarray(0, size));
				bytes = grown;
			}
			bytes.set(result.value, size);
			size = nextSize;
		}
		return JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)));
	} catch (error) {
		void reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
}

export function createModelMetadataStore(deps: {
	fetch?: typeof globalThis.fetch;
	now?: () => number;
} = {}): ModelMetadataStore {
	const fetcher: typeof globalThis.fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
	const now = deps.now ?? (() => performance.now());
	const entries = new Map<string, Entry>();
	let epoch = 0;
	let lifetime = new AbortController();

	function fresh(entry: Entry): CompactionHashSnapshot | undefined {
		return entry.snapshot && entry.fetchedAt !== undefined && now() - entry.fetchedAt < TTL_MS
			? entry.snapshot : undefined;
	}

	function cancelEntry(entry: Entry): void {
		const pending = entry.pending;
		if (!pending) return;
		entry.pending = undefined;
		entry.lastAttemptAt = pending.lastAttemptAt;
		entry.retryAt = pending.retryAt;
		pending.controller.abort();
	}

	function cancelPending(): void {
		epoch++;
		lifetime.abort();
		lifetime = new AbortController();
		for (const entry of entries.values()) cancelEntry(entry);
	}

	async function fetchSnapshot(headers: Headers, modelBaseUrl: string, clientVersion: string, signal: AbortSignal): Promise<CompactionHashSnapshot> {
		const url = new URL(CODEX_MODELS_URL);
		url.searchParams.set("client_version", clientVersion);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
		const abort = () => controller.abort();
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) controller.abort();
		try {
			const response = await awaitWithSignals(fetcher(url.toString(), {
				method: "GET", headers, redirect: "error", signal: controller.signal,
			}), [controller.signal]);
			if (!response.ok) {
				void response.body?.cancel().catch(() => {});
				return emptyCompactionHashSnapshot("unavailable");
			}
			const catalog = parseCompactionCatalog(await readBoundedBody(response, controller.signal));
			return createCompactionHashSnapshot(catalog, modelBaseUrl);
		} catch {
			return emptyCompactionHashSnapshot("unavailable");
		} finally {
			clearTimeout(timeout);
			signal.removeEventListener("abort", abort);
		}
	}

	function subscribe(entry: Entry, pending: Pending, signals: readonly (AbortSignal | undefined)[]): Promise<CompactionHashSnapshot> {
		pending.waiters++;
		return awaitWithSignals(pending.promise, signals).finally(() => {
			pending.waiters--;
			if (pending.waiters === 0 && entry.pending === pending) cancelEntry(entry);
		});
	}

	async function resolve(params: ResolveParams): Promise<CompactionHashSnapshot> {
		const { model, signal } = params;
		if (signal?.aborted) throw cancelled();
		if (model.provider !== "openai-codex" || model.api !== "openai-codex-responses") {
			return emptyCompactionHashSnapshot("unsupported");
		}
		const operationEpoch = epoch;
		const operationLifetime = lifetime.signal;
		const signals = [signal, operationLifetime];
		let auth: Awaited<ReturnType<typeof params.ctx.modelRegistry.getApiKeyAndHeaders>>;
		try {
			auth = await awaitWithSignals(params.ctx.modelRegistry.getApiKeyAndHeaders(model), signals);
		} catch (error) {
			if (signal?.aborted || operationLifetime.aborted) throw cancelled();
			return emptyCompactionHashSnapshot("unavailable");
		}
		if (signal?.aborted || operationLifetime.aborted || operationEpoch !== epoch) throw cancelled();
		if (!auth.ok || !auth.apiKey) return emptyCompactionHashSnapshot("unavailable");
		const effectiveBaseUrl = normalizeCodexBaseUrl(auth.baseUrl ?? model.baseUrl);
		const modelBaseUrl = normalizeCodexBaseUrl(model.baseUrl);
		if (!effectiveBaseUrl || !modelBaseUrl) return emptyCompactionHashSnapshot("unsupported");
		let headers: Headers;
		try {
			headers = buildCodexHeaders({ apiKey: auth.apiKey, headers: auth.headers, sessionId: "metadata" });
		} catch {
			return emptyCompactionHashSnapshot("unavailable");
		}
		headers.set("accept", "application/json");
		for (const name of ["OpenAI-Beta", "x-codex-beta-features", "x-codex-turn-state", "session-id", "x-client-request-id", "content-type"]) {
			headers.delete(name);
		}
		const account = headers.get("chatgpt-account-id");
		if (!account) return emptyCompactionHashSnapshot("unavailable");
		const fingerprint = createHash("sha256").update(JSON.stringify([auth.apiKey, account])).digest("hex");
		const key = JSON.stringify([model.provider, model.api, modelBaseUrl, effectiveBaseUrl, CODEX_MODELS_URL, params.clientVersion, fingerprint]);
		let entry = entries.get(key);
		if (!entry) {
			if (entries.size >= MAX_SCOPES) {
				let victimKey: string | undefined;
				let oldest = Infinity;
				for (const [candidateKey, candidate] of entries) {
					if (!candidate.pending && candidate.lastUsedAt < oldest) { oldest = candidate.lastUsedAt; victimKey = candidateKey; }
				}
				if (victimKey === undefined) return emptyCompactionHashSnapshot("unavailable");
				entries.delete(victimKey);
			}
			entry = { lastUsedAt: now() };
			entries.set(key, entry);
		}
		entry.lastUsedAt = now();
		if (entry.pending) return subscribe(entry, entry.pending, signals);
		const cached = fresh(entry);
		if (cached?.hashFor(model)) return cached;
		if (cached && entry.lastAttemptAt !== undefined && now() - entry.lastAttemptAt < RETRY_MS) return cached;
		if (entry.retryAt !== undefined && now() < entry.retryAt) return cached ?? emptyCompactionHashSnapshot("unavailable");
		const beforeAttempt = { lastAttemptAt: entry.lastAttemptAt, retryAt: entry.retryAt };
		entry.lastAttemptAt = now();
		const pending: Pending = { controller: new AbortController(), waiters: 0,
			lastAttemptAt: beforeAttempt.lastAttemptAt, retryAt: beforeAttempt.retryAt,
			promise: undefined as unknown as Promise<CompactionHashSnapshot> };
		entry.pending = pending;
		const requestEpoch = epoch;
		pending.promise = fetchSnapshot(headers, modelBaseUrl, params.clientVersion, pending.controller.signal).then((snapshot) => {
			if (entry.pending === pending && epoch === requestEpoch && !pending.controller.signal.aborted) {
				if (snapshot.status === "available") {
					entry.snapshot = snapshot;
					entry.fetchedAt = now();
					entry.retryAt = undefined;
				} else {
					entry.retryAt = now() + RETRY_MS;
				}
				return fresh(entry) ?? emptyCompactionHashSnapshot("unavailable");
			}
			return emptyCompactionHashSnapshot("unavailable");
		}).finally(() => {
			if (entry.pending === pending) entry.pending = undefined;
		});
		return subscribe(entry, pending, signals);
	}

	return { resolve, cancelPending, clear() { cancelPending(); entries.clear(); } };
}
