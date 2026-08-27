import type {
  AgentToolResult,
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";

import {
  renderSubagentCall,
  renderSubagentResult,
  type ActivityDisplay,
  type AgentDisplay,
  type SubagentToolKind,
  type SubagentUiDetails,
} from "./renderers.js";

const ROBIE_ID = "01a03c0d-3c59-7efa-ac07-bb73090daa69";
const BOB_ID = "01a03c0d-3c5d-7bda-ae45-510a0b98fb6c";
const LIN_ID = "01a03c0d-3c61-7ad5-9c2b-61fd29ea4a01";

const robie: AgentDisplay = {
  agentId: ROBIE_ID,
  name: "Robie",
  status: "running",
  generation: 2,
  model: "gpt-5.6-sol",
  thinkingLevel: "high",
  tmuxWindow: "pi-subagents:1",
  sessionFile: "~/.pi/agent/sessions/…/01a03c0d.jsonl",
};

const bob: AgentDisplay = {
  agentId: BOB_ID,
  name: "Bob",
  status: "settled",
  generation: 1,
  model: "gpt-5.6-sol",
  thinkingLevel: "medium",
  tmuxWindow: "pi-subagents:2",
};

const lin: AgentDisplay = {
  agentId: LIN_ID,
  name: "Lin",
  status: "closed",
  generation: 3,
  model: "gpt-5.6-sol",
  thinkingLevel: "high",
};

const recentActivity: ActivityDisplay[] = [
  {
    kind: "tool",
    id: "tool-001",
    timestamp: "2026-08-26T10:42:01.000Z",
    toolName: "read",
    summary: "src/runtime.ts",
    result: "184 lines",
  },
  {
    kind: "tool",
    id: "tool-002",
    timestamp: "2026-08-26T10:42:04.000Z",
    toolName: "bash",
    summary: "npm test -- runtime",
    result: "12 tests passed",
  },
  {
    kind: "assistant",
    id: "assistant-001",
    timestamp: "2026-08-26T10:42:08.000Z",
    text: "The runtime boundary is isolated; the remaining risk is stale tmux window metadata after an external kill.",
    stopReason: "toolUse",
  },
  {
    kind: "tool",
    id: "tool-003",
    timestamp: "2026-08-26T10:42:10.000Z",
    toolName: "grep",
    summary: "tmux locator writes",
    result: "4 matches",
  },
  {
    kind: "assistant",
    id: "assistant-002",
    timestamp: "2026-08-26T10:42:14.000Z",
    text: "Audit complete. Recommend validating the pane PID before every prompt and treating a mismatch as interrupted.",
    stopReason: "stop",
  },
];

const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);

const spawnParameters = Type.Object({
  task: Type.String({
    description: "交给 child 的自包含初始任务。",
    minLength: 1,
  }),
  name: Type.Optional(Type.String({
    description: "可选显示名称；省略时由 Extension 生成。",
    minLength: 1,
  })),
  cwd: Type.Optional(Type.String({
    description: "可选工作目录；默认继承当前环境。",
    minLength: 1,
  })),
  model: Type.Optional(Type.String({
    description: "可选模型覆盖；默认继承当前环境。",
    minLength: 1,
  })),
  thinkingLevel: Type.Optional(ThinkingLevelSchema),
});

const resumeParameters = Type.Object({
  agentId: Type.String({
    description: "当前 namespace 中已 close 的直接 child sessionId。",
    minLength: 1,
  }),
});

const promptParameters = Type.Object({
  agentId: Type.String({
    description: "当前 namespace 中运行中的直接 child sessionId。",
    minLength: 1,
  }),
  text: Type.String({
    description: "要投递的正常 Pi prompt。",
    minLength: 1,
  }),
  delivery: Type.Optional(Type.Union([
    Type.Literal("steer"),
    Type.Literal("follow_up"),
  ], {
    description: "投递模式；默认 steer。",
    default: "steer",
  })),
});

const listParameters = Type.Object({});

