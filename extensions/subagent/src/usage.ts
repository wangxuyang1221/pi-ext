import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const GOAL_TASK_EVENT = "pi-ext:goal:subagent-task";
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(id);
export interface ChildUsage { sourceId: string; tokens: number; missing: boolean; lastReceipt?: string }
export function usageDirectory(stateRoot: string, processInstanceId: string): string {
  return join(stateRoot, "usage", createHash("sha256").update(processInstanceId).digest("hex"));
}
async function readJson(path: string): Promise<unknown> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if ((await file.stat()).size > 8192) throw new Error("Child usage file is too large.");
      return JSON.parse(await file.readFile("utf8"));
    } finally { await file.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
async function writeJson(directory: string, name: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, join(directory, name));
  } finally { await unlink(temporary).catch(() => {}); }
}
/** Assignment contains only an opaque report ID, never root goal or provider credentials. */
export async function assignUsage(directory: string, sourceId: string | undefined): Promise<void> {
  if (sourceId !== undefined && !validId(sourceId)) throw new Error("Invalid child usage source.");
  await writeJson(directory, "assignment.json", { sourceId: sourceId ?? null });
}
export class ChildUsageReporter {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, { sourceId: string; usage: unknown }>();
  constructor(readonly directory: string) {}
  async capture(): Promise<string | undefined> {
    const value = await readJson(join(this.directory, "assignment.json")) as { sourceId?: unknown } | undefined;
    if (!value || value.sourceId === null) return;
    if (!validId(value.sourceId)) throw new Error("Invalid child usage assignment.");
    return value.sourceId;
  }
  remember(key: string): void { this.seen.add(key); }
  record(sourceId: string | undefined, key: string, usage: unknown): Promise<void> {
    const run = this.queue.then(async () => {
      if (this.seen.has(key)) return;
      if (!sourceId) { this.seen.add(key); return; }
      if (!validId(sourceId)) throw new Error("Invalid child usage source.");
      this.pending.set(key, { sourceId, usage });
      const saved = await readJson(join(this.directory, `${sourceId}.json`)) as ChildUsage | undefined;
      if (saved && (saved.sourceId !== sourceId || !Number.isSafeInteger(saved.tokens) || saved.tokens < 0 || typeof saved.missing !== "boolean")) throw new Error("Invalid child usage report.");
      if (saved?.lastReceipt === key) { this.seen.add(key); this.pending.delete(key); return; }
      const value = usage as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined;
      // Keep this formula aligned with goalTokens; the extensions build independently.
      const cacheWrite = value?.cacheWrite === undefined ? 0 : value.cacheWrite;
      const cacheRead = value?.cacheRead === undefined ? 0 : value.cacheRead;
      const count = (value?.input ?? NaN) + (value?.output ?? NaN) + cacheWrite;
      const valid = Number.isSafeInteger(value?.input) && Number.isSafeInteger(value?.output) && value!.input! >= 0 && value!.output! >= 0 && Number.isSafeInteger(cacheWrite) && cacheWrite >= 0 && Number.isSafeInteger(cacheRead) && cacheRead >= 0 && Number.isSafeInteger(count);
      const missing = !valid || (count === 0 && !value?.cacheRead && !value?.cacheWrite);
      const tokens = (saved?.tokens ?? 0) + (valid ? count : 0);
      if (!Number.isSafeInteger(tokens)) throw new Error("Child usage exceeds safe integer precision.");
      await writeJson(this.directory, `${sourceId}.json`, { sourceId, tokens, missing: !!saved?.missing || missing, lastReceipt: key });
      this.seen.add(key);
      this.pending.delete(key);
    });
    this.queue = run.catch(() => {});
    return run;
  }
  async drain(): Promise<void> {
    await this.queue;
    for (const [key, entry] of this.pending) await this.record(entry.sourceId, key, entry.usage);
  }
}
const receipt = (message: { provider: string; responseId?: string; model: string; timestamp: number; content: unknown; stopReason: string }) => createHash("sha256").update(JSON.stringify(message.responseId ? [message.provider, message.responseId] : [message.provider, message.model, message.timestamp, message.content, message.stopReason])).digest("hex");
/** Runs in managed children in every Pi mode without registering goal tools or loops. */
export function registerChildUsage(pi: ExtensionAPI, directory: string): void {
  const reporter = new ChildUsageReporter(directory);
  let request: string | undefined;
  let compact: string | undefined;
  let branch: string | undefined;
  const starts = new Map<number, string | undefined>();
  pi.on("session_start", (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "message" && entry.message.role === "assistant") reporter.remember(receipt(entry.message));
    }
  });
  pi.on("context", async () => { request = await reporter.capture(); });
  pi.on("message_start", event => { if (event.message.role === "assistant") starts.set(event.message.timestamp, request); });
  pi.on("message_end", async event => {
    if (event.message.role !== "assistant") return;
    await reporter.record(starts.get(event.message.timestamp), receipt(event.message), event.message.usage);
    starts.delete(event.message.timestamp);
  });
  pi.on("session_before_compact", async () => { compact = await reporter.capture(); });
  pi.on("session_compact", async event => { await reporter.record(compact, `compact:${event.compactionEntry.id}`, event.compactionEntry.usage); compact = undefined; });
  pi.on("session_compact_failed", async () => { await reporter.record(compact, `compact-failed:${randomUUID()}`, undefined); compact = undefined; });
  pi.on("session_before_tree", async event => { branch = event.preparation.userWantsSummary ? await reporter.capture() : undefined; });
  pi.on("session_tree", async event => { if (event.summaryEntry) await reporter.record(branch, `branch:${event.summaryEntry.id}`, event.summaryEntry.usage); branch = undefined; });
  pi.on("agent_settled", async () => { await reporter.drain(); starts.clear(); request = undefined; });
  pi.on("session_shutdown", async () => { await reporter.drain(); starts.clear(); request = undefined; });
}
