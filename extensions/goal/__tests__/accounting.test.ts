import { expect, it } from "vitest";
import { goalTokens } from "../src/accounting.js";

it.each([-1, 1.5, NaN, Infinity, "3", null])("rejects invalid cache-read metadata %s rather than treating it as verified usage", cacheRead => {
  expect(goalTokens({ input: 0, output: 0, cacheRead })).toBeUndefined();
});
it("counts cache writes but excludes cache reads and already-counted reasoning", () => {
  expect(goalTokens({ input: 50, cacheRead: 20, cacheWrite: 30, output: 10, reasoning: 8, totalTokens: 110 })).toBe(90);
});