const readParameters = Type.Object({
  agentId: Type.String({
    description: "当前 namespace 中的直接 child sessionId。",
    minLength: 1,
  }),
  view: Type.Optional(Type.Union([
    Type.Literal("recent_activity"),
    Type.Literal("turns"),
    Type.Literal("all_entries"),
  ], {
    description: "读取视图；默认 recent_activity。",
    default: "recent_activity",
  })),
  assistantLimit: Type.Optional(Type.Integer({
    description: "recent_activity 中最多返回的 assistant message 数量。",
    minimum: 1,
    maximum: 50,
    default: 3,
  })),
  toolLimit: Type.Optional(Type.Integer({
    description: "recent_activity 中最多返回的 tool activity 数量。",
    minimum: 1,
    maximum: 100,
    default: 5,
  })),
  limit: Type.Optional(Type.Integer({
    description: "turns 或 all_entries 视图的最大条目数。",
    minimum: 1,
    maximum: 200,
  })),
  after: Type.Optional(Type.String({
    description: "绑定同一 agent、epoch 和 view 的 opaque activity cursor。",
    minLength: 1,
  })),
});

const waitParameters = Type.Object({
  agentId: Type.String({
    description: "当前 namespace 中的直接 child sessionId。",
    minLength: 1,
  }),
  afterSettled: Type.String({
    description: "任务开始前取得的 opaque settled cursor。",
    minLength: 1,
  }),
  timeoutMs: Type.Optional(Type.Integer({
    description: "最长等待时间（毫秒）。",
    minimum: 1,
    maximum: 600_000,
    default: 30_000,
  })),
  afterActivity: Type.Optional(Type.String({
    description: "用于附带近期活动的 opaque activity cursor。",
    minLength: 1,
  })),
  assistantLimit: Type.Optional(Type.Integer({
    description: "成功返回时最多附带的 assistant message 数量。",
    minimum: 1,
    maximum: 50,
    default: 2,
  })),
  toolLimit: Type.Optional(Type.Integer({
    description: "成功返回时最多附带的 tool activity 数量。",
    minimum: 1,
    maximum: 100,
    default: 3,
  })),
});

const targetParameters = Type.Object({
  target: Type.String({
    description: "一个直接 child agentId，或字符串 all。",
    minLength: 1,
  }),
});

