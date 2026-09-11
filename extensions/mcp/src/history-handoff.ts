import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, opendirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { collectHistoryIdentities, MAX_HISTORY_IDENTITIES, readBoundedFile, type HistoryIdentity } from "./history.js";

export const MAX_HANDOFF_BYTES = 8 * 1024 * 1024;
export const HANDOFF_TTL_MS = 60_000;

/** Bridges display metadata across extension instances in one CLI process. */
export class HistoryHandoff {
  readonly path: string;
  private readonly directory: string;

  constructor(agentDir: string, bootId = `${process.pid}-${createHash("sha256").update(String(performance.timeOrigin)).digest("hex").slice(0, 24)}`) {
    if (!/^[a-zA-Z0-9-]+$/.test(bootId)) throw new Error("Invalid MCP history boot identifier");
    this.directory = join(agentDir, "mcp-history");
    this.path = join(this.directory, `${bootId}.json`);
  }

  consume(): HistoryIdentity[] {
    if (!this.checkDirectory()) return [];
    this.prune();
    try {
      const payload: unknown = JSON.parse(readBoundedFile(this.path, MAX_HANDOFF_BYTES, true));
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid MCP history handoff");
      const data = payload as Record<string, unknown>;
      if (Object.keys(data).sort().join() !== "createdAt,identities,version" || data.version !== 1
        || typeof data.createdAt !== "number" || !Number.isFinite(data.createdAt)
        || data.createdAt > Date.now() || data.createdAt < performance.timeOrigin) {
        throw new Error("Invalid or expired MCP history handoff");
      }
      return validateIdentities(data.identities);
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    } finally { this.clear(); }
  }

  publish(identities: readonly HistoryIdentity[]): void {
    if (!this.checkDirectory()) mkdirSync(this.directory, { mode: 0o700 });
    this.checkDirectory();
    this.clear();
    const validated = validateIdentities(identities);
    const text = JSON.stringify({ version: 1, createdAt: Date.now(), identities: validated });
    if (Buffer.byteLength(text) > MAX_HANDOFF_BYTES) throw new Error("MCP history handoff byte limit exceeded");
    if (validated.length === 0) return;
    const temp = `${this.path}.tmp-${randomUUID()}`;
    try {
      writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
      renameSync(temp, this.path);
    } finally { removeFile(temp); }
  }

  clear(): void {
    if (this.checkDirectory()) removeFile(this.path);
  }

  private prune(): void {
    const directory = opendirSync(this.directory);
    try {
      let count = 0;
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++count > 8192) throw new Error("MCP history directory entry limit exceeded");
        if (!/^[0-9]+-[a-zA-Z0-9-]+\.json(?:\.tmp-[a-zA-Z0-9-]+)?$/.test(entry.name)) continue;
        const path = join(this.directory, entry.name);
        if (path === this.path) continue;
        try {
          const stat = lstatSync(path);
          const pid = Number(entry.name.split("-")[0]);
          // A human trust prompt can keep a valid handoff pending indefinitely.
          // Age only qualifies orphan cleanup; it never expires a live process.
          if (stat.isFile() && stat.uid === process.getuid?.() && Date.now() - stat.mtimeMs > HANDOFF_TTL_MS
            && !processAlive(pid)) removeFile(path);
        } catch (error) { if (!missing(error)) throw error; }
      }
    } finally { directory.closeSync(); }
  }

  private checkDirectory(): boolean {
    try {
      const stat = lstatSync(this.directory);
      if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
        throw new Error("Unsafe MCP history directory");
      }
      return true;
    } catch (error) { if (missing(error)) return false; throw error; }
  }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
function removeFile(path: string): void {
  try { unlinkSync(path); } catch (error) { if (!missing(error)) throw error; }
}

function validateIdentities(value: unknown): HistoryIdentity[] {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_IDENTITIES) throw new Error("Invalid MCP history identities");
  const names = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid MCP history identity");
    const identity = item as HistoryIdentity;
    const keys = Object.keys(identity).sort().join();
    if (keys !== "fullName" && keys !== "fullName,serverName,toolName") throw new Error("Unexpected MCP history identity fields");
    const collected = collectHistoryIdentities([{ type: "message", message: { role: "toolResult", toolName: identity.fullName } }]);
    if (collected.length !== 1 || names.has(identity.fullName)) throw new Error("Invalid MCP history identity name");
    names.add(identity.fullName);
    if (keys !== "fullName" && (typeof identity.serverName !== "string" || !identity.serverName
      || typeof identity.toolName !== "string" || !identity.toolName
      || `mcp__${identity.serverName}__${identity.toolName}` !== identity.fullName)) {
      throw new Error("Mismatched MCP history display identity");
    }
    return keys === "fullName" ? { fullName: identity.fullName }
      : { fullName: identity.fullName, serverName: identity.serverName, toolName: identity.toolName };
  });
}
