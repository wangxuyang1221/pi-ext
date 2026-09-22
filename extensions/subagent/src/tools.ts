import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";

import type {
  ManagedAgent,
  ManagedWaitResult,
  SubagentManager,
} from "./manager.js";
import {
  renderSubagentCall,
  renderSubagentResult,
  type ActivityDisplay,
  type AgentDisplay,
  type SubagentToolKind,
  type SubagentUiDetails,
} from "./renderers.js";
import type {
  SessionActivity,
  SessionViewResult,
} from "./session-reader.js";

const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
], {
  description: "subagent 的 thinking level；省略时继承当前设置。",
});

const modelReferencePattern = "^[^/\\s]+/\\S+$";
const modelReferenceRegex = new RegExp(modelReferencePattern, "u");

function validateModelReference(model: unknown): void {
  if (model !== undefined && (typeof model !== "string" || !modelReferenceRegex.test(model))) {
    throw new Error("Model must use provider/model format, for example deepseek/deepseek-flash.");
  }
}

const spawnParameters = Type.Object({
  task: Type.String({
    description: "交给 subagent 的自包含初始任务。写明必要上下文和可检查的完成条件。",
    minLength: 1,
  }),
  cwd: Type.Optional(Type.String({
    description: "subagent 的工作目录；相对路径按当前工作目录解析，省略时继承当前工作目录。",
    minLength: 1,
  })),
  model: Type.Optional(Type.String({
    description: "必须填写完整的 provider/model，例如 deepseek/deepseek-flash；不接受模型短名称。省略时继承当前模型。",
    minLength: 1,
    pattern: modelReferencePattern,
  })),
  thinkingLevel: Type.Optional(ThinkingLevelSchema),
});

const promptParameters = Type.Object({
  agentId: Type.String({
    description: "接收提示的 subagent sessionId。",
    minLength: 1,
  }),
  text: Type.String({
    description: "发送给 subagent 的任务或修正。",
    minLength: 1,
  }),
  delivery: Type.Optional(Type.Union([
    Type.Literal("steer"),
    Type.Literal("follow_up"),
  ], {
    description: "投递时机。follow_up 等现有工作结束后送达；steer 在当前 assistant turn 的工具调用结束后送达。默认 follow_up。",
    default: "follow_up",
  })),
});

const listParameters = Type.Object({});

const readAgentId = Type.String({
  description: "要读取的 subagent sessionId。",
  minLength: 1,
});

const readAfter = Type.Optional(Type.String({
  description: "上次同一 agent、epoch 和 view 返回的 cursor；本次只读取其后的活动。",
  minLength: 1,
}));

// DeepSeek requires an explicit object root; keep the union for strict view validation.
const readParameters = Type.Union([
  Type.Object({
    agentId: readAgentId,
    view: Type.Literal("recent_activity", {
      description: "返回 after 之后最近的 assistant message 和工具活动摘要。",
    }),
    assistantLimit: Type.Optional(Type.Integer({
      description: "最多返回的近期非空 assistant message 数；默认 1。",
      minimum: 1,
      maximum: 10,
      default: 1,
    })),
    toolLimit: Type.Optional(Type.Integer({
      description: "最多返回的近期工具活动数；默认 1。",
      minimum: 1,
      maximum: 20,
      default: 1,
    })),
    after: readAfter,
  }, { additionalProperties: false }),
  Type.Object({
    agentId: readAgentId,
    view: Type.Literal("turns", {
      description: "按 user prompt 分组返回 after 之后的活动。",
    }),
    limit: Type.Optional(Type.Integer({
      description: "最多返回的近期 user turn 数；默认 20。",
      minimum: 1,
      maximum: 200,
      default: 20,
    })),
    after: readAfter,
    pageCursor: Type.Optional(Type.String({
      description: "上一页的 nextPageCursor；用于续读同一 turns 快照，不能作为 after。提供后沿用首页的 after 与 limit。",
      minLength: 1,
    })),
  }, { additionalProperties: false }),
  Type.Object({
    agentId: readAgentId,
    view: Type.Literal("activity_detail", {
      description: "分页读取单条活动的原始内容。",
    }),
    activityId: Type.String({
      description: "摘要中 detailRef 提供的 activityId。",
      minLength: 1,
    }),
    section: Type.Union([
      Type.Literal("assistant_text"),
      Type.Literal("assistant_error"),
      Type.Literal("user_text"),
      Type.Literal("tool_arguments"),
      Type.Literal("tool_result"),
    ], {
      description: "要读取的 section；必须存在于该活动的 detailRef.sections。",
    }),
    detailCursor: Type.Optional(Type.String({
      description: "上一页返回的 nextDetailCursor；省略时从 section 开头读取。",
      minLength: 1,
    })),
  }, { additionalProperties: false }),
], { type: "object" });

