import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GoalContent } from "./content.js";
import { open, stat, readFile } from "node:fs/promises";
import { goalCapability } from "./capability.js";
import { resolveGoalBudget } from "./budget.js";
import { registerGoalAccounting } from "./accounting.js";
import { registerChildAccounting } from "./children.js";
import { GoalCommitPublishedError, GoalStore, type GoalLease, type GoalRecord, type Owner } from "./storage.js";
import { registerGoalTools } from "./tools.js";
import { GOAL_LOOP_PAUSED, registerGoalScheduler } from "./scheduler.js";
import { GoalPresentation, GOAL_DISPLAY_EVENT, GOAL_DISPLAY_REQUEST, formatGoalSeconds } from "./presentation.js";
import { GoalDetails, type GoalDetailAction } from "./details.js";

export const GOAL_MIRROR = "pi-ext-goal";
const GOAL_TOOL_STATE = "pi-ext-goal-tools";
const REQUIRED_TOOLS = ["create_goal", "get_goal", "update_goal"];
const safe = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
function owner(ctx: ExtensionContext): Owner {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) throw new Error("Goal requires a persistent session. Restart Pi without --no-session.");
  return { ownerSessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, sessionFile };
}
function summary(record?: GoalRecord, expanded?: string, elapsedSeconds?: number): string {
  const goal = record?.goal;
  if (!goal) return "No goal set. Use /goal <objective> or /goal-recover.";
  const objective = expanded ?? goal.objective;
  const preview = `${safe([...objective].slice(0, 1000).join(""))}${[...objective].length > 1000 ? "\n[Preview truncated. Use /goal edit for the full objective.]" : ""}\nAttachments: ${goal.content?.attachments.length ?? 0}\n`;
  return `Goal: ${goal.status}\n${preview}Elapsed: ${formatGoalSeconds(elapsedSeconds ?? goal.elapsedSeconds)} | Tokens used: ${goal.tokensUsed}${goal.tokenBudget === undefined ? "" : ` | Budget: ${goal.tokenBudget} | Remaining: ${Math.max(0, goal.tokenBudget - goal.tokensUsed)}`}\n${goal.usageIncomplete ? "Usage is incomplete; tokens shown are observed usage only.\n" : ""}${goal.pauseReason === "repeated_tool_calls" ? `${GOAL_LOOP_PAUSED}\n` : ""}${goal.toolRecoveryRequired ? "Automatic continuation requires restored goal tools and explicit /goal resume.\n" : ""}${record.continuationDeferral ? "Automatic continuation deferred until an explicit user turn or resume.\n" : ""}Commands: /goal <objective>, /goal edit, /goal pause, /goal resume, /goal clear, /goal-recover, /goal-fork`;
}

