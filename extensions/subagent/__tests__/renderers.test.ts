import assert from "node:assert/strict";
import { test } from "vitest";

import { renderSubagentResult, type SubagentUiDetails } from "../src/renderers.js";

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

test("states the close and forget retention boundaries in text", () => {
  const close = render("close", {
    operation: "close",
    ok: true,
    agent,
    affected: [agent],
    relationshipRetained: true,
    piSessionRetained: true,
  });
  const forget = render("forget", {
    operation: "forget",
    ok: true,
    agent,
    affected: [agent],
    relationshipRetained: false,
    extensionDataRemoved: true,
    piSessionRetained: true,
  });

  assert.match(close, /Stopped process · relationship and Pi session retained/u);
  assert.match(forget, /Detached subagent · Extension data removed · Pi sessions retained/u);
});

function render(
  kind: "close" | "forget",
  details: SubagentUiDetails,
): string {
  const component = renderSubagentResult(
    kind,
    { target: "child-a" },
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
  return component.render(120).join("\n");
}