export default function subagentToolUiPrototype(pi: ExtensionAPI): void {
  pi.registerTool(withRenderer("spawn", {
    name: "subagent_spawn",
    label: "Spawn subagent",
    description: "在 tmux 中启动一个普通 TUI Pi child，将其注册为当前 session 的直接 subagent，并提交初始任务。每次调用只创建一个 child；工具在 child runtime 注册成功后返回，不等待任务完成。",
    promptSnippet: "创建持久化 child Pi，异步执行独立任务。",
    promptGuidelines: ["使用 subagent_spawn 委派边界清晰、可独立执行的任务；工具返回只表示 child 已启动，随后使用 subagent_wait 或 subagent_read 跟踪执行结果。"],
    parameters: spawnParameters,
    async execute(_toolCallId, params) {
      const agent: AgentDisplay = {
        ...robie,
        name: params.name ?? "Robie",
        model: params.model ?? robie.model,
        thinkingLevel: params.thinkingLevel ?? robie.thinkingLevel,
        generation: 1,
      };
      return toolResult({
        operation: "spawn",
        ok: true,
        agent,
        task: params.task,
        message: "Child runtime registered; task completion is not implied.",
      });
    },
  }));

  pi.registerTool(withRenderer("resume", {
    name: "subagent_resume",
    label: "Resume subagent",
    description: "重新启动当前 session namespace 中一个已 close 的直接 subagent，使用其原有 Pi session 创建新的 tmux window。工具在 child runtime 重新注册后返回，不会自动发送 prompt；已被 forget 的 session 不能通过此工具恢复。",
    promptSnippet: "重新启动仍受当前 session 管理的 closed child。",
    promptGuidelines: ["仅使用 subagent_resume 恢复仍属于当前 session 的 closed child；恢复成功后，使用 subagent_prompt 提交新任务或继续指导。"],
    parameters: resumeParameters,
    async execute(_toolCallId, params) {
      return toolResult({
        operation: "resume",
        ok: true,
        agent: { ...agentFor(params.agentId), status: "running", generation: 4 },
        message: "Child runtime registered; no prompt was sent.",
      });
    },
  }));

  pi.registerTool(withRenderer("prompt", {
    name: "subagent_prompt",
    label: "Prompt subagent",
    description: "通过 tmux 向当前 session 的一个运行中直接 child 投递正常 Pi prompt。默认使用 steer，在当前 assistant turn 的工具调用结束后尽快送达；follow-up 会等待当前工作结束后再送达。返回仅表示投递成功，不表示 child 已处理或 settled。",
    promptSnippet: "向运行中的直接 child 投递 steer 或 follow-up prompt。",
    promptGuidelines: ["使用 subagent_prompt 的默认 steer 修正或补充当前工作；只有当消息应在现有工作彻底结束后执行时才选择 follow_up。closed child 必须先使用 subagent_resume。"],
    parameters: promptParameters,
    async execute(_toolCallId, params) {
      return toolResult({
        operation: "prompt",
        ok: true,
        agent: { ...agentFor(params.agentId), status: "running" },
        prompt: params.text,
        delivery: params.delivery ?? "steer",
        message: "Prompt delivered; processing and completion are not implied.",
      });
    },
  }));

  pi.registerTool(withRenderer("list", {
    name: "subagent_list",
    label: "List subagents",
    description: "列出当前 Pi session 直接管理的全部 subagent，包括 running、settled 和 closed child 的 agentId、显示名称、状态、generation 及可用的 tmux/session 定位信息。不递归列出后代，也不包含已被 forget 的普通 Pi session。",
    promptSnippet: "列出当前 session 的直接 subagent 及其状态。",
    promptGuidelines: ["使用 subagent_list 发现直接 child、取得 agentId 或检查概况；需要证明某轮工作已经完成时使用 subagent_wait，不要只依赖列表中的瞬时状态。"],
    parameters: listParameters,
    async execute() {
      return toolResult({
        operation: "list",
        ok: true,
        agents: [robie, bob, lin],
      });
    },
  }));

  pi.registerTool(withRenderer("read", {
    name: "subagent_read",
    label: "Read subagent activity",
    description: "从当前 session 的一个直接 child 的原生 Pi session JSONL 中读取结构化、只读的 finalized 活动。默认返回有界的 recent activity；也可按 user turn 读取，或在诊断时读取原生 all entries。运行中的未完成 token 或工具增量不会返回。",
    promptSnippet: "低噪声读取 child 的 assistant message 和工具历史。",
    promptGuidelines: ["优先使用 subagent_read 的 recent_activity 和 cursor 获取少量新增内容；仅在需要完整请求上下文时使用 turns，需要检查分支或原生记录时才使用 all_entries。"],
    parameters: readParameters,
    async execute(_toolCallId, params) {
      const assistantLimit = params.assistantLimit ?? 3;
      const toolLimit = params.toolLimit ?? 5;
      const activity = takeRecentActivity(recentActivity, assistantLimit, toolLimit);
      return toolResult({
        operation: "read",
        ok: true,
        agent: agentFor(params.agentId),
        view: params.view ?? "recent_activity",
        assistantCount: activity.filter((item) => item.kind === "assistant").length,
        toolCount: activity.filter((item) => item.kind === "tool").length,
        cursor: "activity:epoch-7:000042",
        activity,
      });
    },
  }));

  pi.registerTool(withRenderer("wait", {
    name: "subagent_wait",
    label: "Wait for subagent",
    description: "阻塞等待当前 session 的一个直接 child 在指定 settled cursor 之后产生新的 agent_settled。成功时返回新的 settled cursor 和有界近期活动；child 被中断、关闭或等待超时时会返回对应 outcome，不会伪造完成。",
    promptSnippet: "等待 child 稳定完成，并取得低噪声近期结果。",
    promptGuidelines: ["调用 subagent_wait 时传入任务开始前取得的 afterSettled；只有 outcome: \"settled\" 表示目标工作稳定完成，interrupted、closed 或 timeout 都不得当作成功结果。"],
    parameters: waitParameters,
    async execute(_toolCallId, params, signal, onUpdate) {
      onUpdate?.(toolResult({
        operation: "wait",
        ok: true,
        agent: { ...agentFor(params.agentId), status: "running" },
        message: "Waiting for a newer settled generation.",
      }));
      await delay(Math.min(params.timeoutMs ?? 30_000, 650), signal);
      return toolResult({
        operation: "wait",
        ok: true,
        agent: { ...agentFor(params.agentId), status: "settled", generation: 2 },
        outcome: "settled",
        durationMs: 8_400,
        settledCursor: "settled:epoch-7:generation-2",
        cursor: "activity:epoch-7:000042",
        activity: recentActivity.slice(-2),
      });
    },
  }));

  pi.registerTool(withRenderer("close", {
    name: "subagent_close",
    label: "Close subagent",
    description: "立即中断并关闭一个直接 child 的 Pi 进程和 tmux window，或递归关闭当前 session 的整棵 subagent 树。Close 保留 Pi session、Extension ownership、generation 和其他管理元数据，因此 child 之后仍可通过 subagent_resume 重新使用。",
    promptSnippet: "停止 child 进程但保留关系，以便以后恢复。",
    promptGuidelines: ["使用 subagent_close 停止暂时不再运行但仍需保留管理关系的 child；target: \"all\" 会递归中断全部后代。需要永久解除 Extension 管理关系时使用 subagent_forget。"],
    parameters: targetParameters,
    async execute(_toolCallId, params) {
      const affected = params.target === "all"
        ? [robie, bob, lin].map((agent) => ({ ...agent, status: "closed" as const }))
        : [{ ...agentFor(params.target), status: "closed" as const }];
      return toolResult({
        operation: "close",
        ok: true,
        agent: affected.length === 1 ? affected[0] : undefined,
        affected,
        relationshipRetained: true,
        piSessionRetained: true,
      });
    },
  }));

  pi.registerTool(withRenderer("forget", {
    name: "subagent_forget",
    label: "Forget subagent",
    description: "递归立即关闭目标 subagent 子树，并删除 Extension 维护的 ownership、runtime 和临时管理数据。不会删除或修改任何 Pi 原生 session JSONL 或项目文件；被 forget 的 session 仍可通过 Pi 原生方式独立 resume，但当前 main 此后不能再通过 subagent 工具管理它们。",
    promptSnippet: "关闭并永久解除 Extension 对 subagent 子树的管理关系。",
    promptGuidelines: ["仅在明确不再需要当前 main 管理或复用目标 subagent 时使用 subagent_forget；如果以后仍可能通过 subagent_resume 使用，应改用 subagent_close。"],
    parameters: targetParameters,
    async execute(_toolCallId, params) {
      const affected = params.target === "all"
        ? [robie, bob, lin].map((agent) => ({ ...agent, status: "closed" as const }))
        : [{ ...agentFor(params.target), status: "closed" as const }];
      return toolResult({
        operation: "forget",
        ok: true,
        agent: affected.length === 1 ? affected[0] : undefined,
        affected,
        extensionDataRemoved: true,
        piSessionRetained: true,
        relationshipRetained: false,
      });
    },
  }));
}