/** Register persistent goal controls and execution. The store is injectable for isolated tests. */
export function registerGoal(pi: ExtensionAPI, store: GoalStore, options: { config?: unknown; configPath?: string; temporaryRoot?: string } = {}): void {
  const content = new GoalContent(join(store.root, "content"), options.temporaryRoot ?? tmpdir());
  let config: unknown = options.config === undefined ? {} : options.config;
  let configError: unknown;
  const budgetFor = (budget?: number) => {
    if (configError) throw configError;
    return resolveGoalBudget(budget, config);
  };
  let lease: GoalLease | undefined;
  let displayContext: ExtensionContext | undefined;
  let displayLimitation = "";
  const presentation = new GoalPresentation({
    readTiming: () => lease?.displayTiming,
    expand: goal => content.expand(goal),
    publish: display => {
      pi.events?.emit(GOAL_DISPLAY_EVENT, display);
      displayContext?.ui.setStatus("goal", display ? `Goal: ${display.summary} · ${display.objective}` : undefined);
    },
  });
  let displayUnsubscribe: (() => void) | undefined;
  let panelToken: symbol | undefined;
  let closePanel: (() => void) | undefined;
  let epoch = 0;
  let live = false;
  let sessionId: string | undefined;
  let resumeCandidate: GoalRecord | undefined;
  let resumeDialog: AbortController | undefined;
  const requireExecution = (ctx: ExtensionContext) => {
    const capability = goalCapability(ctx);
    if (!capability.supported) throw new Error(`Goal execution ${capability.reason}.`);
  };
  const hiddenTools = new Set<string>();
  const syncTools = (ctx: ExtensionContext) => {
    const mutable = ["create_goal", "update_goal"];
    const current = pi.getActiveTools();
    let next = current;
    if (goalCapability(ctx).supported) {
      next = [...new Set([...current, ...hiddenTools])];
      hiddenTools.clear();
    } else {
      for (const name of current) if (mutable.includes(name)) hiddenTools.add(name);
      next = current.filter(name => !mutable.includes(name));
    }
    if (JSON.stringify(next) !== JSON.stringify(current)) pi.setActiveTools(next);
  };
  const missingTools = () => {
    const active = pi.getActiveTools();
    return REQUIRED_TOOLS.filter(name => !active.includes(name));
  };
  const requireTools = () => {
    const missing = missingTools();
    if (missing.length) throw new Error(`Missing goal tools: ${missing.join(", ")}. Restore them before /goal resume.`);
  };
  let toolNotice: string | undefined;
  const observeTools = async (ctx: ExtensionContext) => {
    if (!live || sessionId !== ctx.sessionManager.getSessionId() || !lease?.snapshot.goal || !goalCapability(ctx).supported) return;
    const missing = missingTools();
    const expected = lease.snapshot;
    if (missing.length && !expected.goal!.toolRecoveryRequired) {
      try { await commit(ctx, expected, () => lease!.requireToolRecovery(expected)); mirror(ctx); }
      catch (error) { report(ctx, error); return; }
    }
    const message = missing.length ? `Missing goal tools: ${missing.join(", ")}. Restore them, then use explicit /goal resume. No new automatic goal continuation will start.`
      : lease.snapshot.goal?.toolRecoveryRequired ? "Goal tools are available again. Use explicit /goal resume to continue automatic goal execution." : undefined;
    const notice = message ? `${expected.goal!.goalId}:${message}` : undefined;
    if (notice !== toolNotice) {
      toolNotice = notice;
      if (message) ctx.ui.notify(message, "warning");
    }
    scheduler.refresh(ctx);
  };
  const assertCurrent = (ctx: ExtensionContext) => {
    if (!live || ctx.sessionManager.getSessionId() !== sessionId) throw new Error("Stale goal session context.");
  };
  let busy = false;
  let mirrorDirty = false;
  const report = (ctx: ExtensionContext, error: unknown) => ctx.ui.notify(`Goal storage error: ${safe(error instanceof Error ? error.message : String(error))}`, "error");
  const commit = async <T>(ctx: ExtensionContext, expected: GoalRecord, work: () => Promise<T>): Promise<T> => {
    const operationLease = lease;
    const operationEpoch = epoch;
    try { return await work(); }
    catch (error) {
      // A stale operation must not suspend a newer goal or session.
      const current = lease?.snapshot;
      if (live && epoch === operationEpoch && lease === operationLease && ctx.sessionManager.getSessionId() === sessionId
        && current?.ownerSessionId === sessionId && current.recordId === expected.recordId
        && (current.revision === expected.revision || (error instanceof GoalCommitPublishedError && error.matches(current)))) scheduler.suspend(ctx);
      throw error;
    }
  };
  const mirror = (ctx: ExtensionContext) => {
    assertCurrent(ctx);
    const record = lease?.snapshot;
    scheduler.refresh(ctx);
    children.refresh();
    if (!record || record.revision === 0) return;
    const entries = ctx.sessionManager.getEntries();
    const found = entries.some(entry => entry.type === "custom" && entry.customType === GOAL_MIRROR
      && (entry.data as GoalRecord | undefined)?.recordId === record.recordId
      && (entry.data as GoalRecord | undefined)?.revision === record.revision);
    if (found && !mirrorDirty) return;
    try { pi.appendEntry(GOAL_MIRROR, record); mirrorDirty = false; }
    catch { mirrorDirty = true; ctx.ui.notify("Goal saved, but the session history mirror failed. It will be retried at the next safe checkpoint.", "warning"); }
  };
  const bind = async (ctx: ExtensionContext, create: boolean) => {
    assertCurrent(ctx);
    const identity = owner(ctx);
    if (lease) {
      if (lease.snapshot.ownerSessionId !== identity.ownerSessionId) throw new Error("Stale goal session context.");
      return;
    }
    const started = epoch;
    if (!create) {
      const records = await store.records();
      if (started !== epoch) throw new Error("Goal session changed during binding.");
      if (!records.some(record => record.ownerSessionId === identity.ownerSessionId)) return;
    }
    const opened = await store.openSession(identity, () => {
      assertCurrent(ctx);
      if (started !== epoch) throw new Error("Stale goal session context.");
    });
    if (started !== epoch) { await opened.close(); throw new Error("Goal session changed during binding."); }
    lease = opened;
    opened.onDisplayChange = () => {
      if (live && started === epoch && lease === opened) scheduler.refresh(ctx);
    };
    mirror(ctx);
  };
  pi.on("session_start", async (event, ctx) => {
    epoch++;
    live = true;
    sessionId = ctx.sessionManager.getSessionId();
    displayContext = ctx.mode === "tui" ? ctx : undefined;
    displayUnsubscribe?.();
    displayUnsubscribe = pi.events?.on(GOAL_DISPLAY_REQUEST, () => pi.events.emit(GOAL_DISPLAY_EVENT, presentation.current));
    if (event.reason === "reload") {
      // Pi reload enables all extension tools. Reapply only our tools' saved
      // external exclusions, not the tools hidden by capability synchronization.
      const saved = [...ctx.sessionManager.getEntries()].reverse().find(entry => entry.type === "custom" && entry.customType === GOAL_TOOL_STATE);
      const disabled = saved?.type === "custom" ? saved.data : undefined;
      if (Array.isArray(disabled) && disabled.every(name => REQUIRED_TOOLS.includes(name))) {
        pi.setActiveTools(pi.getActiveTools().filter(name => !disabled.includes(name)));
      }
    }
    syncTools(ctx);
    try {
      if (options.configPath) {
        try { config = JSON.parse(await readFile(options.configPath, "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; config = {}; }
      }
      resolveGoalBudget(undefined, config);
      configError = undefined;
    } catch (error) {
      configError = error;
      ctx.ui.notify(`Goal configuration error: ${safe(error instanceof Error ? error.message : String(error))}. Goal creation is disabled until configuration is fixed and reloaded.`, "error");
    }
    if (ctx.mode !== "tui" || !ctx.sessionManager.getSessionFile()) return;
    try {
      await bind(ctx, false); await observeTools(ctx); await children.start(ctx);
      const saved = lease?.snapshot;
      const goal = saved?.goal;
      resumeCandidate = event.reason !== "reload" && event.reason !== "fork" && ctx.hasUI && goalCapability(ctx).supported && goal
        && !goal.toolRecoveryRequired && ["paused", "blocked", "usage_limited"].includes(goal.status)
        && (goal.tokenBudget === undefined || goal.tokensUsed < goal.tokenBudget) ? saved : undefined;
    } catch (error) { report(ctx, error); }
  });
  const resumeGoal = async (ctx: ExtensionContext, expected: GoalRecord) => {
    assertCurrent(ctx); requireExecution(ctx);
    await observeTools(ctx);
    requireTools();
    await children.checkpoint(ctx);
    await accounting.checkpoint(ctx);
    assertCurrent(ctx); requireExecution(ctx);
    requireTools();
    const current = lease?.snapshot;
    if (!current?.goal || current.recordId !== expected.recordId || current.goal.goalId !== expected.goal?.goalId || current.goal.activation !== expected.goal?.activation) throw new Error("Stale goal resume rejected.");
    scheduler.invalidate();
    await commit(ctx, current, () => lease!.control("resume", current));
    mirror(ctx);
    ctx.ui.notify(`Goal ${lease!.snapshot.goal!.status}.`, "info");
    scheduler.resume(ctx);
  };
  pi.on("resources_discover", async (_event, ctx) => {
    const candidate = resumeCandidate;
    resumeCandidate = undefined;
    if (!candidate || !goalCapability(ctx).supported) return;
    const controller = new AbortController();
    resumeDialog = controller;
    const started = epoch;
    try {
      const accepted = await ctx.ui.confirm("Resume saved goal?", `The saved goal is ${candidate.goal!.status}. Resume it and continue working?`, { signal: controller.signal });
      if (!accepted || controller.signal.aborted || started !== epoch || busy || !goalCapability(ctx).supported) return;
      assertCurrent(ctx);
      const saved = await store.read(candidate.recordId);
      if (started !== epoch || !saved?.goal || saved.ownerSessionId !== sessionId || saved.revision !== candidate.revision || saved.goal.goalId !== candidate.goal!.goalId || saved.goal.status !== candidate.goal!.status || (saved.goal.tokenBudget !== undefined && saved.goal.tokensUsed >= saved.goal.tokenBudget)) return;
      busy = true;
      try { await resumeGoal(ctx, saved); } finally { busy = false; }
    } catch (error) { if (started === epoch) report(ctx, error); }
    finally { if (resumeDialog === controller) resumeDialog = undefined; }
  });
  pi.on("session_shutdown", async (event, ctx) => {
    resumeCandidate = undefined;
    panelToken = undefined;
    closePanel?.(); closePanel = undefined;
    resumeDialog?.abort(); resumeDialog = undefined;
    await observeTools(ctx);
    if (event.reason === "reload") {
      try { pi.appendEntry(GOAL_TOOL_STATE, missingTools().filter(name => !hiddenTools.has(name))); }
      catch (error) { report(ctx, error); }
    }
    try { await children.stop(ctx); } catch (error) { report(ctx, error); }
    if (live && lease) {
      try { await accounting.checkpoint(ctx); await lease.checkpoint(lease.snapshot); }
      catch (error) { report(ctx, error); }
    }
    presentation.dispose();
    displayContext = undefined;
    displayUnsubscribe?.(); displayUnsubscribe = undefined;
    epoch++;
    live = false;
    sessionId = undefined;
    const previous = lease;
    lease = undefined;
    await previous?.close();
  });
  pi.on("model_select", async (_event, ctx) => { syncTools(ctx); await observeTools(ctx); });
  pi.on("before_agent_start", async (_event, ctx) => { await observeTools(ctx); });
  pi.on("context", async (_event, ctx) => { await observeTools(ctx); });
  pi.on("message_end", async (_event, ctx) => { await observeTools(ctx); });
  pi.on("agent_end", async (_event, ctx) => { await observeTools(ctx); });
  pi.on("agent_settled", async (_event, ctx) => {
    if (live && lease && !busy) {
      try { await children.checkpoint(ctx); await accounting.checkpoint(ctx); await commit(ctx, lease.snapshot, () => lease!.checkpoint(lease!.snapshot)); mirror(ctx); }
      catch (error) { report(ctx, error); }
      lease?.setBudgetInFlight(false);
    }
  });
  pi.on("input", async (event, ctx) => {
    await observeTools(ctx);
    if (!live || ctx.mode !== "tui" || event.source !== "interactive" || !lease?.snapshot.continuationDeferral) return;
    assertCurrent(ctx);
    const started = epoch;
    try {
      const expected = lease.snapshot;
      await commit(ctx, expected, () => lease!.releaseDeferral(expected));
      if (started === epoch) mirror(ctx);
    } catch (error) {
      if (started === epoch) report(ctx, error);
      // Keep the user's input; a published gate release remains suspended.
    }
  });
  const command = (handler: (args: string, ctx: ExtensionCommandContext, started: number) => Promise<void>) => async (args: string, ctx: ExtensionCommandContext) => {
    assertCurrent(ctx);
    if (ctx.mode !== "tui") { ctx.ui.notify("Goal commands are available only in interactive TUI mode.", "warning"); return; }
    if (busy) { ctx.ui.notify("Another goal operation is in progress.", "warning"); return; }
    busy = true;
    const started = epoch;
    try { await observeTools(ctx); await children.checkpoint(ctx); await accounting.checkpoint(ctx); await handler(args.trim(), ctx, started); }
    catch (error) { if (started !== epoch) throw error; report(ctx, error); }
    finally { busy = false; }
  };
  pi.registerCommand("goal-fork", {
    description: "Fork or clone with an independent copy of the current goal",
    handler: command(async (_args, ctx, started) => {
      await bind(ctx, false);
      if (started !== epoch) return;
      if (!lease?.snapshot.goal) { ctx.ui.notify("No goal to inherit. Use /goal <objective> first.", "info"); return; }
      const choice = await ctx.ui.select("Inherit current goal", ["Fork from a historical user message", "Clone the current position"]);
      if (choice === undefined || started !== epoch) return;
      const position = choice === "Clone the current position" ? "at" : "before";
      let entryId: string | undefined;
      let editorText: string | undefined;
      if (position === "before") {
        const entries = ctx.sessionManager.getEntries().flatMap(entry => {
          if (entry.type !== "message" || entry.message.role !== "user") return [];
          const content = entry.message.content;
          const text = typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text).join("");
          return [{ id: entry.id, text }];
        });
        if (!entries.length) { ctx.ui.notify("No historical user messages to fork from.", "info"); return; }
        const labels = entries.map(entry => `${entry.id} | ${safe(entry.text).replace(/\s+/g, " ").slice(0, 120)}`);
        const selected = await ctx.ui.select("Fork before user message", labels);
        if (selected === undefined || started !== epoch) return;
        const entry = entries[labels.indexOf(selected)];
        if (!entry) return;
        entryId = entry.id;
        editorText = entry.text;
      }
      await ctx.waitForIdle();
      if (started !== epoch || !lease) return;
      const expected = lease.snapshot;
      const snapshot = await commit(ctx, expected, () => lease!.checkpoint(expected));
      if (started !== epoch) return;
      mirror(ctx);
      if (position === "at") entryId = ctx.sessionManager.getLeafId() ?? undefined;
      if (!entryId) { ctx.ui.notify("No session entry to clone yet.", "warning"); return; }
      try {
        const result = await ctx.fork(entryId, {
          position,
          withSession: async fresh => {
            // Only plain snapshot data and the session-independent store survive
            // shutdown. Never use the old pi, ctx, or lease after replacement.
            let child: GoalLease | undefined;
            try {
              const identity = owner(fresh);
              child = await store.openSession(identity, () => {
                if (owner(fresh).ownerSessionId !== identity.ownerSessionId) throw new Error("Goal session changed during inheritance.");
              });
              await child.inherit(snapshot);
            } catch (error) {
              fresh.ui.notify(`Goal inheritance failed. The source goal is unchanged; this session has no confirmed inherited goal. ${safe(error instanceof Error ? error.message : String(error))}`, "error");
              return;
            } finally { await child?.close(); }
            if (editorText !== undefined) fresh.ui.setEditorText(editorText);
            fresh.ui.notify("Goal inherited with saved statistics. Automatic continuation is deferred until you explicitly start a turn or resume the goal.", "info");
            await fresh.reload();
          },
        });
        if (result.cancelled && started === epoch) ctx.ui.notify("Goal inheritance cancelled. The source goal is unchanged.", "info");
      } catch (error) {
        throw new Error(`Goal inheritance failed. The source goal is unchanged. ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  });
  pi.registerCommand("goal-recover", {
    description: "Recover a saved goal for this project",
    handler: command(async (_args, ctx, started) => {
      owner(ctx);
      const choices = await store.recoverable(ctx.cwd);
      if (!choices.length) { ctx.ui.notify("No recoverable goals in this project. Goals held by another writer are excluded.", "info"); return; }
      const labels = choices.map(record => `${record.recordId.slice(0, 12)} | ${record.goal!.status} | ${safe(record.goal!.objective).replace(/\s+/g, " ").slice(0, 120)}`);
      const selected = await ctx.ui.select("Recover goal", labels);
      if (selected === undefined || started !== epoch) return;
      const chosen = choices[labels.indexOf(selected)];
      if (!chosen) return;
      // Re-read after selection; the UI snapshot is never authoritative.
      const latest = await store.read(chosen.recordId);
      if (!latest || latest.revision !== chosen.revision) throw new Error("Stale recovery selection. Open /goal-recover again.");
      let exists = false;
      try { exists = (await stat(latest.sessionFile)).isFile(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (exists) {
        const file = await open(latest.sessionFile, "r");
        let header: { id?: string; cwd?: string };
        try {
          const buffer = Buffer.alloc(65536);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          header = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0]!);
        } finally { await file.close(); }
        if (header.id !== latest.ownerSessionId || header.cwd !== latest.cwd) throw new Error("Saved session identity does not match the goal record. Repair the authoritative record before recovery.");
        await ctx.switchSession(latest.sessionFile, { withSession: async fresh => {
          fresh.ui.notify("Saved session opened. Use /goal to inspect its goal. No model request was started.", "info");
        } });
        return;
      }
      if (!await ctx.ui.confirm("Recover goal without conversation?", "The original session file is missing. This can recover the goal and saved statistics, but cannot restore the unsaved conversation or undo file and database changes. Take over this record in a new persistent session?")) return;
      if (started !== epoch) return;
      // setup runs after replacement and before withSession in both supported
      // versions. Commit to the same record, release it, then bind on reload.
      let recoveryError: unknown;
      await ctx.newSession({
        setup: async manager => {
          try {
            const sessionFile = manager.getSessionFile();
            if (!sessionFile) throw new Error("Recovery requires a persistent replacement session.");
            const recovered = await store.takeover(latest, { ownerSessionId: manager.getSessionId(), cwd: manager.getCwd(), sessionFile });
            await recovered.close();
          } catch (error) { recoveryError = error; }
        },
        withSession: async fresh => {
          if (recoveryError) { report(fresh, recoveryError); return; }
          fresh.ui.notify("Goal recovered with saved statistics. No model request was started.", "info");
          await fresh.reload();
        },
      });
    }),
  });
  const saveObjective = async (text: string, expected: GoalRecord, ctx: ExtensionCommandContext, started: number, editing: boolean) => {
    requireExecution(ctx);
    const selected: string[] = [];
    for (const candidate of content.candidates(text)) {
      const choice = await ctx.ui.select(`Persist pasted image? ${candidate}`, ["Copy attachment", "Keep as text", "Cancel"]);
      if (choice === undefined || choice === "Cancel" || started !== epoch) return false;
      if (choice === "Copy attachment") selected.push(candidate);
    }
    const prepared = await content.prepare(text.trim(), selected, editing ? expected.goal! : undefined);
    let saved = false;
    try {
      assertCurrent(ctx);
      if (started !== epoch || !lease) throw new Error("Stale goal content operation.");
      requireExecution(ctx);
      scheduler.invalidate();
      await commit(ctx, expected, () => editing
        ? lease!.control("edit", expected, prepared.objective, prepared.content)
        : lease!.replace(prepared.objective, expected, budgetFor(), prepared.content));
      saved = true;
      await observeTools(ctx);
      return true;
    } finally {
      if (!saved && prepared.content) {
        // An fsync error after rename is an uncertain commit. Retain content
        // whenever authority cannot prove this draft was not published.
        let unused = false;
        try { unused = (await store.read(expected.recordId))?.goal?.content?.bundleId !== prepared.content.bundleId; } catch { /* Retain. */ }
        if (unused) await content.discard(prepared);
      }
    }
  };
  const executeGoalCommand = command(async (args, ctx, started) => {
      if (args && !["pause", "clear"].includes(args.toLowerCase())) requireExecution(ctx);
      await bind(ctx, args.length > 0);
      if (started !== epoch) return;
      if (!lease) throw new Error("Goal could not bind to this session.");
      const expected = lease.snapshot;
      if (args.toLowerCase() === "clear") {
        scheduler.invalidate();
        await commit(ctx, expected, () => lease!.clear(expected));
        if (started !== epoch) return;
        mirror(ctx);
        ctx.ui.notify("Goal cleared.", "info");
        return;
      }
      const control = args.toLowerCase();
      if (control === "edit" || control === "pause" || control === "resume") {
        if (!expected.goal) { ctx.ui.notify("No goal set.", "info"); return; }
        const objective = control === "edit" ? await ctx.ui.editor("Edit goal", await content.expand(expected.goal)) : undefined;
        if (started !== epoch || (control === "edit" && objective === undefined)) return;
        if (control === "resume") { await resumeGoal(ctx, expected); return; }
        if (control === "edit") { if (!await saveObjective(objective!, expected, ctx, started, true)) return; }
        else {
          scheduler.invalidate();
          await commit(ctx, expected, () => lease!.control(control, expected));
        }
        if (started !== epoch) return;
        mirror(ctx);
        ctx.ui.notify(`Goal ${control === "edit" ? "updated" : lease.snapshot.goal!.status}.`, "info");
        if (control !== "pause") scheduler.resume(ctx, control === "edit");
        return;
      }
      if (expected.goal && expected.goal.status !== "complete") {
        if (!await ctx.ui.confirm("Replace current goal?", "The new goal will reset the saved time and token counts.")) return;
      }
      if (started !== epoch || !lease) return;
      if (!await saveObjective(args, expected, ctx, started, false)) return;
      if (started !== epoch) return;
      mirror(ctx);
      ctx.ui.notify("Goal saved.", "info");
      scheduler.resume(ctx);
  });
  pi.registerCommand("goal", {
    description: "Create, inspect, edit, pause, resume, or clear a goal",
    handler: async (args, ctx) => {
      if (args.trim()) return executeGoalCommand(args, ctx);
      assertCurrent(ctx);
      if (panelToken) { ctx.ui.notify("Goal details are already open.", "info"); return; }
      const token = Symbol();
      panelToken = token;
      let captured: { record?: GoalRecord; text: string; epoch: number } | undefined;
      try {
        await command(async (_args, context, started) => {
          await bind(context, false);
          const initial = lease?.snapshot;
          let expanded: string | undefined;
          let contentError = "";
          if (initial?.goal?.content) {
            try { expanded = await content.expand(initial.goal); }
            catch (error) { expanded = "Goal content unavailable."; contentError = `\nContent error: ${safe(error instanceof Error ? error.message : String(error))}`; }
          }
          assertCurrent(context);
          const record = lease?.snapshot;
          if (started !== epoch || initial?.goal?.goalId !== record?.goal?.goalId || initial?.goal?.objective !== record?.goal?.objective || initial?.goal?.content?.bundleId !== record?.goal?.content?.bundleId) throw new Error("Stale goal details. Reopen /goal.");
          mirror(context);
          captured = { record, epoch: started, text: summary(record, expanded, lease?.displayTiming?.elapsedSeconds) + contentError + (displayLimitation ? `\n${displayLimitation}` : "") };
        })("", ctx);
        if (!captured || captured.epoch !== epoch) return;
        const snapshot = captured;
        const goal = snapshot.record?.goal;
        const action = await ctx.ui.custom<GoalDetailAction | undefined>((tui, theme, _keys, done) => {
          closePanel = () => done(undefined);
          return new GoalDetails(snapshot.text, {
            pause: goal?.status === "active",
            resume: goalCapability(ctx).supported && missingTools().length === 0 && !!goal && goal.status !== "complete" && goal.status !== "budget_limited" && (goal.status !== "active" || !!goal.toolRecoveryRequired || !!snapshot.record?.continuationDeferral || !!displayLimitation),
          }, () => ctx.ui.theme ?? theme, () => Math.max(6, tui.terminal.rows - 5), done, () => tui.requestRender());
        });
        if (!action) return;
        await command(async (_args, context) => {
          const current = lease?.snapshot;
          const expected = snapshot.record;
          if (snapshot.epoch !== epoch || !current?.goal || !expected?.goal || current.recordId !== expected.recordId || current.goal.goalId !== expected.goal.goalId || current.generation !== expected.generation || current.goal.activation !== expected.goal.activation || current.goal.status !== expected.goal.status || current.goal.objective !== expected.goal.objective || current.goal.content?.bundleId !== expected.goal.content?.bundleId) throw new Error("Stale goal details. Reopen /goal before changing its state.");
          if (action === "resume") await resumeGoal(context, current);
          else {
            scheduler.invalidate();
            await commit(context, current, () => lease!.control("pause", current));
            mirror(context);
            context.ui.notify(`Goal ${lease!.snapshot.goal!.status}.`, "info");
          }
        })("", ctx);
      } finally {
        if (panelToken === token) { panelToken = undefined; closePanel = undefined; }
      }
    },
  });
  const accounting = registerGoalAccounting(pi, {
    snapshot: () => lease?.snapshot,
    account: async (expected, usage, ctx) => {
      assertCurrent(ctx);
      if (!lease) throw new Error("Goal lease is unavailable.");
      lease.setBudgetInFlight(!ctx.isIdle());
      await commit(ctx, expected, () => lease!.account(expected, usage));
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
      if (!lease) throw new Error("Goal lease is unavailable.");
      await commit(ctx, expected, () => lease!.subscribeChild(expected, source));
      mirror(ctx);
    },
    account: async (expected, usage, ctx) => {
      assertCurrent(ctx);
      if (!lease) throw new Error("Goal lease is unavailable.");
      if (expected.goal?.status === "active") lease.setBudgetInFlight(!ctx.isIdle());
      const saved = await commit(ctx, expected, () => lease!.accountChild(expected, usage));
      if (!expected.goal?.usageIncomplete && saved.goal?.usageIncomplete) {
        ctx.ui.notify("Goal usage is incomplete: a managed child reported missing, invalid, or unverified zero usage. Reported tokens are only the observed usage, not an exact total.", "warning");
      }
      mirror(ctx);
    },
    budget: ctx => scheduler.budget(ctx),
    error: (error, ctx) => { scheduler.suspend(ctx); report(ctx, error); },
  });
  pi.on("context", async (_event, ctx) => { await children.checkpoint(ctx); });
  const scheduler = registerGoalScheduler(pi, {
    display: (record, ctx, limitation, suspended) => {
      if (!live || ctx.mode !== "tui" || ctx.sessionManager.getSessionId() !== sessionId) return;
      displayContext = ctx;
      displayLimitation = limitation;
      presentation.update(record, limitation, suspended);
    },
    snapshot: () => lease?.snapshot,
    missingTools,
    checkpoint: async (expected, ctx) => {
      assertCurrent(ctx);
      if (!lease) throw new Error("Goal lease is unavailable.");
      return commit(ctx, expected, () => lease!.checkpoint(expected));
    },
    stop: async (status, expected, ctx, reason) => {
      assertCurrent(ctx);
      if (!lease) return;
      if (status !== "paused" && status !== "blocked" && status !== "usage_limited") throw new Error("Invalid runtime stop state.");
      await children.checkpoint(ctx);
      await accounting.checkpoint(ctx);
      assertCurrent(ctx);
      const current = lease.snapshot;
      if (current.goal?.goalId !== expected.goal?.goalId || current.generation !== expected.generation || current.goal?.activation !== expected.goal?.activation) return;
      await commit(ctx, current, () => reason === "repeated_tool_calls" && current.goal?.status === "active"
        ? lease!.pauseForLoop(current)
        : lease!.control(status === "paused" ? "pause" : status, current));
      mirror(ctx);
    },
  });
  registerGoalTools(pi, {
    get: async ctx => {
      assertCurrent(ctx);
      if (!goalCapability(ctx).supported) return (await store.records()).find(record => record.ownerSessionId === ctx.sessionManager.getSessionId());
      await bind(ctx, false);
      await children.checkpoint(ctx);
      if (!lease) return undefined;
      const expected = lease.snapshot;
      return commit(ctx, expected, () => lease!.checkpoint(expected));
    },
    create: async (ctx, objective, budget) => {
      assertCurrent(ctx);
      requireExecution(ctx);
      scheduler.assertModelGoal(ctx);
      await bind(ctx, true);
      requireExecution(ctx);
      scheduler.assertModelGoal(ctx);
      if (!lease) throw new Error("Goal could not bind to this session.");
      const expected = lease.snapshot;
      if (expected.goal && expected.goal.status !== "complete") throw new Error("Cannot create a new goal because this thread has an unfinished goal; complete the existing goal first.");
      await commit(ctx, expected, () => lease!.replace(objective, expected, budgetFor(budget)));
      scheduler.invalidate();
      scheduler.adopt(ctx);
      await observeTools(ctx);
      mirror(ctx);
      return lease.snapshot;
    },
    update: async (ctx, status) => {
      assertCurrent(ctx);
      requireExecution(ctx);
      scheduler.assertModelGoal(ctx);
      if (!lease) throw new Error("Cannot update goal because this thread has no goal.");
      await children.checkpoint(ctx);
      await accounting.checkpoint(ctx);
      requireExecution(ctx);
      scheduler.assertModelGoal(ctx);
      const expected = lease.snapshot;
      const saved = await commit(ctx, expected, () => lease!.control(status === "paused" ? "pause" : status, expected));
      scheduler.invalidate();
      mirror(ctx);
      return saved;
    },
  });
}

export default function goalExtension(pi: ExtensionAPI): void {
  if (process.env.PI_SUBAGENT_PARENT) return;
  registerGoal(pi, new GoalStore(join(getAgentDir(), "goals")), { configPath: join(getAgentDir(), "goal.json") });
}
