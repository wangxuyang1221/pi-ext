import assert from "node:assert/strict";
import { test } from "vitest";

import {
  CursorError,
  decodeActivityCursor,
  decodeDetailCursor,
  decodeSettledCursor,
  encodeActivityCursor,
  encodeDetailCursor,
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

test("round-trips an opaque detail cursor with all bindings", () => {
  const cursor = encodeDetailCursor({
    agentId: "agent-a",
    epoch: "epoch-a",
    activityId: "call-a",
    section: "tool_result",
    bytePosition: 16_384,
  });

  assert.doesNotMatch(cursor, /agent-a|epoch-a|call-a|tool_result/u);
  assert.deepEqual(
    decodeDetailCursor(cursor, {
      agentId: "agent-a",
      epoch: "epoch-a",
      activityId: "call-a",
      section: "tool_result",
    }),
    {
      kind: "detail",
      version: 1,
      agentId: "agent-a",
      epoch: "epoch-a",
      activityId: "call-a",
      section: "tool_result",
      bytePosition: 16_384,
    },
  );

  assert.throws(
    () => decodeDetailCursor(cursor, {
      agentId: "agent-a",
      epoch: "epoch-a",
      activityId: "call-b",
      section: "tool_result",
    }),
    (error: unknown) => error instanceof CursorError && error.code === "cursor_mismatch",
  );
});

test("rejects removed all-entries activity cursors", () => {
  const cursor = encodeActivityCursor({
    agentId: "agent-a",
    epoch: "epoch-a",
    view: "all_entries" as never,
    position: 1,
  });

  assert.throws(
    () => decodeActivityCursor(cursor, {
      agentId: "agent-a",
      epoch: "epoch-a",
      view: "all_entries" as never,
    }),
    (error: unknown) => error instanceof CursorError && error.code === "invalid_cursor",
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
