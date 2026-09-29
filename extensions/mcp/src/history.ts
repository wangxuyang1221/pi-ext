import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { open } from "node:fs/promises";

// Bound a single JSONL record, not the complete session (which may contain many images).
export const MAX_HISTORY_RECORD_BYTES = 64 * 1024 * 1024;
export const HISTORY_READ_CHUNK_BYTES = 64 * 1024;
export const MAX_HISTORY_IDENTITIES = 4096;
export const MAX_HISTORY_NAME_BYTES = 1024;

/** Display-only identity recovered from session history. */
export interface HistoryIdentity {
  fullName: string;
  serverName?: string;
  toolName?: string;
}

/** Collects MCP display identities across all session branches. */
export function collectHistoryIdentities(entries: readonly unknown[]): HistoryIdentity[] {
  const collector = createHistoryCollector();
  for (const entry of entries) collector.accept(entry);
  return collector.values();
}

function createHistoryCollector() {
  const identities = new Map<string, HistoryIdentity>();
  const conflicts = new Set<string>();
  const add = (name: unknown, details?: unknown): void => {
    if (typeof name !== "string" || !name.startsWith("mcp__")) return;
    if (!safeName(name)) throw new Error("Unsafe MCP history tool name");
    const tail = name.slice(5);
    const boundaries: number[] = [];
    for (let index = 1; index < tail.length - 2; index += 1) {
      if (tail.slice(index, index + 2) === "__") boundaries.push(index);
    }
    if (!boundaries.length) throw new Error("Invalid MCP history tool name");
    const previous = identities.get(name);
    const identity: HistoryIdentity = previous ?? (boundaries.length === 1 && tail.split("__").length === 2
      ? { fullName: name, serverName: tail.slice(0, boundaries[0]), toolName: tail.slice(boundaries[0] + 2) }
      : { fullName: name });
    const info = record(details);
    if (info?.mcp === true && typeof info.server === "string" && info.server.length > 0
      && typeof info.tool === "string" && info.tool.length > 0
      && `mcp__${info.server}__${info.tool}` === name) {
      if (identity.serverName !== undefined && (identity.serverName !== info.server || identity.toolName !== info.tool)) {
        conflicts.add(name);
      }
      if (conflicts.has(name)) {
        delete identity.serverName;
        delete identity.toolName;
      } else {
        identity.serverName = info.server;
        identity.toolName = info.tool;
      }
    }
    identities.set(name, identity);
    if (identities.size > MAX_HISTORY_IDENTITIES) throw new Error("MCP history identity limit exceeded");
  };
  const accept = (entry: unknown): void => {
    const row = record(entry);
    if (row?.type !== "message") return;
    const message = record(row.message);
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        const value = record(block);
        if (value?.type === "toolCall") add(value.name);
      }
    } else if (message?.role === "toolResult") add(message.toolName, message.details);
  };
  return { accept, values: () => [...identities.values()] };
}

/** Scans JSONL once, retaining only the current record and bounded display identities. */
export async function readHistoryIdentities(path: string): Promise<HistoryIdentity[]> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    if (!before.isFile()) throw new Error("Unsafe MCP history file");
    const collector = createHistoryCollector();
    let fragments: Buffer[] = [];
    let recordBytes = 0;
    const append = (fragment: Buffer) => {
      recordBytes += fragment.length;
      if (recordBytes > MAX_HISTORY_RECORD_BYTES) throw new Error("Oversized MCP history JSONL record");
      if (fragment.length) fragments.push(fragment);
    };
    const consume = () => {
      const line = Buffer.concat(fragments, recordBytes).toString("utf8").trim();
      fragments = [];
      recordBytes = 0;
      if (!line) return;
      let entry: unknown;
      try { entry = JSON.parse(line); }
      catch { throw new Error("Malformed MCP history JSONL"); }
      if (!record(entry)) throw new Error("Malformed MCP history JSONL");
      collector.accept(entry);
    };
    let bytes = 0;
    while (bytes <= before.size) {
      // Async bounded reads yield between chunks; never allocate from the file size.
      const buffer = Buffer.allocUnsafe(Math.min(HISTORY_READ_CHUNK_BYTES, before.size - bytes + 1));
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > before.size) throw new Error("MCP history file changed while reading");
      const chunk = buffer.subarray(0, bytesRead);
      let start = 0;
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
        append(chunk.subarray(start, end));
        consume();
        start = end + 1;
      }
      append(chunk.subarray(start));
    }
    consume();
    const after = await fd.stat();
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error("MCP history file changed while reading");
    }
    return collector.values();
  } finally { await fd.close(); }
}

/** Reads only regular files, rejecting symlinks, growth, and oversized input. */
export function readBoundedFile(path: string, maxBytes: number, privateFile = false): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes
      || (privateFile && ((stat.mode & 0o077) !== 0 || stat.nlink !== 1 || stat.uid !== process.getuid?.()))) {
      throw new Error("Unsafe or oversized MCP history file");
    }
    const buffer = Buffer.alloc(stat.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes > stat.size) throw new Error("MCP history file changed while reading");
    return buffer.subarray(0, bytes).toString("utf8");
  } finally { closeSync(fd); }
}

function safeName(value: string): boolean {
  return value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_HISTORY_NAME_BYTES
    && !/[\u0000-\u0020\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
