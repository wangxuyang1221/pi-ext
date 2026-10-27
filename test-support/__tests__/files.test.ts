import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { writeJsonAtomic } from "../files.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

test("keeps the previous snapshot when writing the replacement fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "atomic-failure-"));
  try {
    const path = join(directory, "state.json");
    await writeJsonAtomic(path, { ready: true });
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.writeFile).mockImplementationOnce(async file => {
      await actual.writeFile(file, "{");
      throw new Error("Fixture disk failure");
    });
    await expect(writeJsonAtomic(path, { ready: false })).rejects.toThrow("Fixture disk failure");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ready: true });
    expect(await readdir(directory)).toEqual(["state.json"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("publishes complete JSON under concurrent writers and removes staging files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "atomic-fixture-"));
  try {
    const path = join(directory, "state.json");
    await writeJsonAtomic(path, { sequence: -1, data: "x".repeat(1024 * 1024) });
    let writing = true;
    const reader = (async () => {
      while (writing) expect(Number.isInteger(JSON.parse(await readFile(path, "utf8")).sequence)).toBe(true);
    })();
    try { await Promise.all(Array.from({ length: 20 }, (_, sequence) => writeJsonAtomic(path, { sequence, data: "x".repeat(1024 * 1024) }))); }
    finally { writing = false; await reader; }
    expect(await readdir(directory)).toEqual(["state.json"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
