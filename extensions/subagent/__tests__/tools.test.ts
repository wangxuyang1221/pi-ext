import assert from "node:assert/strict";
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
  const prompt = tools.get("subagent_prompt");
  const read = tools.get("subagent_read");
  const wait = tools.get("subagent_wait");
  const close = tools.get("subagent_close");
  assert.ok(spawn);
  assert.ok(prompt);
  assert.ok(read);
  assert.ok(wait);
  assert.ok(close);

  assert.deepEqual(spawn.promptGuidelines, [
    "调用 subagent_spawn 前先检查已有 subagent。若有 subagent 处理过相关代码、文档或决策，使用 subagent_prompt；只有没有可复用对象且任务可独立验收时，才创建新的 subagent。",
  ]);
  assert.deepEqual(prompt.promptGuidelines, [
    "新信息使当前路线失效或继续执行有风险时，使用 steer；其余提示使用 follow_up。",
  ]);
  const deliverySchema = (prompt.parameters as {
    properties: { delivery: Record<string, unknown> };
  }).properties.delivery;
  assert.equal(deliverySchema.default, "follow_up");

  assert.deepEqual(read.promptGuidelines, [
    "常规跟踪使用 subagent_read 的 recent_activity。接受本次摘要后，把返回的 cursor 作为下次 after。",
    "需要按 user prompt 重建上下文时使用 turns；摘要不足或需要原始内容时使用 activity_detail。",
    "hasMore 只表示仍有活动，按任务需要读取。补取 recent_activity 省略的条目时，复用调用前的 after，并提高 assistantLimit 或 toolLimit；返回的 cursor 已越过这些条目。",
  ]);
  assert.equal(
    wait.description,
    "阻塞等待当前 session 管理的 subagent 在 afterSettled 之后产生新的 agent_settled。outcome 为 settled 时附带近期活动；timeout、closed 和 interrupted 不表示产生了新的 settled 事件。",
  );
  assert.equal(wait.promptSnippet, "主任务依赖结果时，等待 subagent 产生新的 settled 事件。");
  assert.deepEqual(wait.promptGuidelines, [
    "主 agent 的下一步依赖 subagent 结果时使用 subagent_wait；常规进度跟踪使用 subagent_read。",
    "afterSettled 使用启动该轮任务的 subagent_spawn 或 subagent_prompt 返回的 agent.settledCursor。timeout 后复用同一个 afterSettled；只有 outcome 为 settled 才证明产生了新的 settled 事件，任务结果仍以返回的活动为准。",
  ]);
  assert.deepEqual(close.promptGuidelines, [
    "关闭前，将本轮拟关闭的全部 subagent 合并为一次确认，列出 name 和 agentId，并说明关闭后无法继续通过 subagent 工具访问。",
    "用户的同意仅覆盖确认中列出的 target。当前请求已明确要求关闭这些 target 时，可直接调用 subagent_close。",
  ]);

  const timeoutSchema = (wait.parameters as {
    properties: { timeoutMs: Record<string, unknown> };
  }).properties.timeoutMs;
  assert.equal(timeoutSchema.description, "本次调用最多等待的毫秒数；默认 30000，最大 120000。");
  assert.equal(timeoutSchema.default, 30_000);
  assert.equal(timeoutSchema.maximum, 120_000);
});

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
