import assert from "node:assert/strict";
import { test } from "vitest";
import { ToolRenderCache } from "../src/render-cache.js";

test("render layouts share one byte budget and evict the least recently used entry", () => {
  const cache = new ToolRenderCache({ layoutBytes: 1000 });
  const firstRow = cache.scope();
  const secondRow = cache.scope();
  let computations = 0;
  const compute = () => { computations++; return ["x".repeat(100)]; };
  firstRow.lines("a", compute);
  secondRow.lines("b", compute);
  firstRow.lines("a", compute);
  secondRow.lines("c", compute);
  assert.equal(computations, 3);
  firstRow.lines("a", compute);
  assert.equal(computations, 3);
  secondRow.lines("b", compute);
  assert.equal(computations, 4);
  assert.ok(cache.stats().layouts.chargedBytes <= 1000);
  assert.equal(cache.stats().layouts.entries, 2);
});

test("invalid budgets cannot silently disable the memory bound and zero disables retention", () => {
  for (const budget of [NaN, Infinity, -Infinity, -1]) {
    assert.throws(() => new ToolRenderCache({ layoutBytes: budget }), RangeError);
    assert.throws(() => new ToolRenderCache({ countBytes: budget }), RangeError);
  }
  const cache = new ToolRenderCache({ layoutBytes: 0, countBytes: 0 });
  const scope = cache.scope();
  assert.deepEqual(scope.lines("key", () => ["visible output"]), ["visible output"]);
  assert.equal(scope.count("key", () => 3), 3);
  assert.equal(cache.stats().layouts.chargedBytes + cache.stats().counts.chargedBytes, 0);
});

test("clearing a session prevents old rows from repopulating the new cache", () => {
  const cache = new ToolRenderCache();
  const old = cache.scope();
  old.lines("old", () => ["old session"]);
  cache.clear();
  assert.deepEqual(old.lines("late", () => ["late result"]), ["late result"]);
  assert.equal(cache.stats().layouts.entries, 0);
  cache.scope().lines("new", () => ["new session"]);
  assert.equal(cache.stats().layouts.entries, 1);
});

test("highlight prefixes grow on demand without recounting or retaining oversized arrays", () => {
  const cache = new ToolRenderCache({ layoutBytes: 1000 });
  const scope = cache.scope();
  let calls = 0;
  const compute = (index: number) => { calls++; return `line ${index}`; };
  assert.equal(scope.prefix("syntax", 3, compute).length, 3);
  assert.equal(scope.prefix("syntax", 6, compute).length, 6);
  assert.equal(calls, 6);
  assert.deepEqual(scope.prefix("syntax", 2, compute).slice(0, 2), ["line 0", "line 1"]);
  assert.equal(calls, 6);
  assert.equal(cache.stats().layouts.entries, 1);
  scope.prefix("syntax", 100, compute);
  assert.equal(calls, 100);
  assert.equal(scope.prefix("syntax", 6, compute).length, 6);
  assert.equal(calls, 100);
  assert.ok(cache.stats().layouts.chargedBytes <= 1000);
});

test("visual counts charge source keys and preserve zero without retaining oversized keys", () => {
  const cache = new ToolRenderCache({ countBytes: 400 });
  const scope = cache.scope();
  let calls = 0;
  const compute = () => { calls++; return 0; };
  assert.equal(scope.count("line", compute), 0);
  assert.equal(scope.count("line", compute), 0);
  assert.equal(calls, 1);
  scope.count("x".repeat(200), compute);
  scope.count("x".repeat(200), compute);
  assert.equal(calls, 3);
  assert.equal(cache.stats().counts.entries, 1);
  assert.ok(cache.stats().counts.chargedBytes <= 400);
  cache.clear();
  scope.count("late", compute);
  assert.equal(cache.stats().counts.entries, 0);
});
