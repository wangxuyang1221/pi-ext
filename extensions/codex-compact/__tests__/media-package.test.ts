import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { copyMedia, verifyMedia } from "../../../scripts/codex-compact-media.mjs";
import { describe, expect, it } from "vitest";

describe("media runtime packaging", () => {
	it("copies and verifies the prebuilt decoder after TypeScript compilation", () => {
		const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
		expect(pkg.scripts.build).toContain("tsc -p ./extensions/codex-compact/tsconfig.json && node ./scripts/codex-compact-media.mjs copy");
	});

	it("ships a self-contained verified runtime with corresponding MPL source", () => {
		const directory = mkdtempSync(join(process.cwd(), ".tmp/codex-media-package-"));
		try {
			copyMedia(directory);
			const manifest = verifyMedia(directory);
			expect(manifest.platformFeatures).toEqual({ common: ["jpeg", "png", "gif", "webp"], darwin: ["tiff"], win32: ["bmp"] });
			const dependencies = JSON.parse(readFileSync(join(directory, "third-party/dependencies.json"), "utf8"));
			const mpl = dependencies.packages.filter((dep: { license: string }) => dep.license.includes("MPL-2.0"));
			expect(mpl.length).toBeGreaterThan(0);
			for (const dep of mpl) expect(readFileSync(join(directory, dep.bundledSource)).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
			const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(directory, "decoder.wasm"))));
			const exports = instance.exports as { allocate: (size: number) => number; release: (ptr: number, size: number) => void; image_bytes: (ptr: number, size: number, features: number) => number };
			const ptr = exports.allocate(0);
			expect(exports.image_bytes(ptr, 0, 0)).toBe(-1);
			exports.release(ptr, 0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each(["decoder.wasm", "src/audio.rs", "Cargo.lock"])("rejects stale or changed %s instead of shipping it", (file) => {
		const directory = mkdtempSync(join(process.cwd(), ".tmp/codex-media-integrity-"));
		try {
			copyMedia(directory);
			appendFileSync(join(directory, file), " ");
			expect(() => verifyMedia(directory)).toThrow(`Media integrity mismatch: ${file}`);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
