import assert from "node:assert/strict";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { test, vi } from "vitest";
import { Check } from "typebox/value";

import { registerSubagentTools } from "../src/tools.js";

const expectedNames = [
  "subagent_spawn",
  "subagent_prompt",
  "subagent_list",
  "subagent_read",
  "subagent_wait",
  "subagent_close",
];

test("registers the fixed public subagent tool surface", () => {
  const registered = registerTools();

  assert.deepEqual(registered.map((tool) => tool.name), expectedNames);
  for (const tool of registered) {
    assert.equal(tool.renderShell, "self");
    assert.equal(typeof tool.description, "string");
    assert.match(String(tool.description), /[\u3400-\u9fff]/u);
    assert.equal(typeof tool.promptSnippet, "string");
    assert.ok(Array.isArray(tool.promptGuidelines));
    assert.ok((tool.promptGuidelines as unknown[]).length > 0);
  }
});

test("publishes explicit object roots for provider tool schemas", () => {
  for (const tool of registerTools()) {
    const schema = JSON.parse(JSON.stringify(tool.parameters));
    assert.equal(schema.type, "object", `${tool.name} must declare an object root`);
  }
});

test("removes resumable and recursive cleanup semantics from the public contract", () => {
  const registered = registerTools();
  const contractText = registered.flatMap((tool) => [
    tool.name,
    tool.label,
    tool.description,
    tool.promptSnippet,
    ...(Array.isArray(tool.promptGuidelines) ? tool.promptGuidelines : []),
  ]).join("\n");

  assert.doesNotMatch(contractText, /resume|forget|递归|直接 child|直接 subagent|可用容量/iu);
});

test("uses strict read view variants with lightweight recent defaults", () => {
  const registered = registerTools();
  const read = registered.find((tool) => tool.name === "subagent_read");
  assert.ok(read);
  assert.equal(typeof read.prepareArguments, "function");

  const prepareArguments = read.prepareArguments as (args: unknown) => unknown;
  const defaultArgs = prepareArguments({ agentId: "child-a" });
  assert.deepEqual(defaultArgs, { agentId: "child-a", view: "recent_activity" });
  assert.equal(Check(read.parameters as never, defaultArgs), true);
  assert.equal(Check(read.parameters as never, {
    agentId: "child-a",
    view: "recent_activity",
    assistantLimit: 10,
    toolLimit: 20,
    after: "cursor-a",
  }), true);
  assert.equal(Check(read.parameters as never, {
    agentId: "child-a",
    view: "turns",
    limit: 20,
    after: "cursor-a",
  }), true);
  assert.equal(Check(read.parameters as never, {
    agentId: "child-a",
    view: "activity_detail",
    activityId: "call-a",
    section: "tool_result",
    detailCursor: "detail-a",
  }), true);
  assert.equal(Check(read.parameters as never, {
    agentId: "child-a",
    view: "recent_activity",
    limit: 20,
  }), false);
  assert.equal(Check(read.parameters as never, {
    agentId: "child-a",
    view: "activity_detail",
    assistantLimit: 1,
    activityId: "call-a",
    section: "tool_result",
  }), false);
  assert.equal(Check(read.parameters as never, {
    agentId: "child-a",
    view: "all_entries",
  }), false);
  assert.equal(Check(read.parameters as never, {
    agentId: "child-a", view: "turns", pageCursor: "page-a",
  }), true);
  for (const section of ["user_text", "assistant_error"]) {
    assert.equal(Check(read.parameters as never, {
      agentId: "child-a", view: "activity_detail", activityId: "entry-a", section,
    }), true);
  }

  const variants = (read.parameters as { anyOf: Array<Record<string, any>> }).anyOf;
  const recent = variants.find((variant) => (
    variant.properties.view.const === "recent_activity"
  ));
  assert.ok(recent);
  assert.equal(recent.properties.assistantLimit.default, 1);
  assert.equal(recent.properties.assistantLimit.maximum, 10);
  assert.equal(recent.properties.toolLimit.default, 1);
  assert.equal(recent.properties.toolLimit.maximum, 20);
});

