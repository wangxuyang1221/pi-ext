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
