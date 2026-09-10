import { expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ChildUsageReporter, assignUsage } from "../src/usage.js";

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
