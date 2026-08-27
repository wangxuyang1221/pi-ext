import assert from "node:assert/strict";
import { test, vi } from "vitest";

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
    assert.equal((tool.promptGuidelines as unknown[]).length, 1);
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

  assert.doesNotMatch(contractText, /resume|forget|递归/iu);
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

test("encourages read-first orchestration and caps each wait at two minutes", () => {
  const registered = registerTools();
  const tools = new Map(registered.map((tool) => [tool.name, tool]));
  const spawn = tools.get("subagent_spawn");
  const read = tools.get("subagent_read");
  const wait = tools.get("subagent_wait");
  assert.ok(spawn);
  assert.ok(read);
  assert.ok(wait);

  assert.deepEqual(spawn.promptGuidelines, [
    "使用 subagent_spawn 委派边界清晰、可独立执行的任务；工具返回只表示 child 已启动。随后优先使用 subagent_read 低噪声跟踪；只有 main 的下一步依赖 child 结果时才使用 subagent_wait。",
  ]);
  assert.deepEqual(read.promptGuidelines, [
    "常规跟踪优先使用 subagent_read 的 recent_activity 和 cursor，让 main 在 child 工作时继续推进；仅在需要完整请求上下文时使用 turns，需要诊断原生记录时才使用 all_entries。",
  ]);
  assert.equal(
    wait.description,
    "阻塞等待当前 session 的一个直接 child 在指定 settled cursor 之后产生新的 agent_settled。仅当 main 的下一步依赖 child 结果时使用；成功时返回新的 settled cursor 和近期活动，关闭、中断或超时不会伪造完成。",
  );
  assert.equal(wait.promptSnippet, "等待主线所依赖的 child 稳定完成。");
  assert.deepEqual(wait.promptGuidelines, [
    "常规进度跟踪应优先使用 subagent_read；仅当下一步被 child 结果阻塞时调用 subagent_wait。传入任务开始前的 afterSettled，timeout 后可复用同一 afterSettled 再次等待；只有 outcome: \"settled\" 表示成功完成。",
  ]);

  const timeoutSchema = (wait.parameters as {
    properties: { timeoutMs: Record<string, unknown> };
  }).properties.timeoutMs;
  assert.equal(timeoutSchema.description, "单次最长等待时间（毫秒）；默认 30000，最大 120000。");
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
