import { describe, expect, test, vi } from "vitest";
import { ModelRegistry, ModelRuntime, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createModelMetadataStore } from "../src/model-metadata.js";

const token = (account = "account-a") => `head.${Buffer.from(JSON.stringify({
	"https://api.openai.com/auth": { chatgpt_account_id: account },
})).toString("base64url")}.signature`;
const model = (id = "model-a", baseUrl = "https://chatgpt.com/backend-api") => ({
	provider: "openai-codex", api: "openai-codex-responses", id, baseUrl,
}) as never;
const catalog = (hash = "hash-a") => new Response(JSON.stringify({ models: [
	{ slug: "model-a", comp_hash: hash }, { slug: "future-model", comp_hash: "hash-z" },
] }), { headers: { "content-type": "application/json" } });
const context = (key = token(), baseUrl?: string) => ({ modelRegistry: {
	getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: key, headers: {}, baseUrl })),
} }) as unknown as ExtensionContext;
const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
};

describe("Codex model metadata", () => {
	test("requests the official catalog with host credentials and caches exact IDs", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => catalog());
		const store = createModelMetadataStore({ fetch });
		const ctx = context();
		const params = { ctx, model: model(), clientVersion: "0.156.0" };
		const first = await store.resolve(params);
		expect(first.hashFor(model())).toBe("hash-a");
		expect(first.hashFor(model("future-model"))).toBe("hash-z");
		expect((await store.resolve(params)).hashFor(model())).toBe("hash-a");
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
		expect(url).toBe("https://chatgpt.com/backend-api/codex/models?client_version=0.156.0");
		expect(init.method).toBe("GET");
		expect(init.redirect).toBe("error");
		expect(init.body).toBeUndefined();
		const headers = new Headers(init.headers);
		expect(headers.get("authorization")).toBe(`Bearer ${token()}`);
		expect(headers.get("chatgpt-account-id")).toBe("account-a");
		expect(headers.get("accept")).toBe("application/json");
		for (const name of ["OpenAI-Beta", "x-codex-beta-features", "x-codex-turn-state", "session-id", "x-client-request-id", "content-type"]) {
			expect(headers.has(name)).toBe(false);
		}
	});

	test("keeps failed discovery out of compaction and retries after the backoff", async () => {
		let now = 0;
		const fetch = vi.fn(async () => new Response("secret", { status: 401 }));
		const store = createModelMetadataStore({ fetch, now: () => now });
		const params = { ctx: context(), model: model(), clientVersion: "0.156.0" };
		expect((await store.resolve(params)).status).toBe("unavailable");
		now = 29_999;
		expect((await store.resolve(params)).status).toBe("unavailable");
		expect(fetch).toHaveBeenCalledTimes(1);
		now = 30_000;
		await store.resolve(params);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	test("refreshes expired catalogs and limits unknown IDs to one refresh per window", async () => {
		let now = 0;
		const fetch = vi.fn(async () => new Response(JSON.stringify({ models: [
			{ slug: "model-a", comp_hash: now < 330_000 ? "old" : "new" },
			...(now >= 330_000 ? [{ slug: "future-model", comp_hash: "future" }] : []),
		] })));
		const store = createModelMetadataStore({ fetch, now: () => now });
		const ctx = context();
		const params = { ctx, model: model(), clientVersion: "0.156.0" };
		const first = await store.resolve(params);
		expect(first.hashFor(model())).toBe("old");
		for (let id = 0; id < 100; id++) {
			now = 1 + id;
			await store.resolve({ ...params, model: model(`unknown-${id}`) });
		}
		expect(fetch).toHaveBeenCalledTimes(1);
		now = 30_000;
		await store.resolve({ ...params, model: model("missing") });
		expect(fetch).toHaveBeenCalledTimes(2);
		now = 329_999;
		expect((await store.resolve(params)).hashFor(model())).toBe("old");
		now = 330_000;
		const refreshed = await store.resolve(params);
		expect(refreshed.hashFor(model())).toBe("new");
		expect(refreshed.hashFor(model("future-model"))).toBe("future");
		expect(first.hashFor(model())).toBe("old");
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	test("shares a pending GET while caller cancellation stays independent", async () => {
		const pending = deferred<Response>();
		const fetch = vi.fn<typeof globalThis.fetch>(async () => pending.promise);
		const store = createModelMetadataStore({ fetch });
		const ctx = context();
		const first = new AbortController();
		const second = new AbortController();
		const params = { ctx, model: model(), clientVersion: "0.156.0" };
		const one = store.resolve({ ...params, signal: first.signal });
		const two = store.resolve({ ...params, signal: second.signal });
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		first.abort();
		await expect(one).rejects.toMatchObject({ name: "AbortError" });
		expect((fetch.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(false);
		pending.resolve(catalog());
		expect((await two).hashFor(model())).toBe("hash-a");
	});

	test("combines one hundred concurrent readers and reuses the decoded catalog", async () => {
		const pending = deferred<Response>();
		const fetch = vi.fn<typeof globalThis.fetch>(async () => pending.promise);
		const store = createModelMetadataStore({ fetch });
		const params = { ctx: context(), model: model(), clientVersion: "0.156.0" };
		const readers = Array.from({ length: 100 }, () => store.resolve(params));
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		pending.resolve(catalog());
		for (const snapshot of await Promise.all(readers)) expect(snapshot.hashFor(model())).toBe("hash-a");
		for (const snapshot of await Promise.all(Array.from({ length: 100 }, () => store.resolve(params)))) {
			expect(snapshot.hashFor(model())).toBe("hash-a");
		}
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("cancels late authentication and lets a new lifecycle resolve", async () => {
		const auth = deferred<any>();
		const ctx = { modelRegistry: { getApiKeyAndHeaders: vi.fn(() => auth.promise) } } as never;
		const fetch = vi.fn<typeof globalThis.fetch>(async () => catalog());
		const store = createModelMetadataStore({ fetch });
		const params = { ctx, model: model(), clientVersion: "0.156.0" };
		const old = store.resolve(params);
		store.clear();
		await expect(old).rejects.toMatchObject({ name: "AbortError" });
		auth.resolve({ ok: true, apiKey: token(), headers: {} });
		await Promise.resolve();
		expect(fetch).not.toHaveBeenCalled();
		expect((await store.resolve(params)).hashFor(model())).toBe("hash-a");
	});

	test("does not retain a backoff after the last caller cancels", async () => {
		const old = deferred<Response>();
		const fetch = vi.fn()
			.mockImplementationOnce(async () => old.promise)
			.mockImplementationOnce(async () => catalog("new"));
		const store = createModelMetadataStore({ fetch });
		const params = { ctx: context(), model: model(), clientVersion: "0.156.0" };
		const controller = new AbortController();
		const first = store.resolve({ ...params, signal: controller.signal });
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		controller.abort();
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		const next = await store.resolve(params);
		expect(next.hashFor(model())).toBe("new");
		expect(fetch).toHaveBeenCalledTimes(2);
		old.resolve(catalog("stale"));
		await Promise.resolve();
		expect((await store.resolve(params)).hashFor(model())).toBe("new");
	});

	test("never sends metadata credentials to an unsupported address", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => catalog());
		const ctx = context(token(), "https://example.test/backend-api");
		const store = createModelMetadataStore({ fetch });
		expect((await store.resolve({ ctx, model: model(), clientVersion: "0.156.0" })).status).toBe("unsupported");
		for (const address of ["https://chatgpt.com/backend-api?x=y", "https://chatgpt.com/backend-api?", "https://chatgpt.com/backend-api#x", "https://chatgpt.com/backend-api#", "https://user:pass@chatgpt.com/backend-api"]) {
			expect((await store.resolve({ ctx: context(token(), address), model: model(), clientVersion: "0.156.0" })).status).toBe("unsupported");
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	test("bounds response bytes even when Content-Length is false", async () => {
		const cancel = vi.fn();
		const fetch = vi.fn(async () => new Response(new ReadableStream({
			start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); },
			cancel,
		}), { headers: { "content-length": "1" } }));
		const store = createModelMetadataStore({ fetch });
		expect((await store.resolve({ ctx: context(), model: model(), clientVersion: "0.156.0" })).status).toBe("unavailable");
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	test("accepts a catalog body at the exact eight MiB boundary", async () => {
		const content = JSON.stringify({ models: [{ slug: "model-a", comp_hash: "exact" }] });
		const body = content + " ".repeat(8 * 1024 * 1024 - content.length);
		const store = createModelMetadataStore({ fetch: async () => new Response(body) });
		expect((await store.resolve({ ctx: context(), model: model(), clientVersion: "0.156.0" })).hashFor(model())).toBe("exact");
	});

	test("separates token, account and version scopes", async () => {
		const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify({ models: [
			{ slug: "model-a", comp_hash: new Headers(init?.headers).get("chatgpt-account-id") },
		] })));
		const store = createModelMetadataStore({ fetch });
		const resolve = (key: string, version = "0.156.0") => store.resolve({ ctx: context(key), model: model(), clientVersion: version });
		expect((await resolve(token("one"))).hashFor(model())).toBe("one");
		expect((await resolve(token("two"))).hashFor(model())).toBe("two");
		expect((await resolve(`${token("one")}changed`)).hashFor(model())).toBe("one");
		expect((await resolve(token("one"), "0.157.0")).hashFor(model())).toBe("one");
		expect(fetch).toHaveBeenCalledTimes(4);
	});

	test("limits the number of pending credential scopes", async () => {
		const fetch = vi.fn(async () => new Promise<Response>(() => {}));
		const store = createModelMetadataStore({ fetch });
		const pending = Array.from({ length: 4 }, (_, index) => store.resolve({
			ctx: context(token(`account-${index}`)), model: model(), clientVersion: "0.156.0",
		}).catch((error) => error));
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
		expect((await store.resolve({ ctx: context(token("fifth")), model: model(), clientVersion: "0.156.0" })).status).toBe("unavailable");
		expect(fetch).toHaveBeenCalledTimes(4);
		store.cancelPending();
		for (const value of await Promise.all(pending)) expect(value.name).toBe("AbortError");
	});

	test("uses the real Pi authentication seam with synthetic credentials", async () => {
		const credential = (expires: number) => ({ type: "oauth", access: token(), refresh: "synthetic-refresh", expires });
		const credentials = (expires: number) => ({
			read: async (providerId: string) => providerId === "openai-codex" ? credential(expires) : undefined,
			list: async () => [{ providerId: "openai-codex", type: "oauth" }],
			modify: async () => { throw new Error("credential_refresh_disabled"); },
			delete: async () => { throw new Error("credential_delete_disabled"); },
		});
		const runtime = await ModelRuntime.create({
			credentials: credentials(Date.now() + 3_600_000) as never,
			modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
		});
		const registry = new ModelRegistry(runtime);
		const piModel = registry.getAll().find((entry) => entry.provider === "openai-codex" && entry.api === "openai-codex-responses")!;
		const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
			expect(init?.method).toBe("GET");
			return new Response(JSON.stringify({ models: [{ slug: piModel.id, comp_hash: "pi" }] }));
		});
		const store = createModelMetadataStore({ fetch });
		expect((await store.resolve({ ctx: { modelRegistry: registry }, model: piModel, clientVersion: "0.156.0" })).hashFor(piModel)).toBe("pi");
		expect(fetch).toHaveBeenCalledTimes(1);
		const expiredRuntime = await ModelRuntime.create({
			credentials: credentials(0) as never,
			modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
		});
		const expired = new ModelRegistry(expiredRuntime);
		expect((await store.resolve({ ctx: { modelRegistry: expired }, model: piModel, clientVersion: "0.156.0" })).status).toBe("unavailable");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("times out a response body and clears its timer", async () => {
		vi.useFakeTimers();
		try {
			const fetch = vi.fn(async () => new Response(new ReadableStream({ start() {} })));
			const store = createModelMetadataStore({ fetch });
			const params = { ctx: context(), model: model(), clientVersion: "0.156.0" };
			const result = store.resolve(params);
			await vi.advanceTimersByTimeAsync(3_000);
			expect((await result).status).toBe("unavailable");
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	test("retains completed snapshots on cancelPending and removes them on clear", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => catalog());
		const store = createModelMetadataStore({ fetch });
		const params = { ctx: context(), model: model(), clientVersion: "0.156.0" };
		await store.resolve(params);
		store.cancelPending();
		expect((await store.resolve(params)).hashFor(model())).toBe("hash-a");
		expect(fetch).toHaveBeenCalledTimes(1);
		store.clear();
		await store.resolve(params);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	test("evicts the least recently used completed scope", async () => {
		let now = 0;
		const fetch = vi.fn<typeof globalThis.fetch>(async () => catalog());
		const store = createModelMetadataStore({ fetch, now: () => now });
		const resolve = (account: string) => store.resolve({
			ctx: context(token(account)), model: model(), clientVersion: "0.156.0",
		});
		for (let index = 0; index < 4; index++) { now++; await resolve(`account-${index}`); }
		now++;
		await resolve("account-0");
		now++;
		await resolve("account-4");
		expect(fetch).toHaveBeenCalledTimes(5);
		now++;
		await resolve("account-1");
		expect(fetch).toHaveBeenCalledTimes(6);
	});

	test("handles authentication failures without fetching or exposing errors", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => catalog());
		const store = createModelMetadataStore({ fetch });
		for (const auth of [
			{ ok: false, error: "synthetic-secret" },
			{ ok: true, apiKey: "" },
			{ ok: true, apiKey: "bad-token" },
		]) {
			const ctx = { modelRegistry: { getApiKeyAndHeaders: async () => auth } } as never;
			const result = await store.resolve({ ctx, model: model(), clientVersion: "0.156.0" });
			expect(result.status).toBe("unavailable");
			expect(JSON.stringify(result)).not.toContain("synthetic-secret");
		}
		const ctx = { modelRegistry: { getApiKeyAndHeaders: async () => { throw new Error("synthetic-secret"); } } } as never;
		expect((await store.resolve({ ctx, model: model(), clientVersion: "0.156.0" })).status).toBe("unavailable");
		expect(fetch).not.toHaveBeenCalled();
	});

	test("normalizes official URL forms and skips authentication for other providers", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => catalog());
		const store = createModelMetadataStore({ fetch });
		const ctx = context();
		for (const baseUrl of [
			"https://chatgpt.com/backend-api",
			"https://chatgpt.com/backend-api/codex/",
			"https://chatgpt.com/backend-api/codex/responses/",
		]) {
			const result = await store.resolve({ ctx, model: model("model-a", baseUrl), clientVersion: "0.156.0" });
			expect(result.hashFor(model("model-a", baseUrl))).toBe("hash-a");
		}
		expect(fetch).toHaveBeenCalledTimes(1);
		const other = model("model-a") as any;
		other.provider = "other";
		expect((await store.resolve({ ctx, model: other, clientVersion: "0.156.0" })).status).toBe("unsupported");
		expect(ctx.modelRegistry.getApiKeyAndHeaders).toHaveBeenCalledTimes(3);
	});

	test("stops before authentication on a pre-aborted call and handles a late auth rejection", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => catalog());
		const pending = deferred<any>();
		const auth = vi.fn(() => pending.promise);
		const ctx = { modelRegistry: { getApiKeyAndHeaders: auth } } as never;
		const store = createModelMetadataStore({ fetch });
		const signal = new AbortController();
		signal.abort();
		await expect(store.resolve({ ctx, model: model(), clientVersion: "0.156.0", signal: signal.signal })).rejects.toMatchObject({ name: "AbortError" });
		expect(auth).not.toHaveBeenCalled();
		const live = new AbortController();
		const result = store.resolve({ ctx, model: model(), clientVersion: "0.156.0", signal: live.signal });
		live.abort();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		pending.reject(new Error("synthetic-secret"));
		await Promise.resolve();
		expect(fetch).not.toHaveBeenCalled();
	});

	test("handles authentication rejected after a synchronous lifecycle clear", async () => {
		const pending = deferred<any>();
		const store = createModelMetadataStore({ fetch: async () => catalog() });
		const ctx = { modelRegistry: { getApiKeyAndHeaders: () => {
			store.clear();
			return pending.promise;
		} } } as never;
		await expect(store.resolve({ ctx, model: model(), clientVersion: "0.156.0" })).rejects.toMatchObject({ name: "AbortError" });
		pending.reject(new Error("synthetic-secret"));
		await Promise.resolve();
	});

	test.each([401, 403, 429, 500, 302])("does not read an HTTP %i error body", async (status) => {
		const response = new Response("synthetic-secret", { status });
		const read = vi.spyOn(response.body!, "getReader");
		const fetch = vi.fn(async () => response);
		const store = createModelMetadataStore({ fetch });
		expect((await store.resolve({ ctx: context(), model: model(), clientVersion: "0.156.0" })).status).toBe("unavailable");
		expect(read).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("treats a network failure as unavailable without another request", async () => {
		const fetch = vi.fn(async () => { throw new Error("synthetic-secret"); });
		const store = createModelMetadataStore({ fetch });
		const result = await store.resolve({ ctx: context(), model: model(), clientVersion: "0.156.0" });
		expect(result.status).toBe("unavailable");
		expect(JSON.stringify(result)).not.toContain("synthetic-secret");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("never reuses an expired hash after refresh failure", async () => {
		let now = 0;
		const fetch = vi.fn()
			.mockImplementationOnce(async () => catalog("old"))
			.mockImplementationOnce(async () => new Response("bad", { status: 500 }));
		const store = createModelMetadataStore({ fetch, now: () => now });
		const params = { ctx: context(), model: model(), clientVersion: "0.156.0" };
		expect((await store.resolve(params)).hashFor(model())).toBe("old");
		now = 300_000;
		expect((await store.resolve(params)).hashFor(model())).toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(2);
		now = 329_999;
		expect((await store.resolve(params)).hashFor(model())).toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	test.each(["not-json", JSON.stringify({ models: "wrong" }), JSON.stringify({ models: [{ slug: "model-a", comp_hash: 42 }] })])(
		"treats invalid catalog data as unavailable: %s", async (body) => {
			const fetch = vi.fn(async () => new Response(body));
			const store = createModelMetadataStore({ fetch });
			expect((await store.resolve({ ctx: context(), model: model(), clientVersion: "0.156.0" })).status).toBe("unavailable");
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);

	test("replaces the complete catalog when a model disappears", async () => {
		let now = 0;
		const fetch = vi.fn(async () => now === 0 ? catalog() : new Response(JSON.stringify({ models: [
			{ slug: "future-model", comp_hash: "future" },
		] })));
		const store = createModelMetadataStore({ fetch, now: () => now });
		const params = { ctx: context(), model: model(), clientVersion: "0.156.0" };
		const first = await store.resolve(params);
		now = 300_000;
		const next = await store.resolve(params);
		expect(next.hashFor(model())).toBeUndefined();
		expect(next.hashFor(model("future-model"))).toBe("future");
		expect(first.hashFor(model())).toBe("hash-a");
	});
});