test("preserves read defaults, limits and cursors through preparation and execution", async () => {
  const cases = [
    { input: {}, options: { view: "recent_activity" } },
    {
      input: { view: "recent_activity", assistantLimit: 1, toolLimit: 1 },
      options: { view: "recent_activity", assistantLimit: 1, toolLimit: 1 },
    },
    {
      input: { view: "recent_activity", assistantLimit: 10, toolLimit: 20, after: "cursor-a" },
      options: { view: "recent_activity", assistantLimit: 10, toolLimit: 20, after: "cursor-a" },
    },
    {
      input: { view: "recent_activity", assistantLimit: "2" },
      options: { view: "recent_activity", assistantLimit: 2 },
    },
    { input: { view: "turns" }, options: { view: "turns" } },
    { input: { view: "turns", limit: 1 }, options: { view: "turns", limit: 1 } },
    {
      input: { view: "turns", limit: 200, after: "cursor-a", pageCursor: "page-a" },
      options: { view: "turns", limit: 200, after: "cursor-a", pageCursor: "page-a" },
    },
    {
      input: { view: "activity_detail", activityId: "entry-a", section: "tool_result" },
      options: { view: "activity_detail", activityId: "entry-a", section: "tool_result" },
    },
    ...["assistant_text", "assistant_error", "user_text", "tool_arguments", "tool_result"].map((section) => ({
      input: { view: "activity_detail", activityId: "entry-a", section, detailCursor: "detail-a" },
      options: { view: "activity_detail", activityId: "entry-a", section, detailCursor: "detail-a" },
    })),
  ];
  for (const { input, options } of cases) {
    const payload = options.view === "recent_activity"
      ? { view: options.view, activity: [], cursor: "next-activity", hasMore: false, returnedBytes: 0 }
      : options.view === "turns"
        ? { view: options.view, turns: [], cursor: "next-activity", hasMore: true, nextPageCursor: "next-page" }
        : {
            view: options.view,
            activityId: "entry-a",
            section: "section" in options ? options.section : undefined,
            content: "Detail",
            originalBytes: 20,
            returnedBytes: 6,
            truncated: true,
            hasMore: true,
            nextDetailCursor: "next-detail",
          };
    const readMock = vi.fn().mockResolvedValue(payload);
    const read = registerTools({ read: readMock }).find((tool) => tool.name === "subagent_read")!;
    const result = await executeRead(read, { agentId: "child-a", ...input });
    assert.deepEqual(readMock.mock.calls, [["parent-a", "child-a", options, undefined]]);
    assert.equal(result.content[0].text, JSON.stringify(payload));
  }
});

