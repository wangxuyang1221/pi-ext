import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";

export const MAX_HISTORY_FILE_BYTES = 64 * 1024 * 1024;
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
  for (const entry of entries) {
    const row = record(entry);
    if (row?.type !== "message") continue;
    const message = record(row.message);
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        const value = record(block);
        if (value?.type === "toolCall") add(value.name);
      }
    } else if (message?.role === "toolResult") add(message.toolName, message.details);
  }
  return [...identities.values()];
}

/** Reads a bounded session file without opening or migrating a SessionManager. */
export function readHistoryIdentities(path: string): HistoryIdentity[] {
  const content = readBoundedFile(path, MAX_HISTORY_FILE_BYTES);
  const entries = parseSessionEntries(content);
  const lineCount = content.split("\n").filter((line) => line.trim()).length;
  if (entries.length !== lineCount || entries.some((entry) => !record(entry))) {
    throw new Error("Malformed MCP history JSONL");
  }
  return collectHistoryIdentities(entries);
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
