import assert from "node:assert/strict";
import { test } from "vitest";

import {
  renderSubagentCall,
  renderSubagentResult,
  type SubagentUiDetails,
} from "../src/renderers.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};
const agent = {
  agentId: "child-a",
  name: "Lin",
  status: "closed" as const,
  generation: 2,
};

test("renders empty assistant error reasons in expanded read and wait output", () => {
  for (const operation of ["read", "wait"] as const) {
    const details: SubagentUiDetails = { operation, ok: true, view: "recent_activity", activity: [{
      kind: "assistant", id: "error", timestamp: "now", text: "", stopReason: "error",
      errorMessage: "HTTP 401: invalid API key", truncated: false,
    }] };
    const component = renderSubagentResult(operation, {}, { content: [], details },
      { isPartial: false, expanded: true }, theme as never,
      { state: {}, lastComponent: undefined, isPartial: false, isError: false });
    assert.match(component.render(160).join("\n"), /HTTP 401: invalid API key/u);
  }
});

test("states the terminal close boundary in text", () => {
  const details: SubagentUiDetails = {
    operation: "close",
    ok: true,
    agent,
    affected: [agent],
    relationshipRemoved: true,
    extensionDataRemoved: true,
    piSessionRetained: true,
  };
  const state = {};
  const call = renderSubagentCall(
    "close",
    { target: "child-a" },
    theme as never,
    {
      state,
      lastComponent: undefined,
      isPartial: true,
      isError: false,
    },
  );
  const output = render(details, state);

  assert.equal(call.render(120).join("\n"), "• Closed Lin");
  assert.equal(
    output,
    "  └ Process stopped · relationship removed · Extension data deleted · Pi session retained",
  );
});

test("renders read counts, byte size, omissions, and continuation state", () => {
  const details: SubagentUiDetails = {
    operation: "read",
    ok: true,
    agent: { ...agent, status: "running" },
    view: "recent_activity",
    assistantCount: 1,
    toolCount: 2,
    omittedAssistant: 3,
    omittedTools: 4,
    returnedBytes: 72_192,
    truncated: true,
    hasMore: true,
    cursor: "cursor-a",
  };
  const component = renderSubagentResult(
    "read",
    { agentId: "child-a", view: "recent_activity" },
    { content: [{ type: "text", text: "ok" }], details },
    { isPartial: false, expanded: false },
    theme as never,
    {
      state: {},
      lastComponent: undefined,
      isPartial: false,
      isError: false,
    },
  );

  assert.equal(
    component.render(180).join("\n"),
    "  └ 1 assistant · 2 tools · 70.5 KiB · omitted 3 assistant/4 tools · truncated · has more · cursor cursor-a",
  );
});

test("renders activity detail page size and continuation cursor", () => {
  const details: SubagentUiDetails = {
    operation: "read",
    ok: true,
    agent: { ...agent, status: "running" },
    view: "activity_detail",
    activityId: "call-a",
    section: "tool_result",
    originalBytes: 40_000,
    returnedBytes: 16_384,
    truncated: true,
    hasMore: true,
    nextDetailCursor: "detail-next",
  };
  const component = renderSubagentResult(
    "read",
    { agentId: "child-a", view: "activity_detail" },
    { content: [{ type: "text", text: "bounded page" }], details },
    { isPartial: false, expanded: false },
    theme as never,
    {
      state: {},
      lastComponent: undefined,
      isPartial: false,
      isError: false,
    },
  );

  assert.equal(
    component.render(180).join("\n"),
    "  └ tool_result · 16 KiB of 39.1 KiB · truncated · has more · cursor detail-next",
  );
});

test("renders wait activity metrics without expanding activity details", () => {
  const details: SubagentUiDetails = {
    operation: "wait",
    ok: true,
    agent: { ...agent, status: "settled" },
    outcome: "settled",
    durationMs: 25,
    assistantCount: 1,
    toolCount: 2,
    omittedAssistant: 3,
    omittedTools: 4,
    returnedBytes: 512,
    truncated: true,
    hasMore: true,
  };
  const component = renderSubagentResult(
    "wait",
    { agentId: "child-a" },
    { content: [{ type: "text", text: "ok" }], details },
    { isPartial: false, expanded: false },
    theme as never,
    {
      state: {},
      lastComponent: undefined,
      isPartial: false,
      isError: false,
    },
  );

  assert.equal(
    component.render(180).join("\n"),
    "  └ Settled · generation 2 · 25ms · 1 assistant · 2 tools · 512 B · omitted 3 assistant/4 tools · truncated · has more",
  );
});

test("renders closing status and capacity in list summaries", () => {
  const details: SubagentUiDetails = {
    operation: "list",
    ok: true,
    agents: [{ ...agent, status: "closing" }],
    capacity: { active: 1, pending: 1, limit: 3, available: 1 },
  };
  const component = renderSubagentResult(
    "list",
    {},
    { content: [{ type: "text", text: "ok" }], details },
    { isPartial: false, expanded: false },
    theme as never,
    {
      state: {},
      lastComponent: undefined,
      isPartial: false,
      isError: false,
    },
  );

  assert.equal(
    component.render(120).join("\n"),
    "  └ 1 closing · 1 active · 1 pending · limit 3 · 1 available",
  );
});

function render(details: SubagentUiDetails, state: object): string {
  const component = renderSubagentResult(
    "close",
    { target: "child-a" },
    { content: [{ type: "text", text: "ok" }], details },
    { isPartial: false, expanded: false },
    theme as never,
    {
      state,
      lastComponent: undefined,
      isPartial: false,
      isError: false,
    },
  );
  return component.render(120).join("\n");
}