test("rejects invalid read arguments before manager access", async () => {
  const readMock = vi.fn();
  const read = registerTools({ read: readMock }).find((tool) => tool.name === "subagent_read")!;
  const recent = { agentId: "child-a", view: "recent_activity" };
  const turns = { agentId: "child-a", view: "turns" };
  const detail = { agentId: "child-a", view: "activity_detail", activityId: "entry-a", section: "tool_result" };
  const inputs: unknown[] = [
    undefined, null, [], "input", 1, false, {},
    { view: "recent_activity" }, { ...recent, agentId: "" }, { ...recent, agentId: null },
    { ...recent, view: "all_entries" }, { ...recent, view: null },
    { agentId: "child-a", view: "activity_detail", activityId: "entry-a" },
    { agentId: "child-a", view: "activity_detail", section: "tool_result" },
    { ...detail, section: "unknown" },
  ];
  for (const base of [recent, turns, detail]) inputs.push({ ...base, unknown: true });
  const fieldValues = {
    assistantLimit: 1, toolLimit: 1, limit: 20, after: "cursor-a", pageCursor: "page-a",
    activityId: "entry-a", section: "tool_result", detailCursor: "detail-a",
  };
  for (const [base, fields] of [
    [recent, ["limit", "pageCursor", "activityId", "section", "detailCursor"]],
    [turns, ["assistantLimit", "toolLimit", "activityId", "section", "detailCursor"]],
    [detail, ["assistantLimit", "toolLimit", "limit", "after", "pageCursor"]],
  ] as const) {
    for (const field of fields) inputs.push({ ...base, [field]: fieldValues[field] });
  }
  for (const [base, field, maximum] of [
    [recent, "assistantLimit", 10], [recent, "toolLimit", 20], [turns, "limit", 200],
  ] as const) {
    for (const value of [-1, 0, maximum + 1, 1.5, null, "invalid"]) inputs.push({ ...base, [field]: value });
  }
  for (const [base, field] of [
    [recent, "after"], [turns, "after"], [turns, "pageCursor"],
    [detail, "activityId"], [detail, "section"], [detail, "detailCursor"],
  ] as const) {
    for (const value of ["", null]) inputs.push({ ...base, [field]: value });
  }
  for (const input of inputs) {
    await assert.rejects(executeRead(read, input), /Validation failed for tool "subagent_read"/u, JSON.stringify(input));
    assert.equal(readMock.mock.calls.length, 0);
  }
});

test("forwards turns continuation separately from the incremental cursor", async () => {
  const payload = { view: "turns", turns: [], warnings: [], cursor: "incremental", position: 3,
    hasMore: true, nextPageCursor: "next-page", returnedBytes: 200, omittedTurns: 0 };
  const readMock = vi.fn().mockResolvedValue(payload);
  const read = registerTools({ read: readMock }).find((tool) => tool.name === "subagent_read")!;
  const result = await (read.execute as (...args: any[]) => Promise<any>)("call", {
    agentId: "child-a", view: "turns", pageCursor: "page-a",
  }, undefined, undefined, { sessionManager: { getSessionFile: () => "parent.jsonl", getSessionId: () => "parent" } });
  assert.deepEqual(readMock.mock.calls[0]?.[2], { view: "turns", pageCursor: "page-a" });
  assert.equal(result.details.hasMore, true);
  assert.equal(result.details.nextPageCursor, "next-page");
  assert.equal(result.content[0].text, JSON.stringify(payload));
});

test("serializes recent activity exactly once without expanding the byte budget", async () => {
  let returnedBytes = 0;
  let payload: Record<string, unknown>;
  do {
    payload = {
      view: "recent_activity",
      activity: [{
        kind: "assistant",
        id: "assistant-a",
        timestamp: "2026-08-27T02:00:01.000Z",
        text: "Conclusion",
        stopReason: "stop",
        truncated: false,
      }],
      assistantCount: 1,
      toolCount: 0,
      omittedAssistant: 0,
      omittedTools: 0,
      hasMore: false,
      returnedBytes,
      warnings: [],
      cursor: "cursor-a",
      position: 2,
    };
    const next = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (next === returnedBytes) break;
    returnedBytes = next;
  } while (true);

  const registered = registerTools({
    read: vi.fn().mockResolvedValue(payload),
  });
  const read = registered.find((tool) => tool.name === "subagent_read");
  assert.ok(read);
  const result = await (read.execute as (...args: any[]) => Promise<any>)(
    "call-a",
    { agentId: "child-a", view: "recent_activity" },
    new AbortController().signal,
    undefined,
    {
      sessionManager: {
        getSessionFile: () => "/sessions/parent-a.jsonl",
        getSessionId: () => "parent-a",
      },
    },
  );

  assert.equal(result.content[0].text, JSON.stringify(payload));
  assert.equal(Buffer.byteLength(result.content[0].text, "utf8"), returnedBytes);
  assert.deepEqual(result.details.activity, payload.activity);
  assert.equal(result.details.omittedAssistant, 0);
  assert.equal(result.details.omittedTools, 0);
  assert.equal(result.details.returnedBytes, returnedBytes);
  assert.equal(result.details.truncated, false);
  assert.equal(result.details.hasMore, false);
});

