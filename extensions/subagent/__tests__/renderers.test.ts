import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
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

  assert.equal(call.render(120).join("\n"), "󱙺 Closed Lin");
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
    stripVTControlCharacters(component.render(180).join("\n")),
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
    stripVTControlCharacters(component.render(180).join("\n")),
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
    stripVTControlCharacters(component.render(180).join("\n")),
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
  return stripVTControlCharacters(component.render(120).join("\n"));
}

test("uses call status markers independently of the agent lifecycle", () => {
  const coloredTheme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>`, bold: (text: string) => `<b>${text}</b>` };
  for (const operation of ["spawn", "prompt", "list", "read", "wait", "close"] as const) {
    for (const outcome of ["pending", "success", "error", ...(operation === "wait" ? ["timeout", "interrupted"] : [])]) {
      const state = {};
      const call = renderSubagentCall(operation, {}, coloredTheme as never, {
        state, lastComponent: undefined, isPartial: true, isError: false,
      });
      if (outcome !== "pending") renderSubagentResult(operation, {}, {
        content: [], details: { operation, ok: outcome !== "error", agent: { ...agent, status: "running" },
          ...(outcome === "timeout" || outcome === "interrupted" ? { outcome } : {}) },
      }, { expanded: false, isPartial: false }, coloredTheme as never, {
        state, lastComponent: undefined, isPartial: false, isError: outcome === "error",
      });
      const color = outcome === "error" ? "error" : outcome === "success" ? "muted" : "warning";
      assert.ok(call.render(500)[0]?.startsWith(`<${color}>󱙺</${color}>`), `${operation}/${outcome}`);
      if (outcome !== "pending" && operation !== "list") {
        assert.ok(call.render(500)[0]?.includes("<accent>Lin</accent>"), `${operation}: target is not bold`);
      }
    }
  }
});

test("preserves expanded information with body text, dim summaries and connected lines", () => {
  const coloredTheme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>`, bold: (text: string) => `<b>${text}</b>` };
  const context = { state: {}, lastComponent: undefined, isPartial: false, isError: false };
  const details: SubagentUiDetails = { operation: "read", ok: true, activity: [
    { kind: "assistant", id: "a", timestamp: "now", text: "Reviewed the renderer.", stopReason: "stop", truncated: false },
    { kind: "tool", id: "b", timestamp: "now", toolName: "Read", outcome: "succeeded" },
  ] };
  const component = renderSubagentResult("read", {}, { content: [], details }, { expanded: true, isPartial: false }, coloredTheme as never, context);
  assert.deepEqual(component.render(500), [
    '<dim>  │ </dim><dim>1 assistant · 1 tool</dim>',
    '<dim>  │ </dim><muted>assistant</muted>  <text>Reviewed the renderer.</text>',
    '<dim>  └ </dim><muted>Read</muted><dim> → </dim><text>succeeded</text>',
  ]);
  const collapsed = renderSubagentResult("read", {}, { content: [], details }, { expanded: false, isPartial: false }, coloredTheme as never, { ...context, lastComponent: component });
  assert.equal(collapsed, component);
  assert.deepEqual(collapsed.render(500), ['<dim>  └ </dim><dim>1 assistant · 1 tool</dim>']);
});

test("keeps agent success result text green while muting the call prefix", () => {
  const coloredTheme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>`, bold: (text: string) => text };
  for (const operation of ["wait", "close", "list", "spawn"] as const) {
    const details: SubagentUiDetails = { operation, ok: true, agent: { ...agent, status: "settled" }, agents: [{ ...agent, status: "settled" }], outcome: "settled" };
    const state = {};
    const context = { state, lastComponent: undefined, isPartial: false, isError: false };
    const call = renderSubagentCall(operation, {}, coloredTheme as never, context);
    for (const expanded of [false, true]) {
      const body = renderSubagentResult(operation, {}, { content: [], details }, { expanded, isPartial: false }, coloredTheme as never, context).render(500).join("\n");
      if (operation !== "spawn" || expanded) assert.ok(body.includes("\x1b[38;2;70;232;124m"), `${operation}/${expanded}`);
      assert.ok(!body.includes("<success>"), `${operation}: result must use approved green`);
      assert.ok(call.render(500)[0]?.startsWith("<muted>󱙺</muted>"));
    }
  }
});

test("truncates long names and connected results within every terminal width", async () => {
  const { visibleWidth } = await import("@earendil-works/pi-tui");
  for (const operation of ["spawn", "prompt", "list", "read", "wait", "close"] as const) {
    const longAgent = { ...agent, name: "Lin-review-rendering-界面-width-".repeat(8), status: "settled" as const };
    const details: SubagentUiDetails = { operation, ok: true, agent: longAgent, agents: [longAgent], affected: [longAgent], task: "Task ".repeat(100), prompt: "Prompt ".repeat(100), activity: [{ kind: "assistant", id: "a", timestamp: "now", text: "Text ".repeat(100), stopReason: "stop", truncated: false }] };
    for (const expanded of [false, true]) {
      const state = {};
      const context = { state, lastComponent: undefined, isPartial: false, isError: false };
      const call = renderSubagentCall(operation, {}, theme as never, context);
      const result = renderSubagentResult(operation, {}, { content: [], details }, { expanded, isPartial: false }, theme as never, context);
      for (const width of [0, 1, 2, 12, 40, 80, 120]) {
        const lines = [...call.render(width), ...result.render(width)];
        assert.ok(lines.every(line => visibleWidth(line) <= width), `${operation}/${expanded}/${width}`);
        if (width === 0) assert.deepEqual(lines, []);
      }
    }
  }
});

test("spawn titles ignore stale caller names until the allocated result arrives", () => {
  const state = {};
  const context = { state, lastComponent: undefined, isPartial: true, isError: false };
  const call = renderSubagentCall("spawn", { name: "caller-selected", task: "Task" }, theme as never, context);
  assert.doesNotMatch(call.render(120).join("\n"), /caller-selected/u);
  renderSubagentResult("spawn", {}, { content: [], details: { operation: "spawn", ok: true,
    agent: { ...agent, name: "Captain America" } } }, { isPartial: false, expanded: false }, theme as never, context);
  assert.match(call.render(120).join("\n"), /Captain America/u);
});
