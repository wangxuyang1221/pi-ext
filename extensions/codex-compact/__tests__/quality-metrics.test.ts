import { expect, test } from "vitest";
import * as metrics from "../../../scripts/codex-compact-quality-metrics.mjs";

test("normalizes cache-inclusive response usage and cache-exclusive Pi usage without double counting", () => {
  expect(typeof metrics.usageCounts).toBe("function");
  const response = metrics.usageCounts({ input_tokens: 100, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 }, output_tokens: 20, total_tokens: 120 }, "responses");
  const pi = metrics.usageCounts({ input: 30, cacheRead: 60, cacheWrite: 10, output: 20, totalTokens: 120 }, "pi");
  const cli = metrics.usageCounts({ input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 10, output_tokens: 20, total_tokens: 120 }, "codex-record");
  expect(response).toEqual({ input: 100, uncachedInput: 30, cachedInput: 60, cacheWriteInput: 10, output: 20, total: 120 });
  expect(pi).toEqual(response); expect(cli).toEqual(response);
});

test("rejects invalid counts and inconsistent cache or totals instead of inventing usage", () => {
  for (const input of [undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => metrics.usageCounts({ input_tokens: input, output_tokens: 1 }, "responses")).toThrow();
  }
  expect(() => metrics.usageCounts({ input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 11 } }, "responses")).toThrow();
  expect(() => metrics.usageCounts({ input_tokens: 10, output_tokens: 1, total_tokens: 10 }, "responses")).toThrow();
  expect(() => metrics.usageCounts({ input: 10, output: 1 }, "pi")).toThrow();
  expect(() => metrics.usageCounts({}, "unknown")).toThrow();
  expect(metrics.usageCounts({ input_tokens: 0, output_tokens: 0 }, "responses").total).toBe(0);
});

test("estimates metadata cost per request with strictly greater tier boundaries", () => {
  expect(typeof metrics.estimateCost).toBe("function");
  const rates = { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25,
    tiers: [{ inputTokensAbove: 100, input: 10, output: 45, cacheRead: 1, cacheWrite: 12.5 }] };
  const low = metrics.usageCounts({ input: 30, cacheRead: 60, cacheWrite: 10, output: 20 }, "pi");
  const high = metrics.usageCounts({ input: 31, cacheRead: 60, cacheWrite: 10, output: 20 }, "pi");
  expect(metrics.estimateCost(low, rates)).toBeCloseTo(0.0008425, 12);
  expect(metrics.estimateCost(high, rates)).toBeCloseTo(0.001395, 12);
  expect(metrics.estimateCost(low, rates) * 2).toBeCloseTo(0.001685, 12);
});

test("rejects missing or invalid price metadata rather than serializing NaN as a free request", () => {
  const counts = metrics.usageCounts({ input_tokens: 10, output_tokens: 1 }, "responses");
  for (const rates of [{ input: 1 }, { input: -1, output: 1, cacheRead: 0, cacheWrite: 0 }, { input: 1, output: Infinity, cacheRead: 0, cacheWrite: 0 }, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: -1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }] }]) {
    expect(() => metrics.estimateCost(counts, rates)).toThrow();
  }
});