test("reports turns summary metrics without duplicating turn activity in renderer details", async () => {
  const turnsResult = {
    view: "turns",
    turns: [{
      id: "user-a",
      user: {
        id: "user-a",
        timestamp: "2026-08-27T02:00:00.000Z",
        text: "Inspect",
      },
      activity: [
        {
          kind: "tool",
          id: "call-a",
          timestamp: "2026-08-27T02:00:01.000Z",
          toolName: "read",
          outcome: "succeeded",
          detailRef: { activityId: "call-a", sections: ["tool_arguments", "tool_result"] },
        },
        {
          kind: "assistant",
          id: "assistant-a",
          timestamp: "2026-08-27T02:00:02.000Z",
          text: "Done",
          stopReason: "stop",
          truncated: false,
        },
      ],
    }],
    warnings: [],
    cursor: "cursor-a",
    position: 3,
  };
  const registered = registerTools({
    read: vi.fn().mockResolvedValue(turnsResult),
  });
  const read = registered.find((tool) => tool.name === "subagent_read");
  assert.ok(read);
  const result = await (read.execute as (...args: any[]) => Promise<any>)(
    "call-a",
    { agentId: "child-a", view: "turns" },
    new AbortController().signal,
    undefined,
    {
      sessionManager: {
        getSessionFile: () => "/sessions/parent-a.jsonl",
        getSessionId: () => "parent-a",
      },
    },
  );

  assert.equal(result.details.assistantCount, 1);
  assert.equal(result.details.toolCount, 1);
  assert.equal(result.details.returnedBytes, Buffer.byteLength(result.content[0].text, "utf8"));
  assert.equal(result.details.truncated, false);
  assert.deepEqual(result.details.activity, []);
});

test("returns one bounded detail page without duplicating it in renderer details", async () => {
  const detailResult = {
    view: "activity_detail",
    activityId: "call-a",
    section: "tool_result",
    content: "SECRET_DETAIL_PAGE",
    originalBytes: 40_000,
    returnedBytes: 16_384,
    truncated: true,
    hasMore: true,
    nextDetailCursor: "detail-next",
  };
  const readMock = vi.fn().mockResolvedValue(detailResult);
  const registered = registerTools({ read: readMock });
  const read = registered.find((tool) => tool.name === "subagent_read");
  assert.ok(read);
  const result = await (read.execute as (...args: any[]) => Promise<any>)(
    "call-a",
    {
      agentId: "child-a",
      view: "activity_detail",
      activityId: "call-a",
      section: "tool_result",
    },
    new AbortController().signal,
    undefined,
    {
      sessionManager: {
        getSessionFile: () => "/sessions/parent-a.jsonl",
        getSessionId: () => "parent-a",
      },
    },
  );

  assert.deepEqual(readMock.mock.calls[0]?.[2], {
    view: "activity_detail",
    activityId: "call-a",
    section: "tool_result",
  });
  assert.deepEqual(JSON.parse(result.content[0].text), detailResult);
  assert.equal(result.details.activityId, "call-a");
  assert.equal(result.details.section, "tool_result");
  assert.equal(result.details.originalBytes, 40_000);
  assert.equal(result.details.returnedBytes, 16_384);
  assert.equal(result.details.truncated, true);
  assert.equal(result.details.hasMore, true);
  assert.equal(result.details.nextDetailCursor, "detail-next");
  assert.doesNotMatch(JSON.stringify(result.details), /SECRET_DETAIL_PAGE/u);
});

