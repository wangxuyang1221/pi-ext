import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { test, vi } from "vitest";
import { DeliveryReceiptReader } from "../src/delivery-receipt.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

test("polls only appended receipt bytes and stops opening after consumption", async () => {
  const root = await fs.mkdtemp(join(process.cwd(), ".subagent-receipt-"));
  const path = join(root, "session.jsonl");
  const expected = { agentId: "child", epoch: "epoch", deliveryId: "012345abcdef" };
  const originalOpen = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open;
  let bytes = 0, reads = 0, opens = 0;
  const spy = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const file = await originalOpen(...args);
    opens++;
    return new Proxy(file, { get(target, property) {
      if (property === "read") return async (...parameters: any[]) => {
        const result = await (target.read as any)(...parameters);
        bytes += result.bytesRead;
        reads++;
        return result;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  try {
    await fs.writeFile(path, JSON.stringify({ type: "message", content: "A".repeat(8 * 1024 * 1024) }) + "\n");
    const initialSize = (await fs.stat(path)).size;
    const reader = new DeliveryReceiptReader();
    const started = performance.now();
    assert.equal(await reader.read(path, expected), undefined);
    for (let index = 0; index < 100; index++) assert.equal(await reader.read(path, expected), undefined);
    assert.equal(bytes, initialSize);
    assert.ok(reads <= Math.ceil(initialSize / (64 * 1024)) + 101);
    const receipt = JSON.stringify({ type: "custom", customType: "subagent_delivery", data: { ...expected, generation: 2 } });
    await fs.appendFile(path, receipt.slice(0, 70));
    assert.equal(await reader.read(path, expected), undefined);
    await fs.appendFile(path, receipt.slice(70) + "\n");
    assert.equal(await reader.read(path, expected), 2);
    const opened = opens;
    for (let index = 0; index < 100; index++) assert.equal(await reader.read(path, expected), 2);
    assert.equal(opens, opened);
    assert.equal(bytes, (await fs.stat(path)).size);
    if (process.env.PI_SUBAGENT_BENCHMARK === "1") console.log(JSON.stringify({ receipt: {
      milliseconds: +(performance.now() - started).toFixed(3), bytes, reads, opens,
      pollsBeforeReceipt: 100, pollsAfterReceipt: 100, maxRssKiB: process.resourceUsage().maxRSS,
    } }));
  } finally { spy.mockRestore(); await fs.rm(root, { recursive: true, force: true }); }
});
