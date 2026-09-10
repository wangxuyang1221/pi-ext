import { createHash, randomUUID } from "node:crypto";
/** Pi input already excludes cache reads and output already contains reasoning. */
export function goalTokens(usage) {
    if (!usage || typeof usage !== "object")
        return;
    const { input, output } = usage;
    if (typeof input !== "number" || typeof output !== "number" || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0 || !Number.isSafeInteger(input + output))
        return;
    return input + output;
}
const identity = (message) => createHash("sha256").update(JSON.stringify(message.responseId ? [message.provider, message.responseId] : [message.provider, message.model, message.timestamp, message.content, message.stopReason])).digest("hex");
/** Attribute finalized responses to the goal bound before that request, not the latest goal. */
export function registerGoalAccounting(pi, access) {
    let live = false;
    let source;
    let request;
    let wrapOpen = false;
    let compaction;
    let branchSummary;
    const starts = new Map();
    const seen = new Set();
    const matches = (candidate, record = access.snapshot()) => !!candidate && !!record?.goal && record.ownerSessionId === candidate.ownerSessionId && record.goal.goalId === candidate.goalId && record.generation === candidate.generation;
    const eligible = (record) => record?.goal?.status === "active" || record?.goal?.status === "budget_limited";
    const flush = async (candidate, ctx) => {
        const record = access.snapshot();
        if (!live || !matches(candidate, record) || !eligible(record) || record.ownerSessionId !== ctx.sessionManager.getSessionId())
            return;
        const checkpoint = record.goal.usageCheckpoint;
        if (checkpoint?.sourceId === candidate.sourceId && checkpoint.tokens === candidate.tokens && checkpoint.missing === candidate.missing && checkpoint.lastReceipt === candidate.lastReceipt)
            return;
        if (!candidate.tokens && !candidate.missing && !candidate.lastReceipt)
            return;
        try {
            await access.account(record, candidate, ctx);
        }
        catch (error) {
            if (live && matches(candidate) && access.snapshot()?.ownerSessionId === ctx.sessionManager.getSessionId())
                access.error(error, ctx);
        }
    };
    const capture = () => {
        const record = access.snapshot();
        if (!eligible(record) || (record.goal.status === "budget_limited" && !wrapOpen))
            return;
        if (!matches(source, record)) {
            if (record.goal.status !== "active")
                return;
            source = { sourceId: randomUUID(), tokens: 0, missing: false, goalId: record.goal.goalId, generation: record.generation, ownerSessionId: record.ownerSessionId };
        }
        return source;
    };
    const recordUsage = async (candidate, key, usage, ctx) => {
        if (seen.has(key))
            return;
        seen.add(key);
        if (!matches(candidate) || !eligible(access.snapshot()))
            return;
        const tokens = goalTokens(usage);
        const cache = usage;
        // The native adapter initializes zero usage even if the terminal response has
        // no usage. A zero object alone cannot establish exact zero consumption.
        if (tokens === undefined || (tokens === 0 && !cache?.cacheRead && !cache?.cacheWrite)) {
            if (!candidate.missing)
                ctx.ui.notify("Goal usage is incomplete: a response has missing, invalid, or unverified zero usage. Reported tokens are only the observed usage, not an exact total.", "warning");
            candidate.missing = true;
        }
        else
            candidate.tokens += tokens;
        candidate.lastReceipt = key;
        await flush(candidate, ctx);
    };
    pi.on("session_start", (_event, ctx) => {
        live = true;
        const receipt = access.snapshot()?.goal?.usageCheckpoint?.lastReceipt;
        if (receipt)
            seen.add(receipt);
        // One history pass at startup; never scan history or write on streaming deltas.
        for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type === "message" && entry.message.role === "assistant")
                seen.add(identity(entry.message));
            else if (entry.type === "compaction")
                seen.add(`compaction:${entry.id}`);
            else if (entry.type === "branch_summary")
                seen.add(`branch-summary:${entry.id}`);
        }
    });
    pi.on("session_shutdown", () => { live = false; source = undefined; request = undefined; compaction = undefined; branchSummary = undefined; wrapOpen = false; starts.clear(); seen.clear(); });
    pi.on("agent_settled", () => { wrapOpen = false; request = undefined; starts.clear(); });
    pi.on("context", async (_event, ctx) => {
        await flush(source, ctx);
        const record = access.snapshot();
        if (!live || record?.ownerSessionId !== ctx.sessionManager.getSessionId() || !eligible(record)) {
            request = undefined;
            return;
        }
        if (record.goal.status === "budget_limited" && !wrapOpen) {
            request = undefined;
            return;
        }
        if (record.goal.status === "active")
            wrapOpen = true;
        request = capture();
    });
    pi.on("message_start", event => { if (event.message.role === "assistant")
        starts.set(event.message.timestamp, request); });
    pi.on("message_end", async (event, ctx) => {
        if (!live || event.message.role !== "assistant")
            return;
        const message = event.message;
        const candidate = starts.get(message.timestamp);
        await recordUsage(candidate, identity(message), message.usage, ctx);
        if (message.stopReason !== "error" && message.stopReason !== "aborted" && !ctx.signal?.aborted)
            access.budget(ctx);
    });
    pi.on("session_before_compact", () => { compaction = capture(); });
    pi.on("session_compact", async (event, ctx) => {
        await recordUsage(compaction, `compaction:${event.compactionEntry.id}`, event.compactionEntry.usage, ctx);
        compaction = undefined;
        access.budget(ctx);
    });
    pi.on("session_compact_failed", async (_event, ctx) => {
        await recordUsage(compaction, `compaction-failed:${randomUUID()}`, undefined, ctx);
        compaction = undefined;
    });
    pi.on("session_before_tree", event => { branchSummary = event.preparation.userWantsSummary ? capture() : undefined; });
    pi.on("session_tree", async (event, ctx) => {
        if (event.summaryEntry)
            await recordUsage(branchSummary, `branch-summary:${event.summaryEntry.id}`, event.summaryEntry.usage, ctx);
        branchSummary = undefined;
    });
    return { checkpoint: (ctx) => flush(source, ctx) };
}
//# sourceMappingURL=accounting.js.map