test("carries lightweight summary metrics through subagent_wait", async () => {
  const waitResult = {
    outcome: "settled",
    generation: 2,
    durationMs: 25,
    settledCursor: "settled-a",
    agent: {
      agentId: "child-a",
      name: "Lin",
      status: "settled",
      generation: 2,
      settledGeneration: 2,
      settledCursor: "settled-a",
      sessionFile: "/sessions/child-a.jsonl",
    },
    activity: [{
      kind: "tool",
      id: "call-a",
      timestamp: "2026-08-27T02:00:01.000Z",
      toolName: "bash",
      outcome: "failed",
      errorPreview: "exit 1",
      detailRef: { activityId: "call-a", sections: ["tool_arguments", "tool_result"] },
    }],
    activityCursor: "activity-a",
    assistantCount: 0,
    toolCount: 1,
    omittedAssistant: 2,
    omittedTools: 3,
    hasMore: true,
    returnedBytes: 512,
  };
  const registered = registerTools({
    wait: vi.fn().mockResolvedValue(waitResult),
  });
  const wait = registered.find((tool) => tool.name === "subagent_wait");
  assert.ok(wait);
  const result = await (wait.execute as (...args: any[]) => Promise<any>)(
    "call-a",
    { agentId: "child-a", afterSettled: "settled-before" },
    new AbortController().signal,
    undefined,
    {
      sessionManager: {
        getSessionFile: () => "/sessions/parent-a.jsonl",
        getSessionId: () => "parent-a",
      },
    },
  );

  assert.equal(result.details.omittedAssistant, 2);
  assert.equal(result.details.omittedTools, 3);
  assert.equal(result.details.returnedBytes, 512);
  assert.equal(result.details.hasMore, true);
  assert.equal(result.details.truncated, false);
  assert.deepEqual(result.details.activity, [{
    kind: "tool",
    id: "call-a",
    timestamp: "2026-08-27T02:00:01.000Z",
    toolName: "bash",
    outcome: "failed",
    errorPreview: "exit 1",
  }]);
  assert.doesNotMatch(result.content[0].text, /"arguments":|"result":|tool result payload/iu);
});

test("returns capacity and terminal cleanup boundaries in tool payloads", async () => {
  const capacity = { active: 1, pending: 1, limit: 3, available: 1 };
  const agent = {
    agentId: "child-a",
    name: "Lin",
    status: "running",
    generation: 1,
    settledGeneration: 0,
    settledCursor: "cursor-a",
    sessionFile: "/sessions/child-a.jsonl",
  };
  const registered = registerTools({
    list: vi.fn().mockResolvedValue({ agents: [agent], capacity }),
    close: vi.fn().mockResolvedValue([{ ...agent, status: "closed" }]),
  });
  const tools = new Map(registered.map((tool) => [tool.name, tool]));
  const ctx = {
    sessionManager: {
      getSessionFile: () => "/sessions/parent-a.jsonl",
      getSessionId: () => "parent-a",
    },
  };
  const execute = async (name: string, params: Record<string, unknown>) => {
    const tool = tools.get(name);
    assert.ok(tool);
    return (tool.execute as (...args: any[]) => Promise<any>)(
      "call-a",
      params,
      new AbortController().signal,
      undefined,
      ctx,
    );
  };

  const listed = await execute("subagent_list", {});
  assert.deepEqual(JSON.parse(listed.content[0].text), { agents: [agent], capacity });
  assert.deepEqual(listed.details.capacity, capacity);

  const closed = await execute("subagent_close", { target: "child-a" });
  assert.deepEqual(JSON.parse(closed.content[0].text), {
    affected: [{ ...agent, status: "closed" }],
    relationshipRemoved: true,
    extensionDataRemoved: true,
    piSessionRetained: true,
  });
  assert.equal(closed.details.relationshipRemoved, true);
  assert.equal(closed.details.extensionDataRemoved, true);
  assert.equal(closed.details.piSessionRetained, true);
});

