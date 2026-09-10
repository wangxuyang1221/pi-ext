import { expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ChildUsageReporter, assignUsage } from "../src/usage.js";

it("matches root normalization for cache writes and rejects invalid or overflowing counts", async () => {
  const { goalTokens } = await import("../../goal/src/accounting.js");
  const root = await mkdtemp(resolve(".subagent-test-"));
  try {
    const reporter = new ChildUsageReporter(root);
    const values = [
      { input: 50, cacheRead: 20, cacheWrite: 30, output: 10, reasoning: 8 },
      { input: 3, output: 4 }, { input: 0, output: 0, cacheRead: 20 },
      { input: 0, output: 0, cacheWrite: 10 },
      undefined, {}, { input: -1, output: 2 }, { input: 1.5, output: 2 },
      { input: 1, output: NaN }, { input: Infinity, output: 1 },
      { input: 1, output: 1, cacheWrite: -1 }, { input: 1, output: 1, cacheWrite: "3" },
      { input: 1, output: 1, cacheWrite: null }, { input: Number.MAX_SAFE_INTEGER, output: 1 },
      { input: Number.MAX_SAFE_INTEGER, output: 0, cacheWrite: 1 },
      ...[-1, 1.5, NaN, Infinity, "3", null].map(cacheRead => ({ input: 0, output: 0, cacheRead })),
    ];
    for (const [index, usage] of values.entries()) {
      const source = `source-${index}`;
      await reporter.record(source, `receipt-${index}`, usage);
      await reporter.record(source, `receipt-${index}`, usage);
      const saved = JSON.parse(await readFile(join(root, `${source}.json`), "utf8"));
      expect(saved.tokens).toBe(goalTokens(usage) ?? 0);
      expect(saved.missing).toBe(goalTokens(usage) === undefined);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("retries an observed report at settlement after a transient filesystem failure", async () => {
  const root = await mkdtemp(resolve(".subagent-test-"));
  try {
    await assignUsage(root, "source");
    const reporter = new ChildUsageReporter(root);
    await mkdir(join(root, "source.json"));
    await expect(reporter.record("source", "receipt", { input: 30, output: 10 })).rejects.toThrow();
    await rm(join(root, "source.json"), { recursive: true });
    await reporter.drain();
    expect(JSON.parse(await readFile(join(root, "source.json"), "utf8")).tokens).toBe(40);
    await reporter.drain();
    expect(JSON.parse(await readFile(join(root, "source.json"), "utf8")).tokens).toBe(40);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("binds finalized usage to its captured task and persists cumulative replay protection", async () => {
  const root = await mkdtemp(resolve(".subagent-test-"));
  try {
    await assignUsage(root, "first");
    const reporter = new ChildUsageReporter(root);
    const first = await reporter.capture();
    await assignUsage(root, "second");
    await reporter.record(first, "response-a", { input: 30, output: 10, cacheRead: 90 });
    await reporter.record(first, "response-a", { input: 30, output: 10 });
    const second = await reporter.capture();
    await reporter.record(second, "response-b", { input: 7, output: 3 });
    const read = async (id: string) => JSON.parse(await readFile(join(root, `${id}.json`), "utf8"));
    expect(await read("first")).toEqual({ sourceId: "first", tokens: 40, missing: false, lastReceipt: "response-a" });
    const reopened = new ChildUsageReporter(root);
    await reopened.record(first, "response-a", { input: 30, output: 10 });
    expect((await read("first")).tokens).toBe(40);
    expect((await read("second")).tokens).toBe(10);
    await assignUsage(root, undefined);
    expect(await reporter.capture()).toBeUndefined();
    await reporter.record(undefined, "before-goal", { input: 900, output: 100 });
    await reporter.record(second, "before-goal", { input: 900, output: 100 });
    expect((await read("second")).tokens).toBe(10);
  } finally { await rm(root, { recursive: true, force: true }); }
});
