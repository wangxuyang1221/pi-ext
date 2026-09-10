import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GoalContent } from "./content.js";
import { open, stat, readFile } from "node:fs/promises";
import { goalCapability } from "./capability.js";
import { resolveGoalBudget } from "./budget.js";
import { registerGoalAccounting } from "./accounting.js";
import { registerChildAccounting } from "./children.js";
import { GoalStore } from "./storage.js";
import { registerGoalTools } from "./tools.js";
import { GOAL_LOOP_PAUSED, registerGoalScheduler } from "./scheduler.js";
export const GOAL_MIRROR = "pi-ext-goal";
const safe = (text) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
function owner(ctx) {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile)
        throw new Error("Goal requires a persistent session. Restart Pi without --no-session.");
    return { ownerSessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, sessionFile };
}
function summary(record, expanded) {
    const goal = record?.goal;
    if (!goal)
        return "No goal set. Use /goal <objective> or /goal-recover.";
    const preview = expanded === undefined ? "" : `${safe([...expanded].slice(0, 1000).join(""))}${[...expanded].length > 1000 ? "\n[Preview truncated. Use /goal edit for the full objective.]" : ""}\nAttachments: ${goal.content?.attachments.length ?? 0}\n`;
    return `Goal: ${goal.status}\n${preview}${safe(goal.objective)}\nElapsed: ${goal.elapsedSeconds}s | Tokens used: ${goal.tokensUsed}${goal.tokenBudget === undefined ? "" : ` | Budget: ${goal.tokenBudget} | Remaining: ${Math.max(0, goal.tokenBudget - goal.tokensUsed)}`}\n${goal.usageIncomplete ? "Usage is incomplete; tokens shown are observed usage only.\n" : ""}${goal.pauseReason === "repeated_tool_calls" ? `${GOAL_LOOP_PAUSED}\n` : ""}${record.continuationDeferral ? "Automatic continuation deferred until an explicit user turn or resume.\n" : ""}Commands: /goal <objective>, /goal edit, /goal pause, /goal resume, /goal clear, /goal-recover, /goal-fork`;
}
/** Register persistent goal controls and execution. The store is injectable for isolated tests. */
export function registerGoal(pi, store, options = {}) {
    const content = new GoalContent(join(store.root, "content"), options.temporaryRoot ?? tmpdir());
    let config = options.config === undefined ? {} : options.config;
    let configError;
    const budgetFor = (budget) => {
        if (configError)
            throw configError;
        return resolveGoalBudget(budget, config);
    };
    let lease;
    let epoch = 0;
    let live = false;
    let sessionId;
    let resumeCandidate;
    let resumeDialog;
    const requireExecution = (ctx) => {
        const capability = goalCapability(ctx);
        if (!capability.supported)
            throw new Error(`Goal execution ${capability.reason}.`);
    };
    const syncTools = (ctx) => {
        const mutable = ["create_goal", "update_goal"];
        const current = pi.getActiveTools();
        const next = current.filter(name => !mutable.includes(name));
        if (goalCapability(ctx).supported)
            next.push(...mutable);
        if (JSON.stringify(next) !== JSON.stringify(current))
            pi.setActiveTools(next);
    };
    const assertCurrent = (ctx) => {
        if (!live || ctx.sessionManager.getSessionId() !== sessionId)
            throw new Error("Stale goal session context.");
    };
    let busy = false;
    let mirrorDirty = false;
    const report = (ctx, error) => ctx.ui.notify(`Goal storage error: ${safe(error instanceof Error ? error.message : String(error))}`, "error");
    const commit = async (ctx, expected, work) => {
        try {
            return await work();
        }
        catch (error) {
            // A stale operation must not suspend a newer goal or session.
            const current = lease?.snapshot;
            if (live && ctx.sessionManager.getSessionId() === sessionId && current?.recordId === expected.recordId && current.revision === expected.revision)
                scheduler.suspend(ctx);
            throw error;
        }
    };
    const mirror = (ctx) => {
        assertCurrent(ctx);
        const record = lease?.snapshot;
        scheduler.refresh(ctx);
        children.refresh();
        if (!record || record.revision === 0)
            return;
        const entries = ctx.sessionManager.getEntries();
        const found = entries.some(entry => entry.type === "custom" && entry.customType === GOAL_MIRROR
            && entry.data?.recordId === record.recordId
            && entry.data?.revision === record.revision);
        if (found && !mirrorDirty)
            return;
        try {
            pi.appendEntry(GOAL_MIRROR, record);
            mirrorDirty = false;
        }
        catch {
            mirrorDirty = true;
            ctx.ui.notify("Goal saved, but the session history mirror failed. It will be retried at the next safe checkpoint.", "warning");
        }
    };
    const bind = async (ctx, create) => {
        assertCurrent(ctx);
        const identity = owner(ctx);
        if (lease) {
            if (lease.snapshot.ownerSessionId !== identity.ownerSessionId)
                throw new Error("Stale goal session context.");
            return;
        }
        const started = epoch;
        if (!create) {
            const records = await store.records();
            if (started !== epoch)
                throw new Error("Goal session changed during binding.");
            if (!records.some(record => record.ownerSessionId === identity.ownerSessionId))
                return;
        }
        const opened = await store.openSession(identity, () => {
            assertCurrent(ctx);
            if (started !== epoch)
                throw new Error("Stale goal session context.");
        });
        if (started !== epoch) {
            await opened.close();
            throw new Error("Goal session changed during binding.");
        }
        lease = opened;
        mirror(ctx);
    };
    pi.on("session_start", async (event, ctx) => {
        epoch++;
        live = true;
        sessionId = ctx.sessionManager.getSessionId();
        syncTools(ctx);
        try {
            if (options.configPath) {
                try {
                    config = JSON.parse(await readFile(options.configPath, "utf8"));
                }
                catch (error) {
                    if (error.code !== "ENOENT")
                        throw error;
                    config = {};
                }
            }
            resolveGoalBudget(undefined, config);
            configError = undefined;
        }
        catch (error) {
            configError = error;
            ctx.ui.notify(`Goal configuration error: ${safe(error instanceof Error ? error.message : String(error))}. Goal creation is disabled until configuration is fixed and reloaded.`, "error");
        }
        if (ctx.mode !== "tui" || !ctx.sessionManager.getSessionFile())
            return;
        try {
            await bind(ctx, false);
            await children.start(ctx);
            const saved = lease?.snapshot;
            const goal = saved?.goal;
            resumeCandidate = event.reason !== "reload" && event.reason !== "fork" && ctx.hasUI && goalCapability(ctx).supported && goal
                && ["paused", "blocked", "usage_limited"].includes(goal.status)
                && (goal.tokenBudget === undefined || goal.tokensUsed < goal.tokenBudget) ? saved : undefined;
        }
        catch (error) {
            report(ctx, error);
        }
    });
    const resumeGoal = async (ctx, expected) => {
        assertCurrent(ctx);
        requireExecution(ctx);
        await children.checkpoint(ctx);
        await accounting.checkpoint(ctx);
        assertCurrent(ctx);
        requireExecution(ctx);
        const current = lease?.snapshot;
        if (!current?.goal || current.recordId !== expected.recordId || current.goal.goalId !== expected.goal?.goalId || current.goal.activation !== expected.goal?.activation)
            throw new Error("Stale goal resume rejected.");
        scheduler.invalidate();
        await commit(ctx, current, () => lease.control("resume", current));
        mirror(ctx);
        ctx.ui.notify(`Goal ${lease.snapshot.goal.status}.`, "info");
        scheduler.resume(ctx);
    };
    pi.on("resources_discover", async (_event, ctx) => {
        const candidate = resumeCandidate;
        resumeCandidate = undefined;
        if (!candidate || !goalCapability(ctx).supported)
            return;
        const controller = new AbortController();
        resumeDialog = controller;
        const started = epoch;
        try {
            const accepted = await ctx.ui.confirm("Resume saved goal?", `The saved goal is ${candidate.goal.status}. Resume it and continue working?`, { signal: controller.signal });
            if (!accepted || controller.signal.aborted || started !== epoch || busy || !goalCapability(ctx).supported)
                return;
            assertCurrent(ctx);
            const saved = await store.read(candidate.recordId);
            if (started !== epoch || !saved?.goal || saved.ownerSessionId !== sessionId || saved.revision !== candidate.revision || saved.goal.goalId !== candidate.goal.goalId || saved.goal.status !== candidate.goal.status || (saved.goal.tokenBudget !== undefined && saved.goal.tokensUsed >= saved.goal.tokenBudget))
                return;
            busy = true;
            try {
                await resumeGoal(ctx, saved);
            }
            finally {
                busy = false;
            }
        }
        catch (error) {
            if (started === epoch)
                report(ctx, error);
        }
        finally {
            if (resumeDialog === controller)
                resumeDialog = undefined;
        }
    });
    pi.on("session_shutdown", async (_event, ctx) => {
        resumeCandidate = undefined;
        resumeDialog?.abort();
        resumeDialog = undefined;
        try {
            await children.stop(ctx);
        }
        catch (error) {
            report(ctx, error);
        }
        if (live && lease) {
            try {
                await accounting.checkpoint(ctx);
                await lease.checkpoint(lease.snapshot);
            }
            catch (error) {
                report(ctx, error);
            }
        }
        epoch++;
        live = false;
        sessionId = undefined;
        const previous = lease;
        lease = undefined;
        await previous?.close();
    });
    pi.on("model_select", (_event, ctx) => { syncTools(ctx); });
    pi.on("agent_settled", async (_event, ctx) => {
        if (live && lease && !busy) {
            try {
                await children.checkpoint(ctx);
                await accounting.checkpoint(ctx);
                await commit(ctx, lease.snapshot, () => lease.checkpoint(lease.snapshot));
                mirror(ctx);
            }
            catch (error) {
                report(ctx, error);
            }
            lease?.setBudgetInFlight(false);
        }
    });
    pi.on("input", async (event, ctx) => {
        if (!live || ctx.mode !== "tui" || event.source !== "interactive" || !lease?.snapshot.continuationDeferral)
            return;
        assertCurrent(ctx);
        const started = epoch;
        try {
            await lease.releaseDeferral(lease.snapshot);
            if (started === epoch)
                mirror(ctx);
        }
        catch (error) {
            if (started === epoch)
                report(ctx, error);
            // Do not consume the user's input. A failed write keeps the saved gate.
        }
    });
    const command = (handler) => async (args, ctx) => {
        assertCurrent(ctx);
        if (ctx.mode !== "tui") {
            ctx.ui.notify("Goal commands are available only in interactive TUI mode.", "warning");
            return;
        }
        if (busy) {
            ctx.ui.notify("Another goal operation is in progress.", "warning");
            return;
        }
        busy = true;
        const started = epoch;
        try {
            await children.checkpoint(ctx);
            await accounting.checkpoint(ctx);
            await handler(args.trim(), ctx, started);
        }
        catch (error) {
            if (started !== epoch)
                throw error;
            report(ctx, error);
        }
        finally {
            busy = false;
        }
    };
    pi.registerCommand("goal-fork", {
        description: "Fork or clone with an independent copy of the current goal",
        handler: command(async (_args, ctx, started) => {
            await bind(ctx, false);
            if (started !== epoch)
                return;
            if (!lease?.snapshot.goal) {
                ctx.ui.notify("No goal to inherit. Use /goal <objective> first.", "info");
                return;
            }
            const choice = await ctx.ui.select("Inherit current goal", ["Fork from a historical user message", "Clone the current position"]);
            if (choice === undefined || started !== epoch)
                return;
            const position = choice === "Clone the current position" ? "at" : "before";
            let entryId;
            let editorText;
            if (position === "before") {
                const entries = ctx.sessionManager.getEntries().flatMap(entry => {
                    if (entry.type !== "message" || entry.message.role !== "user")
                        return [];
                    const content = entry.message.content;
                    const text = typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text).join("");
                    return [{ id: entry.id, text }];
                });
                if (!entries.length) {
                    ctx.ui.notify("No historical user messages to fork from.", "info");
                    return;
                }
                const labels = entries.map(entry => `${entry.id} | ${safe(entry.text).replace(/\s+/g, " ").slice(0, 120)}`);
                const selected = await ctx.ui.select("Fork before user message", labels);
                if (selected === undefined || started !== epoch)
                    return;
                const entry = entries[labels.indexOf(selected)];
                if (!entry)
                    return;
                entryId = entry.id;
                editorText = entry.text;
            }
            await ctx.waitForIdle();
            if (started !== epoch || !lease)
                return;
            const snapshot = await lease.checkpoint(lease.snapshot);
            if (started !== epoch)
                return;
            mirror(ctx);
            if (position === "at")
                entryId = ctx.sessionManager.getLeafId() ?? undefined;
            if (!entryId) {
                ctx.ui.notify("No session entry to clone yet.", "warning");
                return;
            }
            try {
                const result = await ctx.fork(entryId, {
                    position,
                    withSession: async (fresh) => {
                        // Only plain snapshot data and the session-independent store survive
                        // shutdown. Never use the old pi, ctx, or lease after replacement.
                        let child;
                        try {
                            const identity = owner(fresh);
                            child = await store.openSession(identity, () => {
                                if (owner(fresh).ownerSessionId !== identity.ownerSessionId)
                                    throw new Error("Goal session changed during inheritance.");
                            });
                            await child.inherit(snapshot);
                        }
                        catch (error) {
                            fresh.ui.notify(`Goal inheritance failed. The source goal is unchanged; this session has no confirmed inherited goal. ${safe(error instanceof Error ? error.message : String(error))}`, "error");
                            return;
                        }
                        finally {
                            await child?.close();
                        }
                        if (editorText !== undefined)
                            fresh.ui.setEditorText(editorText);
                        fresh.ui.notify("Goal inherited with saved statistics. Automatic continuation is deferred until you explicitly start a turn or resume the goal.", "info");
                        await fresh.reload();
                    },
                });
                if (result.cancelled && started === epoch)
                    ctx.ui.notify("Goal inheritance cancelled. The source goal is unchanged.", "info");
            }
            catch (error) {
                throw new Error(`Goal inheritance failed. The source goal is unchanged. ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
    });
    pi.registerCommand("goal-recover", {
        description: "Recover a saved goal for this project",
        handler: command(async (_args, ctx, started) => {
            owner(ctx);
            const choices = await store.recoverable(ctx.cwd);
            if (!choices.length) {
                ctx.ui.notify("No recoverable goals in this project. Goals held by another writer are excluded.", "info");
                return;
            }
            const labels = choices.map(record => `${record.recordId.slice(0, 12)} | ${record.goal.status} | ${safe(record.goal.objective).replace(/\s+/g, " ").slice(0, 120)}`);
            const selected = await ctx.ui.select("Recover goal", labels);
            if (selected === undefined || started !== epoch)
                return;
            const chosen = choices[labels.indexOf(selected)];
            if (!chosen)
                return;
            // Re-read after selection; the UI snapshot is never authoritative.
            const latest = await store.read(chosen.recordId);
            if (!latest || latest.revision !== chosen.revision)
                throw new Error("Stale recovery selection. Open /goal-recover again.");
            let exists = false;
            try {
                exists = (await stat(latest.sessionFile)).isFile();
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw error;
            }
            if (exists) {
                const file = await open(latest.sessionFile, "r");
                let header;
                try {
                    const buffer = Buffer.alloc(65536);
                    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
                    header = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0]);
                }
                finally {
                    await file.close();
                }
                if (header.id !== latest.ownerSessionId || header.cwd !== latest.cwd)
                    throw new Error("Saved session identity does not match the goal record. Repair the authoritative record before recovery.");
                await ctx.switchSession(latest.sessionFile, { withSession: async (fresh) => {
                        fresh.ui.notify("Saved session opened. Use /goal to inspect its goal. No model request was started.", "info");
                    } });
                return;
            }
            if (!await ctx.ui.confirm("Recover goal without conversation?", "The original session file is missing. This can recover the goal and saved statistics, but cannot restore the unsaved conversation or undo file and database changes. Take over this record in a new persistent session?"))
                return;
            if (started !== epoch)
                return;
            // setup runs after replacement and before withSession in both supported
            // versions. Commit to the same record, release it, then bind on reload.
            let recoveryError;
            await ctx.newSession({
                setup: async (manager) => {
                    try {
                        const sessionFile = manager.getSessionFile();
                        if (!sessionFile)
                            throw new Error("Recovery requires a persistent replacement session.");
                        const recovered = await store.takeover(latest, { ownerSessionId: manager.getSessionId(), cwd: manager.getCwd(), sessionFile });
                        await recovered.close();
                    }
                    catch (error) {
                        recoveryError = error;
                    }
                },
                withSession: async (fresh) => {
                    if (recoveryError) {
                        report(fresh, recoveryError);
                        return;
                    }
                    fresh.ui.notify("Goal recovered with saved statistics. No model request was started.", "info");
                    await fresh.reload();
                },
            });
        }),
    });
    const saveObjective = async (text, expected, ctx, started, editing) => {
        requireExecution(ctx);
        const selected = [];
        for (const candidate of content.candidates(text)) {
            const choice = await ctx.ui.select(`Persist pasted image? ${candidate}`, ["Copy attachment", "Keep as text", "Cancel"]);
            if (choice === undefined || choice === "Cancel" || started !== epoch)
                return false;
            if (choice === "Copy attachment")
                selected.push(candidate);
        }
        const prepared = await content.prepare(text.trim(), selected, editing ? expected.goal : undefined);
        let saved = false;
        try {
            assertCurrent(ctx);
            if (started !== epoch || !lease)
                throw new Error("Stale goal content operation.");
            requireExecution(ctx);
            scheduler.invalidate();
            await commit(ctx, expected, () => editing
                ? lease.control("edit", expected, prepared.objective, prepared.content)
                : lease.replace(prepared.objective, expected, budgetFor(), prepared.content));
            saved = true;
            return true;
        }
        finally {
            if (!saved && prepared.content) {
                // An fsync error after rename is an uncertain commit. Retain content
                // whenever authority cannot prove this draft was not published.
                let unused = false;
                try {
                    unused = (await store.read(expected.recordId))?.goal?.content?.bundleId !== prepared.content.bundleId;
                }
                catch { /* Retain. */ }
                if (unused)
                    await content.discard(prepared);
            }
        }
    };
    pi.registerCommand("goal", {
        description: "Create, inspect, edit, pause, resume, or clear a goal",
        handler: command(async (args, ctx, started) => {
            if (args && !["pause", "clear"].includes(args.toLowerCase()))
                requireExecution(ctx);
            await bind(ctx, args.length > 0);
            if (started !== epoch)
                return;
            if (!args) {
                mirror(ctx);
                const record = lease?.snapshot;
                const expanded = record?.goal?.content ? await content.expand(record.goal) : undefined;
                if (started === epoch)
                    ctx.ui.notify(summary(record, expanded), "info");
                return;
            }
            if (!lease)
                throw new Error("Goal could not bind to this session.");
            const expected = lease.snapshot;
            if (args.toLowerCase() === "clear") {
                scheduler.invalidate();
                await commit(ctx, expected, () => lease.clear(expected));
                if (started !== epoch)
                    return;
                mirror(ctx);
                ctx.ui.notify("Goal cleared.", "info");
                return;
            }
            const control = args.toLowerCase();
            if (control === "edit" || control === "pause" || control === "resume") {
                if (!expected.goal) {
                    ctx.ui.notify("No goal set.", "info");
                    return;
                }
                const objective = control === "edit" ? await ctx.ui.editor("Edit goal", await content.expand(expected.goal)) : undefined;
                if (started !== epoch || (control === "edit" && objective === undefined))
                    return;
                if (control === "resume") {
                    await resumeGoal(ctx, expected);
                    return;
                }
                if (control === "edit") {
                    if (!await saveObjective(objective, expected, ctx, started, true))
                        return;
                }
                else {
                    scheduler.invalidate();
                    await commit(ctx, expected, () => lease.control(control, expected));
                }
                if (started !== epoch)
                    return;
                mirror(ctx);
                ctx.ui.notify(`Goal ${control === "edit" ? "updated" : lease.snapshot.goal.status}.`, "info");
                if (control !== "pause")
                    scheduler.resume(ctx, control === "edit");
                return;
            }
            if (expected.goal && expected.goal.status !== "complete") {
                if (!await ctx.ui.confirm("Replace current goal?", "The new goal will reset the saved time and token counts."))
                    return;
            }
            if (started !== epoch || !lease)
                return;
            if (!await saveObjective(args, expected, ctx, started, false))
                return;
            if (started !== epoch)
                return;
            mirror(ctx);
            ctx.ui.notify("Goal saved.", "info");
            scheduler.resume(ctx);
        }),
    });
    const accounting = registerGoalAccounting(pi, {
        snapshot: () => lease?.snapshot,
        account: async (expected, usage, ctx) => {
            assertCurrent(ctx);
            if (!lease)
                throw new Error("Goal lease is unavailable.");
            lease.setBudgetInFlight(!ctx.isIdle());
            await commit(ctx, expected, () => lease.account(expected, usage));
            mirror(ctx);
        },
        budget: ctx => scheduler.budget(ctx),
        error: (error, ctx) => { scheduler.suspend(ctx); report(ctx, error); },
    });
    const children = registerChildAccounting(pi, {
        snapshot: () => lease?.snapshot,
        busy: () => busy,
        subscribe: async (expected, source, ctx) => {
            assertCurrent(ctx);
            if (!lease)
                throw new Error("Goal lease is unavailable.");
            await commit(ctx, expected, () => lease.subscribeChild(expected, source));
            mirror(ctx);
        },
        account: async (expected, usage, ctx) => {
            assertCurrent(ctx);
            if (!lease)
                throw new Error("Goal lease is unavailable.");
            if (expected.goal?.status === "active")
                lease.setBudgetInFlight(!ctx.isIdle());
            await commit(ctx, expected, () => lease.accountChild(expected, usage));
            mirror(ctx);
        },
        budget: ctx => scheduler.budget(ctx),
        error: (error, ctx) => { scheduler.suspend(ctx); report(ctx, error); },
    });
    pi.on("context", async (_event, ctx) => { await children.checkpoint(ctx); });
    const scheduler = registerGoalScheduler(pi, {
        snapshot: () => lease?.snapshot,
        checkpoint: async (expected, ctx) => {
            assertCurrent(ctx);
            if (!lease)
                throw new Error("Goal lease is unavailable.");
            return commit(ctx, expected, () => lease.checkpoint(expected));
        },
        stop: async (status, expected, ctx, reason) => {
            assertCurrent(ctx);
            if (!lease)
                return;
            if (status !== "paused" && status !== "blocked" && status !== "usage_limited")
                throw new Error("Invalid runtime stop state.");
            await children.checkpoint(ctx);
            await accounting.checkpoint(ctx);
            assertCurrent(ctx);
            const current = lease.snapshot;
            if (current.goal?.goalId !== expected.goal?.goalId || current.generation !== expected.generation || current.goal?.activation !== expected.goal?.activation)
                return;
            await commit(ctx, current, () => reason === "repeated_tool_calls" && current.goal?.status === "active"
                ? lease.pauseForLoop(current)
                : lease.control(status === "paused" ? "pause" : status, current));
            mirror(ctx);
        },
    });
    registerGoalTools(pi, {
        get: async (ctx) => {
            assertCurrent(ctx);
            if (!goalCapability(ctx).supported)
                return (await store.records()).find(record => record.ownerSessionId === ctx.sessionManager.getSessionId());
            await bind(ctx, false);
            await children.checkpoint(ctx);
            return lease ? lease.checkpoint(lease.snapshot) : undefined;
        },
        create: async (ctx, objective, budget) => {
            assertCurrent(ctx);
            requireExecution(ctx);
            scheduler.assertModelGoal(ctx);
            await bind(ctx, true);
            requireExecution(ctx);
            scheduler.assertModelGoal(ctx);
            if (!lease)
                throw new Error("Goal could not bind to this session.");
            const expected = lease.snapshot;
            if (expected.goal && expected.goal.status !== "complete")
                throw new Error("Cannot create a new goal because this thread has an unfinished goal; complete the existing goal first.");
            const saved = await commit(ctx, expected, () => lease.replace(objective, expected, budgetFor(budget)));
            scheduler.invalidate();
            scheduler.adopt(ctx);
            mirror(ctx);
            return saved;
        },
        update: async (ctx, status) => {
            assertCurrent(ctx);
            requireExecution(ctx);
            scheduler.assertModelGoal(ctx);
            if (!lease)
                throw new Error("Cannot update goal because this thread has no goal.");
            await children.checkpoint(ctx);
            await accounting.checkpoint(ctx);
            requireExecution(ctx);
            scheduler.assertModelGoal(ctx);
            const expected = lease.snapshot;
            const saved = await commit(ctx, expected, () => lease.control(status === "paused" ? "pause" : status, expected));
            scheduler.invalidate();
            mirror(ctx);
            return saved;
        },
    });
}
export default function goalExtension(pi) {
    if (process.env.PI_SUBAGENT_PARENT)
        return;
    registerGoal(pi, new GoalStore(join(getAgentDir(), "goals")), { configPath: join(getAgentDir(), "goal.json") });
}
//# sourceMappingURL=index.js.map