type ReadParameters = Static<typeof readParameters>;

const waitParameters = Type.Object({
  agentId: Type.String({
    description: "要等待的 subagent sessionId。",
    minLength: 1,
  }),
  afterSettled: Type.String({
    description: "启动该轮任务的 subagent_spawn 或 subagent_prompt 返回的 agent.settledCursor。",
    minLength: 1,
  }),
  timeoutMs: Type.Optional(Type.Integer({
    description: "本次调用最多等待的毫秒数；默认 30000，最大 600000。",
    minimum: 1,
    maximum: 600_000,
    default: 30_000,
  })),
  afterActivity: Type.Optional(Type.String({
    description: "附带活动的起点 cursor；只影响返回的活动，不影响 settled 判定。",
    minLength: 1,
  })),
  assistantLimit: Type.Optional(Type.Integer({
    description: "settled 时最多附带的近期 assistant message 数；默认 2。",
    minimum: 1,
    maximum: 50,
    default: 2,
  })),
  toolLimit: Type.Optional(Type.Integer({
    description: "settled 时最多附带的近期工具活动数；默认 3。",
    minimum: 1,
    maximum: 100,
    default: 3,
  })),
});

const targetParameters = Type.Object({
  target: Type.String({
    description: "要关闭的 subagent agentId；传入 all 时关闭当前 session 管理的全部 subagent。",
    minLength: 1,
  }),
});

