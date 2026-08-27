import { Type } from "typebox";
import { renderSubagentCall, renderSubagentResult, } from "./renderers.js";
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
        description: "单次最长等待时间（毫秒）；默认 30000，最大 120000。",
        minimum: 1,
        maximum: 120_000,
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
export function registerSubagentTools(pi, manager) {
    pi.registerTool(withRenderer("spawn", {
        name: "subagent_spawn",
        label: "Spawn subagent",
        description: "在 tmux 中启动一个普通 TUI Pi child，将其注册为当前 session 的直接 subagent，并提交初始任务。每次调用只创建一个 child；工具在 child runtime 注册成功后返回，不等待任务完成。",
        promptSnippet: "创建持久化 child Pi，异步执行独立任务。",
        promptGuidelines: ["使用 subagent_spawn 委派边界清晰、可独立执行的任务；工具返回只表示 child 已启动。随后优先使用 subagent_read 低噪声跟踪；只有 main 的下一步依赖 child 结果时才使用 subagent_wait。"],
        parameters: spawnParameters,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const agent = await manager.spawn(currentSessionId(ctx), params, {
                cwd: ctx.cwd,
                model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
                thinkingLevel: ctx.thinkingLevel,
            });
            const details = {
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
        description: "通过 tmux 向当前 session 的一个运行中直接 child 投递正常 Pi prompt。默认使用 steer，在当前 assistant turn 的工具调用结束后尽快送达；follow-up 会等待当前工作结束后再送达。返回仅表示投递成功，不表示 child 已处理或 settled。",
        promptSnippet: "向运行中的直接 child 投递 steer 或 follow-up prompt。",
        promptGuidelines: ["使用 subagent_prompt 的默认 steer 修正或补充当前工作；只有当消息应在现有工作彻底结束后执行时才选择 follow_up。已终结清理的 child 不再属于当前 namespace，不能继续投递。"],
        parameters: promptParameters,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const delivery = params.delivery ?? "steer";
            const agent = await manager.prompt(currentSessionId(ctx), params.agentId, params.text, delivery);
            const details = {
                operation: "prompt",
                ok: true,
                agent: toAgentDisplay(agent),
                prompt: params.text,
                delivery,
                message: "Prompt delivered; processing and completion are not implied.",
            };
            return toolResult({ agent, delivery }, details);
        },
    }));
    pi.registerTool(withRenderer("list", {
        name: "subagent_list",
        label: "List subagents",
        description: "列出当前 Pi session 直接管理的全部 subagent，包括 agentId、显示名称、状态、generation、可用的 tmux/session 定位信息，以及 active、pending、limit、available 容量信息。仅返回直接 child。",
        promptSnippet: "列出当前 session 的直接 subagent 及其状态。",
        promptGuidelines: ["使用 subagent_list 发现直接 child、取得 agentId 或检查概况；需要证明某轮工作已经完成时使用 subagent_wait，不要只依赖列表中的瞬时状态。"],
        parameters: listParameters,
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const { agents, capacity } = await manager.list(currentSessionId(ctx));
            const details = {
                operation: "list",
                ok: true,
                agents: agents.map(toAgentDisplay),
                capacity,
            };
            return toolResult({ agents, capacity }, details);
        },
    }));
    pi.registerTool(withRenderer("read", {
        name: "subagent_read",
        label: "Read subagent activity",
        description: "从当前 session 的一个直接 child 的原生 Pi session JSONL 中读取结构化、只读的 finalized 活动。默认返回有界的 recent activity；也可按 user turn 读取，或在诊断时读取原生 all entries。运行中的未完成 token 或工具增量不会返回。",
        promptSnippet: "低噪声读取 child 的 assistant message 和工具历史。",
        promptGuidelines: ["常规跟踪优先使用 subagent_read 的 recent_activity 和 cursor，让 main 在 child 工作时继续推进；仅在需要完整请求上下文时使用 turns，需要诊断原生记录时才使用 all_entries。"],
        parameters: readParameters,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const result = await manager.read(currentSessionId(ctx), params.agentId, {
                view: params.view ?? "recent_activity",
                ...(params.assistantLimit === undefined ? {} : { assistantLimit: params.assistantLimit }),
                ...(params.toolLimit === undefined ? {} : { toolLimit: params.toolLimit }),
                ...(params.limit === undefined ? {} : { limit: params.limit }),
                ...(params.after === undefined ? {} : { after: params.after }),
            });
            const activity = result.view === "recent_activity"
                ? result.activity.map(toActivityDisplay)
                : [];
            const details = {
                operation: "read",
                ok: true,
                agent: { agentId: params.agentId, name: params.agentId, status: "running", generation: 0 },
                view: result.view,
                assistantCount: result.view === "recent_activity" ? result.assistantCount : 0,
                toolCount: result.view === "recent_activity" ? result.toolCount : 0,
                cursor: result.cursor,
                activity,
            };
            return toolResult(result, details);
        },
    }));
    pi.registerTool(withRenderer("wait", {
        name: "subagent_wait",
        label: "Wait for subagent",
        description: "阻塞等待当前 session 的一个直接 child 在指定 settled cursor 之后产生新的 agent_settled。仅当 main 的下一步依赖 child 结果时使用；成功时返回新的 settled cursor 和近期活动，关闭、中断或超时不会伪造完成。",
        promptSnippet: "等待主线所依赖的 child 稳定完成。",
        promptGuidelines: ["常规进度跟踪应优先使用 subagent_read；仅当下一步被 child 结果阻塞时调用 subagent_wait。传入任务开始前的 afterSettled，timeout 后可复用同一 afterSettled 再次等待；只有 outcome: \"settled\" 表示成功完成。"],
        parameters: waitParameters,
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            onUpdate?.(toolResult({ waiting: true }, {
                operation: "wait",
                ok: true,
                agent: { agentId: params.agentId, name: params.agentId, status: "running", generation: 0 },
                message: "Waiting for a newer settled generation.",
            }));
            const result = await manager.wait(currentSessionId(ctx), params.agentId, {
                afterSettled: params.afterSettled,
                timeoutMs: params.timeoutMs ?? 30_000,
                ...(params.afterActivity === undefined ? {} : { afterActivity: params.afterActivity }),
                ...(params.assistantLimit === undefined ? {} : { assistantLimit: params.assistantLimit }),
                ...(params.toolLimit === undefined ? {} : { toolLimit: params.toolLimit }),
            }, signal);
            return toolResult(result, waitDetails(result));
        },
    }));
    pi.registerTool(withRenderer("close", {
        name: "subagent_close",
        label: "Close subagent",
        description: "终结一个直接 child，或当前 root 的全部直接 children：先停止 Pi 进程和 tmux window，再解除管理关系并删除 Extension 状态；保留 Pi 原生 session。",
        promptSnippet: "终结直接 child 并清理 Extension 管理数据。",
        promptGuidelines: ["使用 subagent_close 终结不再需要的直接 child；target: \"all\" 只处理当前 root 的直接 children。成功后该 child 不再由当前 namespace 管理。"],
        parameters: targetParameters,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const affected = await manager.close(currentSessionId(ctx), params.target);
            const displays = affected.map(toAgentDisplay);
            const details = {
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
function withRenderer(kind, definition) {
    return {
        ...definition,
        renderShell: "self",
        renderCall(args, theme, context) {
            return renderSubagentCall(kind, args, theme, context);
        },
        renderResult(result, options, theme, context) {
            return renderSubagentResult(kind, context.args, result, options, theme, context);
        },
    };
}
function currentSessionId(ctx) {
    if (!ctx.sessionManager.getSessionFile()) {
        throw new Error("Subagent tools require a persistent Pi session");
    }
    return ctx.sessionManager.getSessionId();
}
function toolResult(payload, details) {
    return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details,
    };
}
function toAgentDisplay(agent) {
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
function toActivityDisplay(activity) {
    if (activity.kind === "assistant")
        return activity;
    return {
        kind: "tool",
        id: activity.id,
        timestamp: activity.timestamp,
        toolName: activity.toolName,
        summary: previewJson(activity.arguments, 80),
        result: activity.result ?? (activity.complete ? "Completed" : "Result not persisted"),
        ...(activity.isError === undefined ? {} : { isError: activity.isError }),
    };
}
function waitDetails(result) {
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
        activity: result.activity.map(toActivityDisplay),
    };
}
function previewJson(value, maximum) {
    const text = JSON.stringify(value) ?? "";
    return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}
//# sourceMappingURL=tools.js.map