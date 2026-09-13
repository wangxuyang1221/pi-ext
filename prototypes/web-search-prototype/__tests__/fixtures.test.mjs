import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureResult, runFixture } from "../src/fixtures.mjs";

test("playback emits ordered native updates then completes with fixture sources", async () => {
  const updates = [];
  const result = await runFixture({ outcome: "success", total: 3, stepMs: 1, onUpdate: value => updates.push(value.details.completed) });
  assert.deepEqual(updates, [0, 1, 2, 3]);
  assert.equal(result.details.status, "completed");
  assert.equal(result.details.sources.length, 11);
  assert(result.details.sources.every(source => new URL(source.url).hostname === "example.com"));
});

test("abort stops progress updates and returns interrupted state", async () => {
  const controller = new AbortController();
  const updates = [];
  const result = await runFixture({ outcome: "success", total: 5, stepMs: 1, signal: controller.signal,
    onUpdate: value => { updates.push(value.details.completed); if (value.details.completed === 1) controller.abort(); },
  });
  assert.deepEqual(updates, [0, 1]);
  assert.equal(result.details.status, "interrupted");
});

test("zero sources and partial failure are distinct from complete failure", () => {
  assert.equal(fixtureResult("empty").details.status, "completed");
  assert.deepEqual(fixtureResult("empty").details.sources, []);
  assert.equal(fixtureResult("partial").details.failed, 1);
  assert.equal(fixtureResult("partial").details.sources.length, 14);
  assert.equal(fixtureResult("error").details.status, "failed");
  assert.throws(() => fixtureResult("unknown"), /Unknown fixture/);
});
