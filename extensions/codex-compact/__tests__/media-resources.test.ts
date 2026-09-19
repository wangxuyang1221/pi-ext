import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

it("reuses compiled code but releases oversized decoded image heaps", async () => {
	vi.resetModules();
	const NativeInstance = WebAssembly.Instance;
	let instances = 0;
	vi.spyOn(WebAssembly, "Instance").mockImplementation(function(module: WebAssembly.Module) {
		instances++;
		return new NativeInstance(module);
	});
	const { decodeOriginalImageBytes } = await import("../src/media-decoder.js");
	const url = (name: string) => `data:image/png;base64,${readFileSync(new URL(`./fixtures/media/${name}.png`, import.meta.url)).toString("base64")}`;
	expect(decodeOriginalImageBytes(url("large-original"))).toBe(40000);
	expect(instances).toBe(1);
	expect(decodeOriginalImageBytes(url("patch-boundary"))).toBe(16);
	expect(instances).toBe(2);
	expect(decodeOriginalImageBytes(url("patch-boundary"))).toBe(16);
	expect(instances).toBe(2);
});

it("discards a trapped instance and recovers on the next input", async () => {
	vi.resetModules();
	const NativeInstance = WebAssembly.Instance;
	let instances = 0;
	vi.spyOn(WebAssembly, "Instance").mockImplementation(function(module: WebAssembly.Module) {
		instances++;
		if (instances > 1) return new NativeInstance(module);
		return { exports: {
			memory: { buffer: new ArrayBuffer(64) }, allocate: () => 0,
			release: () => { throw new Error("A trapped instance must not be touched"); },
			image_bytes: () => { throw new WebAssembly.RuntimeError("unreachable"); },
		} } as unknown as WebAssembly.Instance;
	});
	const { decodeOriginalImageBytes } = await import("../src/media-decoder.js");
	expect(decodeOriginalImageBytes("data:image/png;base64,AA==")).toBeUndefined();
	const payload = readFileSync(new URL("./fixtures/media/patch-boundary.png", import.meta.url)).toString("base64");
	expect(decodeOriginalImageBytes(`data:image/png;base64,${payload}`)).toBe(16);
	expect(instances).toBe(2);
});
