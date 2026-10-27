// Node exposes these WebAssembly APIs without the browser DOM library.
export interface WasmModule {}
export interface WasmInstance { exports: Record<string, unknown> }
export const wasm = (globalThis as unknown as { WebAssembly: {
  Module: new (bytes: Uint8Array) => WasmModule;
  Instance: new (module: WasmModule) => WasmInstance;
  RuntimeError: new (message: string) => Error;
} }).WebAssembly;
