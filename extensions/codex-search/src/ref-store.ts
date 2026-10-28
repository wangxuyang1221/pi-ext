import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

export interface RefStore {
  resolveRefId(url: string): string | undefined;
  remember(url: string, refId: string): Promise<void>;
  load(sessionDir: string, sessionId: string): Promise<void>;
}

interface StoredRefs {
  version: 1;
  sessionId: string;
  urlToRefId: Record<string, string>;
}

interface Scope { file: string; sessionId: string }
const PERSIST_QUEUES = new Map<string, Promise<void>>();

export function createRefStore(): RefStore {
  const urlToRefId = new Map<string, string>();
  let scope: Scope | undefined;

  return {
    resolveRefId(url: string): string | undefined {
      return urlToRefId.get(url) ?? undefined;
    },

    async remember(url: string, refId: string): Promise<void> {
      urlToRefId.set(url, refId);
      if (scope) {
        await enqueuePersist(scope, { [url]: refId });
      }
    },

    async load(dir: string, sessionId: string): Promise<void> {
      urlToRefId.clear();
      scope = undefined;
      if (!sessionId) throw new Error("A session ID is required for search references.");
      const identity = { sessionId, file: join(resolve(dir), `pi-codex-search-refs-${createHash("sha256").update(sessionId).digest("hex")}.json`) };
      const stored = await loadStored(identity);
      scope = identity;
      for (const [url, refId] of Object.entries(stored.urlToRefId)) {
        urlToRefId.set(url, refId);
      }
    },
  };
}

async function loadStored(scope: Scope): Promise<StoredRefs> {
  try {
    const raw = await readFile(scope.file, "utf-8");
    const parsed = JSON.parse(raw) as StoredRefs;
    if (!parsed || parsed.version !== 1 || parsed.sessionId !== scope.sessionId ||
      !parsed.urlToRefId || typeof parsed.urlToRefId !== "object" || Array.isArray(parsed.urlToRefId) ||
      Object.values(parsed.urlToRefId).some(value => typeof value !== "string")) {
      throw new Error("Invalid search reference file or session identity.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sessionId: scope.sessionId, urlToRefId: {} };
    throw error;
  }
}

async function enqueuePersist(scope: Scope, entries: Record<string, string>): Promise<void> {
  const previous = PERSIST_QUEUES.get(scope.file) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => persistMerged(scope, entries));
  PERSIST_QUEUES.set(scope.file, next);
  try {
    await next;
  } finally {
    if (PERSIST_QUEUES.get(scope.file) === next) PERSIST_QUEUES.delete(scope.file);
  }
}

async function persistMerged(scope: Scope, entries: Record<string, string>): Promise<void> {
  const current = await loadStored(scope);
  const stored: StoredRefs = {
    version: 1,
    sessionId: scope.sessionId,
    urlToRefId: {
      ...current.urlToRefId,
      ...entries,
    },
  };
  const temporary = `${scope.file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(stored, null, 2), { encoding: "utf-8", flag: "wx" });
    await rename(temporary, scope.file);
  } finally {
    await rm(temporary, { force: true });
  }
}