test("defaults subagent_prompt execution to follow_up", async () => {
  const agent = {
    agentId: "child-a",
    name: "Lin",
    status: "settled",
    generation: 1,
    settledGeneration: 1,
    settledCursor: "settled-a",
    sessionFile: "/sessions/child-a.jsonl",
  };
  const promptMock = vi.fn().mockResolvedValue({
    agent,
    deliveryId: "123456789abc",
    confirmation: "follow_up_queue",
  });
  const registered = registerTools({ prompt: promptMock });
  const prompt = registered.find((tool) => tool.name === "subagent_prompt");
  assert.ok(prompt);

  const result = await (prompt.execute as (...args: any[]) => Promise<any>)(
    "call-a",
    { agentId: "child-a", text: "Continue" },
    new AbortController().signal,
    undefined,
    {
      sessionManager: {
        getSessionFile: () => "/sessions/parent-a.jsonl",
        getSessionId: () => "parent-a",
      },
    },
  );

  assert.deepEqual(promptMock.mock.calls[0]?.slice(0, 4), [
    "parent-a",
    "child-a",
    "Continue",
    "follow_up",
  ]);
  assert.deepEqual(JSON.parse(result.content[0].text), {
    agent,
    delivery: "follow_up",
    deliveryId: "123456789abc",
    confirmation: "follow_up_queue",
  });
  assert.equal(result.details.prompt, "Continue");
  assert.equal(result.content[0].text.includes("[subagent:"), false);
});