function withRenderer<TParams extends TSchema>(
  kind: SubagentToolKind,
  definition: ToolDefinition<TParams, SubagentUiDetails>,
): ToolDefinition<TParams, SubagentUiDetails> {
  return {
    ...definition,
    renderShell: "self",
    renderCall(args, theme, context) {
      return renderSubagentCall(kind, args as Record<string, unknown>, theme, context);
    },
    renderResult(result, options, theme, context) {
      return renderSubagentResult(
        kind,
        context.args as Record<string, unknown>,
        result,
        options,
        theme,
        context,
      );
    },
  };
}

function toolResult(details: SubagentUiDetails): AgentToolResult<SubagentUiDetails> {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
  };
}

function agentFor(agentId: string): AgentDisplay {
  if (agentId === BOB_ID) return { ...bob };
  if (agentId === LIN_ID) return { ...lin };
  return { ...robie, agentId };
}

function takeRecentActivity(
  activity: ActivityDisplay[],
  assistantLimit: number,
  toolLimit: number,
): ActivityDisplay[] {
  const assistantIds = new Set(activity
    .filter((item) => item.kind === "assistant")
    .slice(-assistantLimit)
    .map((item) => item.id));
  const toolIds = new Set(activity
    .filter((item) => item.kind === "tool")
    .slice(-toolLimit)
    .map((item) => item.id));
  return activity.filter((item) => (
    item.kind === "assistant" ? assistantIds.has(item.id) : toolIds.has(item.id)
  ));
}

async function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
