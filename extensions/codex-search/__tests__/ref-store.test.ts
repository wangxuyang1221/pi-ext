import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createRefStore } from "../src/ref-store.ts";

vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await fs.mkdtemp(join(process.cwd(), ".search-refs-")); roots.push(root); return root; }

it("ignores legacy mappings, clears memory on load, and isolates concurrent sessions", async () => {
  const root = await directory();
  const legacy = join(root, "pi-codex-search-refs.json");
  await fs.writeFile(legacy, '{"urlToRefId":{"old":"turn9view0"}}');
  const a = createRefStore(), b = createRefStore();
  await Promise.all([a.load(root, "A"), b.load(root, "B")]);
  expect(a.resolveRefId("old")).toBeUndefined();
  await Promise.all([a.remember("url", "turn0view0"), b.remember("url", "turn1view0")]);
  await a.load(root, "B");
  expect(a.resolveRefId("url")).toBe("turn1view0");
  await a.load(root, "new");
  expect(a.resolveRefId("url")).toBeUndefined();
  expect(await fs.readFile(legacy, "utf8")).toBe('{"urlToRefId":{"old":"turn9view0"}}');
});

it("merges only new writes and rejects mismatched identities without retaining stale memory", async () => {
  const root = await directory();
  const a = createRefStore(), b = createRefStore();
  await a.load(root, "A"); await a.remember("url", "turn0view0");
  await b.load(root, "A");
  await a.remember("url", "turn1view0"); await b.remember("other", "turn2view0");
  await a.load(root, "A");
  expect(a.resolveRefId("url")).toBe("turn1view0");
  expect(a.resolveRefId("other")).toBe("turn2view0");
  const [file] = await fs.readdir(root);
  await fs.writeFile(join(root, file), JSON.stringify({ version: 1, sessionId: "B", urlToRefId: { url: "foreign" } }));
  await expect(a.load(root, "A")).rejects.toThrow(/identity/);
  expect(a.resolveRefId("url")).toBeUndefined();
});

it("preserves the previous file on failed atomic replacement and releases the failed queue", async () => {
  const root = await directory(), store = createRefStore();
  await store.load(root, "A"); await store.remember("url", "turn0view0");
  const [file] = await fs.readdir(root), before = await fs.readFile(join(root, file), "utf8");
  vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("Fixture rename failure"));
  await expect(store.remember("url", "turn1view0")).rejects.toThrow(/rename failure/);
  expect(await fs.readFile(join(root, file), "utf8")).toBe(before);
  expect(await fs.readdir(root)).toEqual([file]);
  await store.remember("other", "turn2view0");
  await store.load(root, "A");
  expect(store.resolveRefId("url")).toBe("turn0view0");
  expect(store.resolveRefId("other")).toBe("turn2view0");
});

it.each([1, 100])("reads only the target file with %i unrelated sessions", async count => {
  const root = await directory();
  for (let i = 0; i < count; i++) {
    const store = createRefStore(); await store.load(root, `other-${i}`); await store.remember("url", "turn0view0");
  }
  const target = createRefStore(); await target.load(root, "target"); await target.remember("url", "turn1view0");
  const reads = vi.spyOn(fs, "readFile");
  await target.load(root, "target"); await target.remember("other", "turn2view0");
  expect(reads).toHaveBeenCalledTimes(2);
  expect(new Set(reads.mock.calls.map(([path]) => String(path))).size).toBe(1);
});