test("encodes reuse, delivery, observation, wait, and close boundaries", () => {
  const registered = registerTools();
  const tools = new Map(registered.map((tool) => [tool.name, tool]));
  const spawn = tools.get("subagent_spawn");
  const list = tools.get("subagent_list");
  const prompt = tools.get("subagent_prompt");
  const read = tools.get("subagent_read");
  const wait = tools.get("subagent_wait");
  const close = tools.get("subagent_close");
  assert.ok(spawn);
  assert.ok(list);
  assert.ok(prompt);
  assert.ok(read);
  assert.ok(wait);
  assert.ok(close);

  assert.deepEqual(spawn.promptGuidelines, [
    "调用 subagent_spawn 前优先通过 subagent_prompt 复用能够承接任务的已有 subagent，尤其是已掌握相关代码、文档或决策上下文的对象。已有信息不足以判断可复用对象或剩余容量时，先调用 subagent_list。",
    "仅在没有合适的可复用对象，且任务边界和验收条件明确时调用 subagent_spawn。",
  ]);
  assert.deepEqual(list.promptGuidelines, [
    "需要查找可复用的 subagent，或已有信息不足以判断状态和剩余容量时使用 subagent_list。不要通过反复调用 subagent_list 等待任务完成；需要等待时使用 subagent_wait。",
  ]);
  assert.deepEqual(prompt.promptGuidelines, [
    "使用 subagent_prompt 补充任务时，说明目标、范围和验收条件，并交代相对上一轮发生的变化。",
    "调用 subagent_prompt 时，新信息使当前路线失效，或继续执行可能造成错误或风险时，使用 steer；无需打断当前工作的任务和补充信息使用 follow_up。",
    "subagent_prompt 投递成功不代表任务完成。需要等待本次任务结果时，使用本次返回的 agent.settledCursor 调用 subagent_wait。",
  ]);
  const deliverySchema = (prompt.parameters as {
    properties: { delivery: Record<string, unknown> };
  }).properties.delivery;
  assert.equal(deliverySchema.default, "follow_up");

  assert.deepEqual(read.promptGuidelines, [
    "使用 subagent_read 查看进度或获取近期结果时选择 recent_activity；按对话轮次重建上下文时选择 turns；读取单条活动的原始内容时选择 activity_detail，并按需分页。",
    "使用 subagent_read 常规增量读取时，将上次返回的 cursor 作为 after。若需补取 recent_activity 本次省略的条目，应复用本次调用传入的 after，并提高 assistantLimit 或 toolLimit；本次返回的 cursor 已越过这些条目。",
    "subagent_read 的 turns 每页完整 JSON 不超过 72 KiB；hasMore 和 nextPageCursor 表示当前快照尚有续页，续读使用 pageCursor。continued 表示同一 turn 的后续活动，user 摘要会重复用于定位，activity 不重复。limit 仍选择最近的 user turn 窗口，omittedTurns 是更早被省略的 turn 数，补取它们需复用原 after 并提高 limit。user 或 assistant 摘要截断时通过 detailRef 分页取回原文。",
    "按任务需要继续调用 subagent_read，不必仅因 hasMore 为 true 就读完全部活动。需要等待新结果时使用 subagent_wait，避免反复读取空结果。",
  ]);
  assert.equal(
    wait.description,
    "阻塞等待当前 session 管理的 subagent 在 afterSettled 之后产生新的 agent_settled。outcome 为 settled 时附带近期活动；timeout、closed 和 interrupted 不表示产生了新的 settled 事件。",
  );
  assert.equal(wait.promptSnippet, "主任务依赖结果时，等待 subagent 产生新的 settled 事件。");
  assert.deepEqual(wait.promptGuidelines, [
    "下一步依赖 subagent 的结果且暂无其他可推进工作时使用 subagent_wait；仅查看当前进度时使用 subagent_read。",
    "调用 subagent_wait 时，afterSettled 使用启动目标轮次的 subagent_spawn 或 subagent_prompt 返回的 agent.settledCursor。timeout 后继续等待同一轮次时，复用该值。",
    "subagent_wait 返回 outcome 为 settled 只表示该轮运行已结束，不代表任务成功或通过验收。读取返回活动，确认任务结果后再决定继续、补充任务或关闭。",
  ]);
  assert.deepEqual(close.promptGuidelines, [
    "由主 agent 根据后续任务需要决定是否调用 subagent_close，无需向用户确认；用户明确要求保留时除外。",
    "任务结束不代表应立即调用 subagent_close。仍需追问、验收或复用上下文时保留；确认不再需要，或容量不足且有可释放的 subagent 时关闭。",
    "调用 subagent_close 后无法继续通过 subagent 工具访问。关闭前应读取所需结果，并记录后续工作需要的信息。",
  ]);

  const timeoutSchema = (wait.parameters as {
    properties: { timeoutMs: Record<string, unknown> };
  }).properties.timeoutMs;
  assert.equal(timeoutSchema.description, "本次调用最多等待的毫秒数；默认 30000，最大 600000。");
  assert.equal(timeoutSchema.default, 30_000);
  assert.equal(timeoutSchema.maximum, 600_000);
});

async function executeRead(tool: Record<string, unknown>, input: unknown) {
  const prepare = tool.prepareArguments as (args: unknown) => Record<string, unknown>;
  const params = validateToolArguments(tool as never, {
    type: "toolCall", id: "call-a", name: "subagent_read", arguments: prepare(input),
  });
  return (tool.execute as (...args: any[]) => Promise<any>)("call-a", params, undefined, undefined, {
    sessionManager: { getSessionFile: () => "parent.jsonl", getSessionId: () => "parent-a" },
  });
}

function registerTools(
  managerOverrides: Record<string, unknown> = {},
): Array<Record<string, unknown>> {
  const registered: Array<Record<string, unknown>> = [];
  const pi = {
    registerTool(tool: Record<string, unknown>) {
      registered.push(tool);
    },
  };
  const manager = {
    spawn: vi.fn(),
    prompt: vi.fn(),
    list: vi.fn(),
    read: vi.fn(),
    wait: vi.fn(),
    close: vi.fn(),
    ...managerOverrides,
  };

  registerSubagentTools(pi as never, manager as never);
  return registered;
}
