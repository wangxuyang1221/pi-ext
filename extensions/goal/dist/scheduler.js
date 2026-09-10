import { randomUUID } from "node:crypto";
import { GoalLoopDetector, LOOP_WINDOW } from "./loop.js";
import { renderGoalPrompt } from "./tools.js";
export const GOAL_CONTEXT = "pi-ext-goal-continuation";
export const GOAL_BUDGET_CONTEXT = "pi-ext-goal-budget";
export const GOAL_LOOP_CONTEXT = "pi-ext-goal-loop-warning";
export const GOAL_LOOP_PAUSED = "Goal paused after repeated tool calls returned unchanged results. Review the last actions, then use /goal resume to continue.";
const LOOP_WARNING = "Repeated tool calls are returning unchanged results. Reuse already verified evidence. If the objective is complete, call update_goal with status complete and deliver the result. Otherwise choose an action that yields new evidence, or wait on a verified live task handle. Continued repetition will pause this goal.";
/** Coordinate only this extension's continuation requests through public Pi events. */
export function registerGoalScheduler(pi, access) {
    const instance = randomUUID();
    let live = false;
    let suspended = false;
    let editedPending = false;
    let runGeneration = 0;
    let pending;
    let restartRequested = false;
    let internalCancellation = false;
    let failedBash = false;
    let successfulTool = false;
    let failedRuns = 0;
    let completedResponse = false;
    let runEnded = false;
    let lastError;
    let bound;
    let boundSignal;
    let recoverySuppressed = false;
    let modelGeneration = 0;
    let budgetNotified;
    let fallbackReminder;
    const loop = new GoalLoopDetector();
    const admitted = new Map();
    let loopWarning;
    let warningDelivered = false;
    let pausePending = false;
    let pauseFence;
    let completionBatch = false;
    const resetLoop = () => { loop.reset(); admitted.clear(); loopWarning = undefined; warningDelivered = false; pausePending = false; pauseFence = undefined; completionBatch = false; };
    const ticket = (record) => ({ instance, ownerSessionId: record.ownerSessionId, goalId: record.goal.goalId, generation: record.generation, runGeneration, scheduleId: randomUUID() });
    const active = (ctx, allowLimited = false) => {
        const record = access.snapshot();
        return live && !suspended && ctx.mode === "tui" && ctx.model?.provider === "openai-codex" && record?.ownerSessionId === ctx.sessionManager.getSessionId() && (record.goal?.status === "active" || (allowLimited && record.goal?.status === "budget_limited")) && !record.continuationDeferral ? record : undefined;
    };
    const valid = (ticket, ctx, allowLimited = false) => {
        const record = active(ctx, allowLimited);
        return !!ticket && !!record && ticket.instance === instance && ticket.ownerSessionId === record.ownerSessionId && ticket.goalId === record.goal.goalId && ticket.generation === record.generation && ticket.runGeneration === runGeneration;
    };
    const refresh = (ctx) => {
        const goal = access.snapshot()?.goal;
        const limitation = suspended ? " | storage error: /goal resume" : ctx.model?.provider !== "openai-codex" ? " | requires OpenAI Codex" : "";
        ctx.ui.setStatus("goal", goal ? `Goal: ${goal.status} | ${goal.tokensUsed} tokens | ${goal.elapsedSeconds}s${limitation}` : undefined);
    };
    const start = (ctx) => {
        const record = active(ctx);
        if (!record)
            return;
        if (pending) {
            if (!valid(pending, ctx))
                restartRequested = true;
            return;
        }
        restartRequested = false;
        pending = ticket(record);
        pi.sendMessage({ customType: GOAL_CONTEXT, content: renderGoalPrompt(record.goal, editedPending), display: false, details: pending }, { deliverAs: "followUp", triggerTurn: true });
    };
    const pauseLoop = async (ctx) => {
        const record = active(ctx);
        if (!record || !valid(bound, ctx))
            return;
        const origin = bound;
        pauseFence = origin;
        try {
            await access.stop("paused", record, ctx, "repeated_tool_calls");
            ctx.ui.notify(GOAL_LOOP_PAUSED, "warning");
        }
        catch (error) {
            if (valid(origin, ctx)) {
                suspended = true;
                refresh(ctx);
            }
            ctx.ui.notify(`Goal storage error: ${String(error instanceof Error ? error.message : error).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 400)}`, "error");
        }
    };
    const finishRun = async (ctx) => {
        completedResponse = false;
        const record = active(ctx);
        if (!record || !valid(bound, ctx))
            return;
        failedRuns = failedBash && !successfulTool ? failedRuns + 1 : 0;
        failedBash = false;
        successfulTool = false;
        if (failedRuns >= 3)
            await access.stop("blocked", record, ctx);
        else if (pausePending)
            await pauseLoop(ctx);
    };
    pi.on("before_agent_start", (_event, ctx) => {
        const record = active(ctx);
        if (!record)
            return;
        fallbackReminder = undefined;
        return { message: { customType: GOAL_CONTEXT, content: renderGoalPrompt(record.goal, editedPending), display: false, details: ticket(record) } };
    });
    pi.on("message_end", (event, ctx) => {
        if (event.message.role === "user" || (event.message.role === "custom" && ![GOAL_CONTEXT, GOAL_BUDGET_CONTEXT, GOAL_LOOP_CONTEXT].includes(event.message.customType)))
            resetLoop();
        if (event.message.role === "assistant")
            completionBatch = event.message.content.some(part => part.type === "toolCall" && part.name === "update_goal" && part.arguments.status === "complete");
        if (valid(bound, ctx) && event.message.role === "assistant" && event.message.stopReason === "stop" && !event.message.content.some(part => part.type === "toolCall"))
            completedResponse = true;
    });
    pi.on("tool_call", async (event, ctx) => {
        const snapshot = access.snapshot();
        const fenced = pauseFence && pauseFence.runGeneration === runGeneration && pauseFence.goalId === snapshot?.goal?.goalId && pauseFence.ownerSessionId === ctx.sessionManager.getSessionId();
        if (fenced)
            return { block: true, terminate: true, reason: GOAL_LOOP_PAUSED };
        if (!valid(bound, ctx) || ctx.signal?.aborted)
            return;
        if (pausePending && !completionBatch && event.toolName !== "update_goal" && loop.wouldRepeat(event.toolName, event.input)) {
            await pauseLoop(ctx);
            return { block: true, terminate: true, reason: GOAL_LOOP_PAUSED };
        }
        if (admitted.size < LOOP_WINDOW * 2)
            admitted.set(event.toolCallId, bound);
    });
    pi.on("tool_result", (event, ctx) => {
        const origin = admitted.get(event.toolCallId);
        admitted.delete(event.toolCallId);
        if (!valid(bound, ctx) || ctx.signal?.aborted)
            return;
        if (!event.isError)
            successfulTool = true;
        else if (event.toolName === "bash" && event.content.some(part => part.type === "text" && /Command exited with code|Command timed out after/.test(part.text)))
            failedBash = true;
        if (!valid(origin, ctx) || (loopWarning && !warningDelivered))
            return;
        const decision = loop.observe({ toolName: event.toolName, input: event.input, content: event.content, isError: event.isError });
        pausePending = decision === "pause";
        if (loop.state.repeats === 0) {
            loopWarning = undefined;
            warningDelivered = false;
        }
        if (decision === "warn") {
            loopWarning = ticket(active(ctx));
            pi.sendMessage({ customType: GOAL_LOOP_CONTEXT, content: LOOP_WARNING, display: false, details: loopWarning }, { deliverAs: "steer" });
            ctx.ui.notify("Goal loop warning: repeated tool calls are returning unchanged results.", "warning");
        }
    });
    pi.on("agent_end", async (event, ctx) => {
        runEnded = true;
        if (internalCancellation) {
            internalCancellation = false;
            if (restartRequested)
                start(ctx);
            return;
        }
        const last = [...event.messages].reverse().find(message => message.role === "assistant");
        if (last?.role !== "assistant" || !valid(bound, ctx, true))
            return;
        lastError = last.stopReason === "error" ? last.errorMessage ?? "Model request failed." : undefined;
        const record = active(ctx, true);
        if (!record)
            return;
        if (last.stopReason === "aborted" || boundSignal?.aborted) {
            await access.stop("paused", record, ctx);
            return;
        }
        if (last.stopReason !== "stop")
            return;
        await finishRun(ctx);
        start(ctx);
    });
    pi.on("agent_settled", async (_event, ctx) => {
        const record = active(ctx, true);
        if (record && valid(bound, ctx, true) && lastError !== undefined) {
            const quota = /insufficient_quota|usage_limit_reached|you(?:'|’)ve hit your usage limit/i.test(lastError);
            // Pinned Codex preserves budget_limited on ordinary errors; only an
            // account usage limit overrides it while the bound turn is in flight.
            if (quota || record.goal.status === "active")
                await access.stop(quota ? "usage_limited" : "blocked", record, ctx);
            ctx.ui.notify(`Goal stopped: ${lastError.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 400)}`, "warning");
        }
        bound = undefined;
        boundSignal = undefined;
    });
    pi.on("session_before_compact", event => {
        if (event.reason === "manual")
            recoverySuppressed = false;
        else if (recoverySuppressed)
            return { cancel: true };
    });
    pi.on("session_compact_failed", async (event, ctx) => {
        const record = active(ctx);
        if (!record || !valid(bound, ctx) || event.reason === "manual")
            return;
        recoverySuppressed = true;
        await access.stop(event.aborted ? "paused" : "blocked", record, ctx);
        ctx.ui.notify(`Goal stopped after compaction ${event.aborted ? "cancellation" : "failure"}. Use /goal resume to retry.`, "warning");
    });
    pi.on("input", () => { recoverySuppressed = false; });
    pi.on("session_start", (_event, ctx) => { live = true; refresh(ctx); });
    pi.on("model_select", (_event, ctx) => {
        refresh(ctx);
        if (access.snapshot()?.goal && ctx.model?.provider !== "openai-codex")
            ctx.ui.notify("Automatic goal execution requires an OpenAI Codex model. Your saved goal is unchanged.", "warning");
    });
    pi.on("session_shutdown", () => { resetLoop(); live = false; runGeneration++; pending = undefined; restartRequested = false; internalCancellation = false; });
    pi.on("context", async (event, ctx) => {
        // Follow-up inputs can begin another complete goal turn inside one agent run.
        if (completedResponse)
            await finishRun(ctx);
        const expected = active(ctx);
        if (expected) {
            try {
                await access.checkpoint?.(expected, ctx);
            }
            catch (error) {
                if (active(ctx)?.revision === expected.revision && active(ctx)?.recordId === expected.recordId) {
                    suspended = true;
                    runGeneration++;
                    restartRequested = false;
                    refresh(ctx);
                }
                ctx.ui.notify(`Goal storage error: ${String(error instanceof Error ? error.message : error).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 400)}`, "error");
            }
        }
        const isOwned = (message) => message.role === "custom" && (message.customType === GOAL_CONTEXT || message.customType === GOAL_BUDGET_CONTEXT);
        const owned = event.messages.filter(isOwned);
        const last = event.messages.at(-1);
        const staleRequest = last?.role === "custom" && isOwned(last) && !valid(last.details, ctx, last.customType === GOAL_BUDGET_CONTEXT);
        if (owned.some(message => message.role === "custom" && message.details?.scheduleId === pending?.scheduleId))
            pending = undefined;
        const reminder = [...owned].reverse().find(message => message.role === "custom" && valid(message.details, ctx, message.customType === GOAL_BUDGET_CONTEXT));
        const messages = event.messages.filter(message => {
            if (message.role === "custom" && message.customType === GOAL_LOOP_CONTEXT) {
                const current = !!loopWarning && valid(loopWarning, ctx) && message.details?.scheduleId === loopWarning.scheduleId;
                if (current)
                    warningDelivered = true;
                return current;
            }
            return !isOwned(message) || message === reminder;
        });
        if (staleRequest) {
            internalCancellation = true;
            bound = undefined;
            ctx.abort();
        }
        else {
            runEnded = false;
            const record = active(ctx) ?? (valid(bound, ctx, true) ? active(ctx, true) : undefined);
            bound = record ? ticket(record) : undefined;
            boundSignal = ctx.signal;
            modelGeneration = runGeneration;
            if (record && bound) {
                if (record.goal.status === "active" && !reminder) {
                    // Compaction and a goal created mid-turn can leave no persisted reminder.
                    // Restore one stable prefix, never a fresh instruction after tool evidence.
                    if (!fallbackReminder || !valid(fallbackReminder.details, ctx)) {
                        fallbackReminder = { role: "custom", customType: GOAL_CONTEXT, content: renderGoalPrompt(record.goal, editedPending), display: false, details: bound, timestamp: Date.now() };
                    }
                    messages.unshift(fallbackReminder);
                    editedPending = false;
                }
                if (record.goal.status === "active")
                    editedPending = false;
            }
        }
        return { messages };
    });
    return { start, refresh,
        budget: (ctx) => {
            const record = active(ctx, true);
            if ((pending && runEnded) || record?.goal?.status !== "budget_limited" || !valid(bound, ctx, true) || ctx.isIdle() || budgetNotified === record.goal.goalId)
                return;
            budgetNotified = record.goal.goalId;
            pi.sendMessage({ customType: GOAL_BUDGET_CONTEXT, content: renderGoalPrompt(record.goal, false, true), display: false, details: ticket(record) }, { deliverAs: "steer" });
        },
        suspend: (ctx) => { suspended = true; runGeneration++; restartRequested = false; if (ctx)
            refresh(ctx); },
        resume: (ctx, edited = false) => { suspended = false; editedPending = edited; recoverySuppressed = false; refresh(ctx); start(ctx); },
        invalidate: () => { resetLoop(); runGeneration++; completedResponse = false; failedRuns = 0; failedBash = false; successfulTool = false; lastError = undefined; },
        adopt: (ctx) => { suspended = false; const record = active(ctx); bound = record ? ticket(record) : undefined; modelGeneration = runGeneration; },
        assertModelGoal: (ctx) => { if (modelGeneration !== runGeneration || (bound && !valid(bound, ctx, true)))
            throw new Error("Stale goal tool invocation."); },
    };
}
//# sourceMappingURL=scheduler.js.map