import assert from "node:assert/strict";
import { test } from "vitest";
import { currentOperation, withOperation } from "../src/operation.js";

test("cleanup failure preserves the original operation error", async () => {
  const original = new Error("Original delivery failure");
  await assert.rejects(withOperation(1_000, undefined, async () => {
    currentOperation()!.trackResource(new Promise(() => {}));
    throw original;
  }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, original);
    assert.equal(error.errors[0], original);
    assert.match(String(error.errors[1]), /cleanup could not be confirmed/u);
    return true;
  });
});