export function registerSubagentTools(
  pi: Pick<ExtensionAPI, "registerTool" | "on">,
  manager: SubagentManager,
): void {
  // Returning structured failures preserves their display identity in session history.
  pi.on("tool_result", event => {
    if (event.toolName !== "subagent_wait") return;
    const details = event.details as SubagentUiDetails | undefined;
    if (details?.operation === "wait" && details.ok === false) return { isError: true };
  });

  pi.registerTool(withRenderer("spawn", {
    name: "subagent_spawn",
    label: "Spawn subagent",
    description: "创建一个由当前 session 管理的 subagent，随机分配漫威英雄显示名，并提交初始任务。工具在 runtime 注册后返回，不等待任务完成；subagent 保留到调用 subagent_close。",
    promptSnippet: "创建 subagent 异步执行独立任务。",
    promptGuidelines: [
      "调用 subagent_spawn 前优先通过 subagent_prompt 复用能够承接任务的已有 subagent，尤其是已掌握相关代码、文档或决策上下文的对象。已有信息不足以判断可复用对象或剩余容量时，先调用 subagent_list。",
      "仅在没有合适的可复用对象，且任务边界和验收条件明确时调用 subagent_spawn。",
    ],
    parameters: spawnParameters,
    prepareArguments(args) {
      if (isRecord(args)) validateModelReference(args.model);
      return args as Static<typeof spawnParameters>;
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      validateModelReference(params.model);
      const reference = params.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
      if (!reference) throw new Error("No parent model to inherit; specify a model using provider/model format.");
      const slash = reference.indexOf("/");
      const model = ctx.modelRegistry.find(reference.slice(0, slash), reference.slice(slash + 1));
      if (!model) throw new Error(`Model not found: ${reference}. Use an existing provider/model.`);
      const agent = await manager.spawn(currentSessionId(ctx), { ...params, model: { provider: model.provider, id: model.id } }, {
        cwd: ctx.cwd,
        thinkingLevel: ctx.thinkingLevel,
      }, _signal);
      const details: SubagentUiDetails = {
        operation: "spawn",
        ok: true,
        agent: toAgentDisplay(agent),
        task: params.task,
        message: "Child runtime registered; task completion is not implied.",
      };
      return toolResult({ agent, task: params.task }, details);
    },
  }));

  pi.registerTool(withRenderer("prompt", {
    name: "subagent_prompt",
    label: "Prompt subagent",
    description: "向当前 session 管理且 runtime 存活的 subagent 发送任务或修正。返回只表示投递成功，不表示 subagent 已处理或完成。",
    promptSnippet: "继续或修正已有 subagent 的工作。",
    promptGuidelines: [
      "使用 subagent_prompt 补充任务时，说明目标、范围和验收条件，并交代相对上一轮发生的变化。",
      "调用 subagent_prompt 时，新信息使当前路线失效，或继续执行可能造成错误或风险时，使用 steer；无需打断当前工作的任务和补充信息使用 follow_up。",
      "subagent_prompt 投递成功不代表任务完成。需要等待本次任务结果时，使用本次返回的 agent.settledCursor 调用 subagent_wait。",
    ],
    parameters: promptParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const delivery = params.delivery ?? "follow_up";
      const {
        agent,
        deliveryId,
        confirmation,
      } = await manager.prompt(
        currentSessionId(ctx),
        params.agentId,
        params.text,
        delivery,
        _signal,
      );
      const details: SubagentUiDetails = {
        operation: "prompt",
        ok: true,
        agent: toAgentDisplay(agent),
        prompt: params.text,
        delivery,
        deliveryId,
        confirmation,
        message: "Prompt delivered; processing and completion are not implied.",
      };
      return toolResult({ agent, delivery, deliveryId, confirmation }, details);
    },
  }));

  pi.registerTool(withRenderer("list", {
    name: "subagent_list",
    label: "List subagents",
    description: "列出当前 session 管理的 subagent 及其 agentId、名称、状态、generation、tmux window 和 session 文件路径。capacity.active 是 runtime 存活数，pending 是正在创建数，limit 是 active 与 pending 的总数上限，available 是当前还能创建数。",
    promptSnippet: "列出 subagent，并查看当前还能创建多少个。",
    promptGuidelines: ["需要查找可复用的 subagent，或已有信息不足以判断状态和剩余容量时使用 subagent_list。不要通过反复调用 subagent_list 等待任务完成；需要等待时使用 subagent_wait。"],
    parameters: listParameters,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const { agents, capacity, diagnostics } = await manager.list(currentSessionId(ctx), _signal);
      const details: SubagentUiDetails = {
        operation: "list",
        ok: true,
        agents: agents.map(toAgentDisplay),
        capacity,
      };
      return toolResult({ agents, capacity, ...(diagnostics ? { diagnostics } : {}) }, details);
    },
  }));

  pi.registerTool(withRenderer("read", {
    name: "subagent_read",
    label: "Read subagent activity",
    description: "读取当前 session 管理的 subagent 已完整写入原生 Pi session 的 assistant message 和工具活动。recent_activity 返回近期摘要；turns 按 user turn 分组；activity_detail 分页返回单条活动的原始 section。生成中的 token 和工具增量不返回。",
    promptSnippet: "读取 subagent 的活动摘要或原始详情。",
    promptGuidelines: [
      "使用 subagent_read 查看进度或获取近期结果时选择 recent_activity；按对话轮次重建上下文时选择 turns；读取单条活动的原始内容时选择 activity_detail，并按需分页。",
      "使用 subagent_read 常规增量读取时，将上次返回的 cursor 作为 after。若需补取 recent_activity 本次省略的条目，应复用本次调用传入的 after，并提高 assistantLimit 或 toolLimit；本次返回的 cursor 已越过这些条目。",
      "subagent_read 的 turns 每页完整 JSON 不超过 72 KiB；hasMore 和 nextPageCursor 表示当前快照尚有续页，续读使用 pageCursor。continued 表示同一 turn 的后续活动，user 摘要会重复用于定位，activity 不重复。limit 仍选择最近的 user turn 窗口，omittedTurns 是更早被省略的 turn 数，补取它们需复用原 after 并提高 limit。user 或 assistant 摘要截断时通过 detailRef 分页取回原文。",
      "按任务需要继续调用 subagent_read，不必仅因 hasMore 为 true 就读完全部活动。需要等待新结果时使用 subagent_wait，避免反复读取空结果。",
    ],
    parameters: readParameters,
    prepareArguments(args): ReadParameters {
      if (!isRecord(args) || args.view !== undefined) return args as ReadParameters;
      return { ...args, view: "recent_activity" } as ReadParameters;
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const readOptions = params.view === "recent_activity"
        ? {
            view: params.view,
            ...(params.assistantLimit === undefined ? {} : { assistantLimit: params.assistantLimit }),
            ...(params.toolLimit === undefined ? {} : { toolLimit: params.toolLimit }),
            ...(params.after === undefined ? {} : { after: params.after }),
          }
        : params.view === "turns"
          ? {
              view: params.view,
              ...(params.limit === undefined ? {} : { limit: params.limit }),
              ...(params.pageCursor === undefined ? {} : { pageCursor: params.pageCursor }),
              ...(params.after === undefined ? {} : { after: params.after }),
            }
          : {
              view: params.view,
              activityId: params.activityId,
              section: params.section,
              ...(params.detailCursor === undefined ? {} : { detailCursor: params.detailCursor }),
            };
      const { agent, ...result } = await manager.read(currentSessionId(ctx), params.agentId, readOptions, _signal);
      const summarizedActivity = result.view === "recent_activity"
        ? result.activity
        : result.view === "turns"
          ? result.turns.flatMap((turn) => turn.activity)
          : [];
      const activity = result.view === "recent_activity"
        ? summarizedActivity.map(toActivityDisplay)
        : [];
      const assistantCount = summarizedActivity.filter((item) => item.kind === "assistant").length;
      const toolCount = summarizedActivity.filter((item) => item.kind === "tool").length;
      const details: SubagentUiDetails = {
        operation: "read",
        ok: true,
        agent: agent ? toAgentDisplay(agent) : { agentId: params.agentId, name: params.agentId, status: "running", generation: 0 },
        view: result.view,
        assistantCount,
        toolCount,
        ...(result.view === "recent_activity"
          ? {
              omittedAssistant: result.omittedAssistant,
              omittedTools: result.omittedTools,
              returnedBytes: result.returnedBytes,
              truncated: summarizedActivity.some((item) => (
                item.kind === "assistant" && item.truncated
              )),
              hasMore: result.hasMore,
            }
          : result.view === "turns"
            ? {
                returnedBytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
                hasMore: result.hasMore,
                nextPageCursor: result.nextPageCursor,
                truncated: result.turns.some((turn) => turn.user.truncated) || summarizedActivity.some((item) => (
                  item.kind === "assistant" && item.truncated
                )),
              }
            : {
                activityId: result.activityId,
                section: result.section,
                originalBytes: result.originalBytes,
                returnedBytes: result.returnedBytes,
                truncated: result.truncated,
                hasMore: result.hasMore,
                ...(result.nextDetailCursor === undefined
                  ? {}
                  : { nextDetailCursor: result.nextDetailCursor }),
              }),
        ...(result.view === "activity_detail" ? {} : { cursor: result.cursor }),
        activity,
      };
      return toolResult(result, details, true);
    },
  }));

  pi.registerTool(withRenderer("wait", {
    name: "subagent_wait",
    label: "Wait for subagent",
    description: "阻塞等待当前 session 管理的 subagent 在 afterSettled 之后产生新的 agent_settled。outcome 为 settled 时附带近期活动；timeout、closed 和 interrupted 不表示产生了新的 settled 事件。",
    promptSnippet: "主任务依赖结果时，等待 subagent 产生新的 settled 事件。",
    promptGuidelines: [
      "下一步依赖 subagent 的结果且暂无其他可推进工作时使用 subagent_wait；仅查看当前进度时使用 subagent_read。",
      "调用 subagent_wait 时，afterSettled 使用启动目标轮次的 subagent_spawn 或 subagent_prompt 返回的 agent.settledCursor。timeout 后继续等待同一轮次时，复用该值。",
      "subagent_wait 返回 outcome 为 settled 只表示该轮运行已结束，不代表任务成功或通过验收。读取返回活动，确认任务结果后再决定继续、补充任务或关闭。",
    ],
    parameters: waitParameters,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      let agent: AgentDisplay | undefined;
      try {
        const result = await manager.wait(currentSessionId(ctx), params.agentId, {
          onAgent: managed => {
            agent = toAgentDisplay(managed);
            onUpdate?.(toolResult({ waiting: true }, {
              operation: "wait",
              ok: true,
              agent,
              message: "Waiting for a newer settled generation.",
            }));
          },
          afterSettled: params.afterSettled,
          timeoutMs: params.timeoutMs ?? 30_000,
          ...(params.afterActivity === undefined ? {} : { afterActivity: params.afterActivity }),
          ...(params.assistantLimit === undefined ? {} : { assistantLimit: params.assistantLimit }),
          ...(params.toolLimit === undefined ? {} : { toolLimit: params.toolLimit }),
        }, signal);
        return toolResult(result, waitDetails(result), true);
      } catch (error) {
        if (!agent) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          details: { operation: "wait", ok: false, agent, message },
        };
      }
    },
  }));

  pi.registerTool(withRenderer("close", {
    name: "subagent_close",
    label: "Close subagent",
    description: "终止当前 session 管理的一个或全部 subagent，停止其 Pi 进程和 tmux window，并删除 Extension 管理状态。原生 Pi session 文件保留。",
    promptSnippet: "终止 subagent，并释放其占用的名额。",
    promptGuidelines: [
      "由主 agent 根据后续任务需要决定是否调用 subagent_close，无需向用户确认；用户明确要求保留时除外。",
      "任务结束不代表应立即调用 subagent_close。仍需追问、验收或复用上下文时保留；确认不再需要，或容量不足且有可释放的 subagent 时关闭。",
      "调用 subagent_close 后无法继续通过 subagent 工具访问。关闭前应读取所需结果，并记录后续工作需要的信息。",
    ],
    parameters: targetParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const affected = await manager.close(currentSessionId(ctx), params.target, _signal);
      const displays = affected.map(toAgentDisplay);
      const details: SubagentUiDetails = {
        operation: "close",
        ok: true,
        ...(displays.length === 1 ? { agent: displays[0] } : {}),
        affected: displays,
        relationshipRemoved: true,
        extensionDataRemoved: true,
        piSessionRetained: true,
      };
      return toolResult({
        affected,
        relationshipRemoved: true,
        extensionDataRemoved: true,
        piSessionRetained: true,
      }, details);
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

function currentSessionId(ctx: ExtensionContext): string {
  if (!ctx.sessionManager.getSessionFile()) {
    throw new Error("Subagent tools require a persistent Pi session");
  }
  return ctx.sessionManager.getSessionId();
}

function toolResult(
  payload: unknown,
  details: SubagentUiDetails,
  compact = false,
): AgentToolResult<SubagentUiDetails> {
  return {
    content: [{
      type: "text",
      text: compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2),
    }],
    details,
  };
}

function toAgentDisplay(agent: ManagedAgent): AgentDisplay {
  return {
    agentId: agent.agentId,
    name: agent.name,
    status: agent.status,
    generation: agent.generation,
    model: agent.model,
    thinkingLevel: agent.thinkingLevel,
    tmuxWindow: agent.tmux
      ? `${agent.tmux.sessionName}:${agent.tmux.windowId}`
      : undefined,
    sessionFile: agent.sessionFile,
  };
}

function toActivityDisplay(activity: SessionActivity): ActivityDisplay {
  if (activity.kind === "assistant") return activity;
  return {
    kind: "tool",
    id: activity.id,
    timestamp: activity.timestamp,
    toolName: activity.toolName,
    outcome: activity.outcome,
    ...(activity.errorPreview === undefined ? {} : { errorPreview: activity.errorPreview }),
  };
}

function waitDetails(result: ManagedWaitResult): SubagentUiDetails {
  return {
    operation: "wait",
    ok: true,
    agent: toAgentDisplay(result.agent),
    outcome: result.outcome,
    durationMs: result.durationMs,
    settledCursor: result.settledCursor,
    cursor: result.activityCursor,
    assistantCount: result.assistantCount,
    toolCount: result.toolCount,
    omittedAssistant: result.omittedAssistant,
    omittedTools: result.omittedTools,
    returnedBytes: result.returnedBytes,
    truncated: result.activity.some((item) => item.kind === "assistant" && item.truncated),
    hasMore: result.hasMore,
    activity: result.activity.map(toActivityDisplay),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { SessionViewResult };
