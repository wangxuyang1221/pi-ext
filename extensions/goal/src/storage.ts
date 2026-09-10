import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { validateContent, type ContentReference } from "./content.js";
import { WriterLock } from "./lock.js";

export interface UsageCheckpoint { sourceId: string; tokens: number; missing: boolean; lastReceipt?: string }
export interface ChildUsageCheckpoint extends UsageCheckpoint { reportPath: string }
export interface Goal {
  goalId: string;
  generation: number;
  activation?: number;
  objective: string;
  content?: ContentReference;
  status: "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";
  pauseReason?: "repeated_tool_calls";
  tokenBudget?: number;
  tokensUsed: number;
  elapsedSeconds: number;
  usageCheckpoint?: UsageCheckpoint;
  childUsage?: ChildUsageCheckpoint[];
  usageIncomplete?: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Owner { ownerSessionId: string; cwd: string; sessionFile: string }
export interface GoalRecord extends Owner {
  schemaVersion: 1;
  recordId: string;
  revision: number;
  generation: number;
  goal: Goal | null;
  continuationDeferral: boolean;
  recoveredFrom: string | null;
}

function validate(record: GoalRecord, recordId: string): void {
  const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
  const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  if (!/^[a-f0-9]{64}$/.test(recordId) || !record || record.schemaVersion !== 1 || record.recordId !== recordId
    || !text(record.ownerSessionId) || !text(record.cwd) || !isAbsolute(record.cwd)
    || !text(record.sessionFile) || !isAbsolute(record.sessionFile)
    || !integer(record.revision) || !integer(record.generation)
    || typeof record.continuationDeferral !== "boolean"
    || !(record.recoveredFrom === null || text(record.recoveredFrom))) throw new Error(`Invalid or unsupported goal record: ${recordId}. Restore a verified authoritative backup; history mirrors are not recovery sources.`);
  const goal = record.goal;
  if (goal?.content !== undefined) validateContent(goal.content);
  if (goal?.pauseReason !== undefined && (goal.pauseReason !== "repeated_tool_calls" || goal.status !== "paused")) throw new Error(`Invalid goal pause reason: ${recordId}.`);
  if (goal?.activation !== undefined && !integer(goal.activation)) throw new Error(`Invalid goal activation: ${recordId}.`);
  const usage = goal?.usageCheckpoint;
  if (usage !== undefined && (!usage || !text(usage.sourceId) || !integer(usage.tokens) || typeof usage.missing !== "boolean" || (usage.lastReceipt !== undefined && (!text(usage.lastReceipt) || usage.lastReceipt.length > 128)))) throw new Error(`Invalid goal usage checkpoint: ${recordId}.`);
  if (goal?.childUsage !== undefined) {
    if (!Array.isArray(goal.childUsage) || goal.childUsage.some(child => !child || !text(child.sourceId) || !text(child.reportPath) || !isAbsolute(child.reportPath) || !integer(child.tokens) || typeof child.missing !== "boolean" || (child.lastReceipt !== undefined && (!text(child.lastReceipt) || child.lastReceipt.length > 128))) || new Set(goal.childUsage.map(child => child.sourceId)).size !== goal.childUsage.length) throw new Error(`Invalid child usage checkpoint: ${recordId}.`);
  }
  if (goal?.usageIncomplete !== undefined && typeof goal.usageIncomplete !== "boolean") throw new Error(`Invalid goal usage visibility: ${recordId}.`);
  if (goal !== null && (!goal || !text(goal.goalId) || !text(goal.objective) || !goal.objective.trim()
    || goal.generation !== record.generation || !integer(goal.tokensUsed)
    || !Number.isFinite(goal.elapsedSeconds) || goal.elapsedSeconds < 0
    || !["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"].includes(goal.status)
    || !text(goal.createdAt) || !Number.isFinite(Date.parse(goal.createdAt))
    || !text(goal.updatedAt) || !Number.isFinite(Date.parse(goal.updatedAt))
    || (goal.tokenBudget !== undefined && (!integer(goal.tokenBudget) || goal.tokenBudget === 0)))) throw new Error(`Invalid goal snapshot: ${recordId}. Restore a verified authoritative backup.`);
}

export class GoalStore {
  /** Fault injection point after file sync, before authoritative replacement. */
  beforeRename?: () => void;
  constructor(readonly root: string, readonly now: () => number = () => performance.now()) {}
  async read(recordId: string): Promise<GoalRecord | undefined> {
    if (!/^[a-f0-9]{64}$/.test(recordId)) throw new Error("Invalid goal record ID.");
    try {
      const record = JSON.parse(await readFile(join(this.root, `${recordId}.json`), "utf8")) as GoalRecord;
      validate(record, recordId);
      return record;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  private async catalog<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const lock = await WriterLock.acquire(join(this.root, "catalog.lock"), "catalog");
    try { return await operation(); } finally { await lock.close(); }
  }
  async records(): Promise<GoalRecord[]> {
    let names: string[];
    try { names = await readdir(this.root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const records: GoalRecord[] = [];
    for (const name of names.sort()) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const record = await this.read(name.slice(0, -5));
      if (record) records.push(record);
    }
    return records;
  }
  async recoverable(cwd: string): Promise<GoalRecord[]> {
    const result: GoalRecord[] = [];
    for (const record of await this.records()) {
      if (record.cwd === cwd && record.goal && await WriterLock.available(join(this.root, `${record.recordId}.lock`))) result.push(record);
    }
    return result;
  }
  async openSession(owner: Owner, assertCurrent?: () => void): Promise<GoalLease> {
    return this.catalog(async () => {
      const owned = (await this.records()).filter(row => row.ownerSessionId === owner.ownerSessionId);
      if (owned.length > 1) throw new Error("Multiple goal records claim this session. Explicit repair is required.");
      const recordId = owned[0]?.recordId ?? createHash("sha256").update(owner.ownerSessionId).digest("hex");
      const lock = await WriterLock.acquire(join(this.root, `${recordId}.lock`), owner.ownerSessionId);
      try {
        const existing = await this.read(recordId);
        if (existing && (existing.ownerSessionId !== owner.ownerSessionId || existing.cwd !== owner.cwd)) throw new Error("This goal was recovered into another session. Use /goal-recover.");
        const record = existing ?? {
          ...owner, schemaVersion: 1 as const, recordId, revision: 0, generation: 0,
          goal: null, continuationDeferral: false, recoveredFrom: null,
        };
        return new GoalLease(this, record, lock, assertCurrent);
      } catch (error) { await lock.close(); throw error; }
    });
  }
  async takeover(expected: GoalRecord, owner: Owner): Promise<GoalLease> {
    validate(expected, expected.recordId);
    return this.catalog(async () => {
      if ((await this.records()).some(row => row.ownerSessionId === owner.ownerSessionId && row.recordId !== expected.recordId)) throw new Error("The replacement session already owns a goal record.");
      const lock = await WriterLock.acquire(join(this.root, `${expected.recordId}.lock`), owner.ownerSessionId);
      try {
        const record = await this.read(expected.recordId);
        if (!record || record.revision !== expected.revision || record.ownerSessionId !== expected.ownerSessionId || record.cwd !== owner.cwd || !record.goal) throw new Error("Stale recovery selection. Open /goal-recover again.");
        const next = { ...record, ...owner, recoveredFrom: record.ownerSessionId, revision: record.revision + 1 };
        await this.commit(next);
        return new GoalLease(this, next, lock);
      } catch (error) { await lock.close(); throw error; }
    });
  }
  async commit(record: GoalRecord, assertCurrent?: () => void): Promise<void> {
    const temporary = join(this.root, `${record.recordId}.${randomUUID()}.tmp`);
    validate(record, record.recordId);
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
      finally { await file.close(); }
      this.beforeRename?.();
      // Recheck after async I/O and immediately before the commit starts.
      assertCurrent?.();
      await rename(temporary, join(this.root, `${record.recordId}.json`));
      // Windows does not expose directory fsync through this API. On POSIX,
      // sync the directory entry too; a post-rename error is an uncertain commit.
      if (process.platform !== "win32") {
        const directory = await open(this.root, "r");
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } finally { await unlink(temporary).catch(() => {}); }
  }
}

export class GoalLease {
  private queue: Promise<unknown> = Promise.resolve();
  private tick: number;
  private budgetInFlight = false;
  constructor(private readonly store: GoalStore, private current: GoalRecord, private readonly lock: WriterLock, private readonly assertCurrent?: () => void) { this.tick = store.now(); }
  /** Keep timing the already-running budget wrap-up, never an idle limited goal. */
  setBudgetInFlight(value: boolean): void { this.budgetInFlight = value; }
  get snapshot(): GoalRecord { return structuredClone(this.current); }
  private mutate(expected: GoalRecord, change: (record: GoalRecord) => GoalRecord, persist = true, cumulative = false): Promise<GoalRecord> {
    const run = this.queue.then(async () => {
      this.assertCurrent?.();
      await this.lock.assertOwned();
      const saved = await this.store.read(this.current.recordId);
      if (!saved && this.current.revision > 0) throw new Error("Authoritative goal record is missing. Explicit recovery is required.");
      const record = saved ?? this.current;
      if (record.recordId !== expected.recordId || (!cumulative && record.revision !== expected.revision) || record.generation !== expected.generation || record.goal?.goalId !== expected.goal?.goalId || record.goal?.activation !== expected.goal?.activation || record.ownerSessionId !== expected.ownerSessionId) throw new Error("Stale goal mutation rejected.");
      const now = this.store.now();
      const timing = record.goal?.status === "active" || (record.goal?.status === "budget_limited" && this.budgetInFlight);
      const seconds = timing ? Math.max(0, Math.floor((now - this.tick) / 1000)) : 0;
      const timed = structuredClone(record);
      if (timed.goal && seconds > 0) timed.goal.elapsedSeconds += seconds;
      const next = change(timed);
      if (persist || seconds > 0) {
        next.revision = record.revision + 1;
        await this.store.commit(next, this.assertCurrent);
      }
      const stillTiming = next.goal?.status === "active" || (next.goal?.status === "budget_limited" && this.budgetInFlight);
      this.tick = timing && stillTiming && record.goal?.goalId === next.goal?.goalId ? this.tick + seconds * 1000 : now;
      this.current = next;
      return this.snapshot;
    });
    this.queue = run.catch(() => {});
    return run;
  }
  /** Drain queued writes, verify authority, and commit whole active seconds if needed. */
  checkpoint(expected: GoalRecord): Promise<GoalRecord> {
    return this.mutate(expected, record => record, false, true);
  }
  /** Copy a checkpoint into a never-committed record, with a durable launch gate. */
  inherit(source: GoalRecord): Promise<GoalRecord> {
    validate(source, source.recordId);
    return this.mutate(this.snapshot, record => {
      if (record.revision !== 0 || record.goal || record.ownerSessionId === source.ownerSessionId) throw new Error("Goal inheritance requires a new empty session record.");
      if (!source.goal) throw new Error("No goal to inherit.");
      const goal = structuredClone(source.goal);
      delete goal.childUsage;
      return { ...record, goal, generation: source.generation, continuationDeferral: true };
    });
  }
  /** Release inheritance gating, without changing the goal's stop state. */
  releaseDeferral(expected: GoalRecord): Promise<GoalRecord> {
    return this.mutate(expected, record => ({ ...record, continuationDeferral: false }));
  }
  replace(objective: string, expected: GoalRecord, tokenBudget?: number, content?: ContentReference): Promise<GoalRecord> {
    return this.mutate(expected, record => {
      if (!objective.trim()) throw new Error("Goal objective must not be empty.");
      if (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) throw new Error("Goal budget must be a positive safe integer.");
      const now = new Date().toISOString();
      record.generation++;
      record.goal = { goalId: randomUUID(), generation: record.generation, objective, ...(content ? { content: structuredClone(content) } : {}), ...(tokenBudget === undefined ? {} : { tokenBudget }), status: "active", tokensUsed: 0, elapsedSeconds: 0, createdAt: now, updatedAt: now };
      record.continuationDeferral = false;
      return record;
    });
  }
  /** Commit a source's cumulative usage and its deduplication checkpoint atomically. */
  account(expected: GoalRecord, usage: UsageCheckpoint): Promise<GoalRecord> {
    return this.mutate(expected, record => {
      const goal = record.goal;
      if (!goal) throw new Error("No goal set.");
      if (!usage.sourceId || !Number.isSafeInteger(usage.tokens) || usage.tokens < 0 || typeof usage.missing !== "boolean") throw new Error("Invalid goal usage checkpoint.");
      const previous = goal.usageCheckpoint?.sourceId === usage.sourceId ? goal.usageCheckpoint.tokens : 0;
      if (usage.tokens < previous) throw new Error("Goal usage checkpoint cannot decrease.");
      const next = goal.tokensUsed + usage.tokens - previous;
      if (!Number.isSafeInteger(next)) throw new Error("Goal token usage exceeds safe integer precision.");
      goal.tokensUsed = next;
      goal.usageCheckpoint = { sourceId: usage.sourceId, tokens: usage.tokens, missing: usage.missing, ...(usage.lastReceipt === undefined ? {} : { lastReceipt: usage.lastReceipt }) };
      if (usage.missing) goal.usageIncomplete = true;
      if (goal.status === "active" && goal.tokenBudget !== undefined && next >= goal.tokenBudget) goal.status = "budget_limited";
      goal.updatedAt = new Date().toISOString();
      return record;
    }, true, true);
  }
  /** Register a report before delivering the managed task. */
  subscribeChild(expected: GoalRecord, source: ChildUsageCheckpoint): Promise<GoalRecord> {
    return this.mutate(expected, record => {
      if (!record.goal) throw new Error("No goal set.");
      if (record.goal.childUsage?.some(child => child.sourceId === source.sourceId)) throw new Error("Duplicate child usage source.");
      record.goal.childUsage = [...(record.goal.childUsage ?? []), structuredClone(source)];
      return record;
    }, true, true);
  }
  /** Child reports never replace the main response checkpoint. */
  accountChild(expected: GoalRecord, usage: UsageCheckpoint): Promise<GoalRecord> {
    return this.mutate(expected, record => {
      const goal = record.goal;
      const child = goal?.childUsage?.find(source => source.sourceId === usage.sourceId);
      if (!goal || !child) throw new Error("Unregistered child usage source.");
      if (!Number.isSafeInteger(usage.tokens) || usage.tokens < child.tokens || typeof usage.missing !== "boolean") throw new Error("Invalid child usage checkpoint.");
      const charging = goal.status === "active" || (goal.status === "budget_limited" && this.budgetInFlight);
      const total = goal.tokensUsed + (charging ? usage.tokens - child.tokens : 0);
      if (!Number.isSafeInteger(total)) throw new Error("Goal token usage exceeds safe integer precision.");
      goal.tokensUsed = total;
      child.tokens = usage.tokens;
      child.missing = usage.missing;
      if (usage.lastReceipt === undefined) delete child.lastReceipt;
      else child.lastReceipt = usage.lastReceipt;
      // A cumulative missing flag cannot prove resumed reports are complete.
      if (charging && usage.missing) goal.usageIncomplete = true;
      if (goal.status === "active" && goal.tokenBudget !== undefined && total >= goal.tokenBudget) goal.status = "budget_limited";
      if (charging) goal.updatedAt = new Date().toISOString();
      return record;
    }, true, true);
  }
  /** Persist the diagnostic with the pause, never overwriting a terminal state. */
  pauseForLoop(expected: GoalRecord): Promise<GoalRecord> {
    return this.mutate(expected, record => {
      if (record.goal?.status !== "active") throw new Error("Loop pause requires an active goal.");
      record.goal.activation = (record.goal.activation ?? 0) + 1;
      record.goal.status = "paused";
      record.goal.pauseReason = "repeated_tool_calls";
      record.goal.updatedAt = new Date().toISOString();
      return record;
    });
  }
  /** Resume and release inheritance gating in the same authoritative commit. */
  control(action: "resume" | "pause" | "edit" | "complete" | "blocked" | "usage_limited", expected: GoalRecord, objective?: string, content?: ContentReference): Promise<GoalRecord> {
    return this.mutate(expected, record => {
      const goal = record.goal;
      if (!goal) throw new Error("No goal set.");
      const previousStatus = goal.status;
      delete goal.pauseReason;
      if (action === "edit") {
        if (!objective?.trim()) throw new Error("Goal objective must not be empty.");
        goal.objective = objective.trim();
        if (content) goal.content = structuredClone(content);
        else delete goal.content;
        if (goal.status === "complete" || goal.status === "budget_limited") goal.status = "active";
      } else {
        if (!(goal.status === "budget_limited" && (action === "pause" || action === "blocked"))) {
          goal.status = action === "resume" ? "active" : action === "pause" ? "paused" : action;
        }
      }
      // Reopening an already exhausted saved budget never grants new budget.
      if (goal.status === "active" && goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) goal.status = "budget_limited";
      if (goal.status !== previousStatus) goal.activation = (goal.activation ?? 0) + 1;
      goal.updatedAt = new Date().toISOString();
      if (action === "resume") record.continuationDeferral = false;
      return record;
    });
  }
  clear(expected: GoalRecord): Promise<GoalRecord> {
    return this.mutate(expected, record => ({ ...record, goal: null, generation: record.generation + 1, continuationDeferral: false }));
  }
  async close(): Promise<void> { await this.queue; await this.lock.close(); }
}
