import assert from "node:assert/strict";
import { test } from "vitest";

import {
  CursorError,
  decodeActivityCursor,
  decodeSettledCursor,
  encodeActivityCursor,
  encodeSettledCursor,
} from "../src/cursor.js";

test("round-trips an opaque activity cursor with all bindings", () => {
  const cursor = encodeActivityCursor({
    agentId: "agent-a",
    epoch: "epoch-a",
    view: "recent_activity",
    position: 42,
  });

  assert.doesNotMatch(cursor, /agent-a|epoch-a|recent_activity/u);
  assert.deepEqual(
    decodeActivityCursor(cursor, {
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "recent_activity",
    }),
    {
      kind: "activity",
      version: 1,
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "recent_activity",
      position: 42,
    },
  );
});

test("rejects a settled cursor from an older epoch", () => {
  const cursor = encodeSettledCursor({
    agentId: "agent-a",
    epoch: "epoch-old",
    generation: 3,
  });

  assert.throws(
    () => decodeSettledCursor(cursor, { agentId: "agent-a", epoch: "epoch-new" }),
    (error: unknown) => error instanceof CursorError && error.code === "epoch_mismatch",
  );
});
