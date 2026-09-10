import { randomUUID } from "node:crypto";
import { GoalLoopDetector, LOOP_WINDOW } from "./loop.js";
import { goalCapability } from "./capability.js";
import { isAccountUsageLimit } from "./quota.js";
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
    let userDelivered = false;
    let runGeneration = 0;
    let pending;
    let pendingBudget;
    const edits = new Map();
    let restartRequested = false;
    let restartAutomatic = false;
    let internalCancellation = false;
    let failedBash = false;
    let successfulTool = false;
    let failedRuns = 0;
    let completedResponse = false;
    let automaticRun = false;
    let activity = false;
    let emptyFinal = false;
    let emptyRuns = 0;
    const resetEmpty = () => { automaticRun = false; activity = false; emptyFinal = false; emptyRuns = 0; };
    let runEnded = false;
    let lastFailure;
    let bound;
    let boundSignal;
    let responseOrigin;
    let recoverySuppressed = false;
    let compactionFailed = false;
    let modelGeneration = 0;
    let budgetNotified;
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
        return live && !suspended && goalCapability(ctx).supported && record?.ownerSessionId === ctx.sessionManager.getSessionId() && (record.goal?.status === "active" || (allowLimited && record.goal?.status === "budget_limited")) && !record.continuationDeferral ? record : undefined;
    };
    const valid = (ticket, ctx, allowLimited = false) => {
        const record = active(ctx, allowLimited);
        return !!ticket && !!record && ticket.instance === instance && ticket.ownerSessionId === record.ownerSessionId && ticket.goalId === record.goal.goalId && ticket.generation === record.generation && ticket.runGeneration === runGeneration;
    };
    // Tool availability gates new continuations, not bound responses or wrap-up.
    const runnable = (ctx) => {
        const record = active(ctx);
        return record && !compactionFailed && !record.goal?.toolRecoveryRequired && !access.missingTools?.().length ? record : undefined;
    };
    const refresh = (ctx) => {
        const goal = access.snapshot()?.goal;
        const capability = goalCapability(ctx);
        const missing = access.missingTools?.() ?? [];
        const limitation = suspended ? " | storage error: /goal resume"
            : !capability.supported ? ` | ${capability.reason}`
                : missing.length ? ` | Missing goal tools: ${missing.join(", ")}. Restore tools, then /goal resume`
                    : goal?.toolRecoveryRequired ? " | Requires explicit /goal resume" : "";
        ctx.ui.setStatus("goal", goal ? `Goal: ${goal.status} | ${goal.tokensUsed} tokens | ${goal.elapsedSeconds}s${limitation}` : undefined);
    };
    const start = (ctx, automatic = false) => {
        const record = runnable(ctx);
        if (!record || (automatic && ctx.hasPendingMessages?.()))
            return;
        if (pending) {
            if (!valid(pending, ctx))
                restartRequested = true;
            return;
        }
        restartRequested = false;
        pending = { ...ticket(record), automatic };
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
        emptyRuns = automaticRun && emptyFinal && !activity ? emptyRuns + 1 : 0;
        automaticRun = false;
        activity = false;
        emptyFinal = false;
        if (emptyRuns >= 3) {
            await access.stop("blocked", record, ctx);
            ctx.ui.notify("Goal blocked after three empty automatic continuations. Use /goal resume to retry.", "warning");
        }
        else if (failedRuns >= 3)
            await access.stop("blocked", record, ctx);
        else if (pausePending)
            await pauseLoop(ctx);
    };
    pi.on("before_agent_start", (_event, ctx) => {
        const record = runnable(ctx);
        if (!record)
            return;
        return { message: { customType: GOAL_CONTEXT, content: renderGoalPrompt(record.goal, editedPending), display: false, details: ticket(record) } };
    });
    pi.on("message_start", event => {
        if (event.message.role === "assistant")
            responseOrigin = { timestamp: event.message.timestamp, ticket: bound };
    });
    pi.on("message_end", (event, ctx) => {
        if (event.message.role === "user") {
            userDelivered = true;
            resetEmpty();
        }
        if (event.message.role === "assistant") {
            const parts = event.message.content;
            if (parts.some(part => part.type === "toolCall" || (part.type === "text" ? part.text.trim() : part.thinking.trim())))
                activity = true;
            emptyFinal = event.message.stopReason === "stop" && !parts.some(part => part.type === "toolCall" || (part.type === "text" && part.text.trim()));
        }
        if (event.message.role === "user" || (event.message.role === "custom" && ![GOAL_CONTEXT, GOAL_BUDGET_CONTEXT, GOAL_LOOP_CONTEXT].includes(event.message.customType))) {
            resetLoop();
            resetEmpty();
        }
        if (event.message.role === "assistant")
            completionBatch = event.message.content.some(part => part.type === "toolCall" && part.name === "update_goal" && part.arguments.status === "complete");
        if (valid(bound, ctx) && event.message.role === "assistant" && event.message.stopReason === "stop" && !event.message.content.some(part => part.type === "toolCall"))
            completedResponse = true;
    });
    pi.on("tool_call", async (event, ctx) => {
        activity = true;
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
        activity = true;
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
                start(ctx, restartAutomatic);
            return;
        }
        const last = [...event.messages].reverse().find(message => message.role === "assistant");
        if (last?.role !== "assistant" || !valid(bound, ctx, true))
            return;
        if (responseOrigin && (responseOrigin.timestamp !== last.timestamp || responseOrigin.ticket?.scheduleId !== bound?.scheduleId))
            return;
        lastFailure = last.stopReason === "error" ? { reason: "error", message: last.errorMessage ?? "Model request failed." }
            : last.stopReason === "length" ? { reason: "length", message: "Pi settled with a truncated response. Use /goal resume to retry." }
                : last.stopReason === "deferred" ? { reason: "deferred", message: "deferred responses are not supported. Pi settled without a normal result. Resolve the response mode, then use /goal resume." } : undefined;
        const record = active(ctx, true);
        if (!record)
            return;
        if (last.stopReason === "aborted" || boundSignal?.aborted) {
            resetEmpty();
            await access.stop("paused", record, ctx);
            return;
        }
        if (last.stopReason !== "stop") {
            resetEmpty();
            return;
        }
        emptyFinal = last.content?.every(part => part.type !== "toolCall" && (part.type !== "text" || !part.text.trim())) ?? false;
        if (last.content?.some(part => part.type === "thinking" && part.thinking.trim()))
            activity = true;
        await finishRun(ctx);
        start(ctx, true);
    });
    pi.on("agent_settled", async (_event, ctx) => {
        // A preceding handler may already have started another session-level run.
        if (!ctx.isIdle())
            return;
        const origin = bound;
        const failure = lastFailure;
        const record = active(ctx, true);
        if (record && valid(origin, ctx, true) && failure) {
            const quota = failure.reason === "error" && isAccountUsageLimit(failure.message);
            // Pinned Codex preserves budget_limited on ordinary errors; only an
            // account usage limit overrides it while the bound turn is in flight.
            if (quota || record.goal.status === "active")
                await access.stop(quota ? "usage_limited" : "blocked", record, ctx);
            const current = access.snapshot();
            if (bound !== origin || origin.runGeneration !== runGeneration || current?.goal?.goalId !== origin.goalId || current.generation !== origin.generation)
                return;
            const diagnosis = failure.reason === "error"
                ? quota ? "The provider reported an account usage or credit limit. Resolve that limit, then use /goal resume."
                    : "The model request failed and Pi finished recovery. Review the provider error, then use /goal resume."
                : failure.message;
            const status = current.goal.status;
            // Provider errors can contain credentials or request data. Do not echo them.
            ctx.ui.notify(status === "budget_limited"
                ? `Goal remains budget_limited after the final ${failure.reason} result. No automatic continuation will start.`
                : `Goal ${status}: ${diagnosis}`, "warning");
        }
        if (bound === origin && lastFailure === failure) {
            lastFailure = undefined;
            bound = undefined;
            boundSignal = undefined;
        }
    });
    pi.on("session_before_compact", event => {
        resetEmpty();
        if (event.reason === "manual")
            recoverySuppressed = false;
        else if (recoverySuppressed)
            return { cancel: true };
    });
    pi.on("session_compact_failed", async (event, ctx) => {
        const record = active(ctx, true);
        if (!record || !valid(bound, ctx, true) || event.reason === "manual")
            return;
        // Cancellation of our suppressed recovery is not a user pause.
        if (event.aborted && compactionFailed)
            return;
        recoverySuppressed = true;
        if (!event.aborted) {
            compactionFailed = true;
            const message = event.errorMessage ?? "Compaction failed.";
            if (!lastFailure || isAccountUsageLimit(message))
                lastFailure = { reason: "error", message };
            return;
        }
        await access.stop("paused", record, ctx);
        ctx.ui.notify("Goal stopped after compaction cancellation. Use /goal resume to retry.", "warning");
    });
    pi.on("input", () => { recoverySuppressed = false; resetEmpty(); });
    pi.on("message_update", event => {
        const update = event.assistantMessageEvent;
        if ((update.type === "text_delta" || update.type === "thinking_delta") && update.delta.trim())
            activity = true;
    });
    pi.on("session_start", (_event, ctx) => { live = true; refresh(ctx); });
    pi.on("model_select", (_event, ctx) => {
        refresh(ctx);
        const capability = goalCapability(ctx);
        if (access.snapshot()?.goal && !capability.supported)
            ctx.ui.notify(`Automatic goal execution ${capability.reason}. Your saved goal is unchanged.`, "warning");
    });
    pi.on("session_shutdown", () => { resetLoop(); resetEmpty(); userDelivered = false; live = false; runGeneration++; pending = undefined; pendingBudget = undefined; edits.clear(); restartRequested = false; internalCancellation = false; });
    pi.on("context", async (event, ctx) => {
        // Follow-up inputs can begin another complete goal turn inside one agent run.
        const finishedGoal = completedResponse && valid(bound, ctx);
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
        // Only undelivered tickets owned by this runtime can cancel a request.
        // Persisted reminders remain history after state changes and reloads.
        const matches = (message, queued) => !!queued && message.role === "custom" && message.details?.scheduleId === queued.scheduleId;
        const staleRequest = last?.role === "custom" && isOwned(last)
            && (matches(last, pending) || matches(last, pendingBudget) || edits.has(last.details?.scheduleId))
            && (!valid(last.details, ctx, last.customType === GOAL_BUDGET_CONTEXT) || (last.customType !== GOAL_BUDGET_CONTEXT && !runnable(ctx)));
        const continuation = pending && runnable(ctx) && valid(pending, ctx) && owned.some(message => matches(message, pending)) ? pending : undefined;
        if (continuation) {
            automaticRun = !!continuation.automatic && !userDelivered;
            activity = false;
            emptyFinal = false;
        }
        if (owned.some(message => matches(message, pending)))
            pending = undefined;
        if (owned.some(message => matches(message, pendingBudget)))
            pendingBudget = undefined;
        for (const message of owned)
            if (message.role === "custom")
                edits.delete(message.details?.scheduleId);
        // Delivery retires ticket authority, not persisted history. Keep the same
        // prefix on retries and native checkpoint replay, including mixed user batches.
        const messages = event.messages;
        const protectUser = userDelivered;
        userDelivered = false;
        if (loopWarning && valid(loopWarning, ctx) && messages.some(message => message.role === "custom" && message.customType === GOAL_LOOP_CONTEXT && message.details?.scheduleId === loopWarning.scheduleId))
            warningDelivered = true;
        if (staleRequest && !protectUser) {
            // The edited turn may have finished inside this same low-level run.
            // Its stale queued predecessor must not consume the new goal's continuation.
            if (finishedGoal && active(ctx)) {
                restartRequested = true;
                restartAutomatic = true;
            }
            internalCancellation = true;
            // Retain the failed recovery's ownership while retiring only our queued work.
            if (!compactionFailed)
                bound = undefined;
            ctx.abort();
        }
        else {
            runEnded = false;
            lastFailure = undefined;
            compactionFailed = false;
            const record = active(ctx) ?? (valid(bound, ctx, true) ? active(ctx, true) : undefined);
            bound = record ? ticket(record) : undefined;
            boundSignal = ctx.signal;
            modelGeneration = runGeneration;
            if (record?.goal?.status === "active")
                editedPending = false;
        }
        return { messages };
    });
    return { start, refresh,
        budget: (ctx) => {
            const record = active(ctx, true);
            if ((pending && runEnded) || record?.goal?.status !== "budget_limited" || !valid(bound, ctx, true) || ctx.isIdle() || budgetNotified === record.goal.goalId)
                return;
            budgetNotified = record.goal.goalId;
            pendingBudget = ticket(record);
            pi.sendMessage({ customType: GOAL_BUDGET_CONTEXT, content: renderGoalPrompt(record.goal, false, true), display: false, details: pendingBudget }, { deliverAs: "steer" });
        },
        suspend: (ctx) => { suspended = true; runGeneration++; restartRequested = false; if (ctx)
            refresh(ctx); },
        resume: (ctx, edited = false) => {
            restartAutomatic = false;
            resetEmpty();
            suspended = false;
            editedPending = edited;
            recoverySuppressed = false;
            refresh(ctx);
            const record = runnable(ctx);
            if (edited && record) {
                restartRequested = false;
                const update = ticket(record);
                edits.set(update.scheduleId, update);
                pi.sendMessage({ customType: GOAL_CONTEXT, content: renderGoalPrompt(record.goal, true), display: false, details: update }, { deliverAs: "steer", triggerTurn: true });
            }
            else
                start(ctx);
        },
        invalidate: () => { resetLoop(); resetEmpty(); runGeneration++; completedResponse = false; failedRuns = 0; failedBash = false; successfulTool = false; lastFailure = undefined; compactionFailed = false; },
        adopt: (ctx) => { suspended = false; const record = active(ctx); bound = record ? ticket(record) : undefined; modelGeneration = runGeneration; },
        assertModelGoal: (ctx) => { if (modelGeneration !== runGeneration || (bound && !valid(bound, ctx, true)))
            throw new Error("Stale goal tool invocation."); },
    };
}
//# sourceMappingURL=scheduler.js.map