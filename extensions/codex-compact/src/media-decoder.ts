import { readFileSync } from "node:fs";

type DecoderExports = {
	memory: { buffer: ArrayBuffer };
	allocate(length: number): number;
	release(pointer: number, length: number): void;
	image_bytes(pointer: number, length: number, platformFeatures: number): number;
	audio_duration(pointer: number, length: number): number;
	context_hook(pointer: number, length: number): number;
	context_inter_agent(pointer: number, length: number): number;
};
// Node exposes WebAssembly at runtime, but this project deliberately excludes DOM types.
const wasm = (globalThis as typeof globalThis & {
	WebAssembly: {
		Module: new (bytes: Uint8Array) => object;
		Instance: new (module: object) => { exports: DecoderExports };
		RuntimeError: typeof Error;
	};
}).WebAssembly;
let module: object | undefined;
let decoder: DecoderExports | undefined;

function getDecoder(): DecoderExports {
	module ??= new wasm.Module(readFileSync(new URL("./media/decoder.wasm", import.meta.url)));
	decoder ??= new wasm.Instance(module).exports;
	return decoder;
}

function decodeMedia(url: string, operation: "image_bytes" | "audio_duration" | "context_hook" | "context_inter_agent", platformFeatures = 0): number | undefined {
	const instance = getDecoder();
	const bytes = Buffer.from(url, "utf8");
	let pointer: number | undefined;
	try {
		pointer = instance.allocate(bytes.length);
		new Uint8Array(instance.memory.buffer, pointer, bytes.length).set(bytes);
		const result = instance[operation](pointer, bytes.length, platformFeatures);
		return result < 0 ? undefined : result;
	} catch (error) {
		if (!(error instanceof wasm.RuntimeError)) throw error;
		// A trapped allocator/decoder must not be reused for the next image.
		decoder = undefined;
		return undefined;
	} finally {
		if (pointer !== undefined && decoder === instance) instance.release(pointer, bytes.length);
		// WASM memories do not shrink. Release unusually large heaps, retaining
		// only compiled code and the bounded numeric estimates cached by the caller.
		if (instance.memory.buffer.byteLength > 32 * 1024 * 1024) decoder = undefined;
	}
}

/** Decode using the same image-rs release as Codex; never access the network. */
export function decodeOriginalImageBytes(url: string, platform: string = process.platform): number | undefined {
	return decodeMedia(url, "image_bytes", platform === "darwin" ? 1 : platform === "win32" ? 2 : 0);
}

/** Match hook XML using the exact quick-xml version used by Codex. */
export function isHookPrompt(text: string): boolean {
	return decodeMedia(text, "context_hook") === 1;
}

/** Validate Codex's serialized inter-agent communication, including paths. */
export function isInterAgentCommunication(text: string): boolean {
	return decodeMedia(text, "context_inter_agent") === 1;
}

/** Read duration using Codex's Symphonia release and demuxer features. */
export function decodeAudioDuration(url: string): number | undefined {
	return decodeMedia(url, "audio_duration");
}
