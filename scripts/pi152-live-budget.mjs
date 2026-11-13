import { mkdir, readFile, writeFile, rm, appendFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const observations = new Set();
export async function drainBudgetObservations() { await Promise.all([...observations]); }

async function recordCompactionUsage(response, path) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      if (pending.length > 1_048_576) throw new Error("Usage observation exceeded its buffer limit");
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (!line.startsWith("data:")) continue;
        let event;
        try { event = JSON.parse(line.slice(5)); } catch { continue; }
        if (event.type !== "response.completed") continue;
        const raw = event.response?.usage;
        const usage = raw && Object.fromEntries(["input_tokens", "output_tokens", "total_tokens"].filter(key => typeof raw[key] === "number").map(key => [key, raw[key]]));
        await appendFile(`${path}.events.jsonl`, JSON.stringify({ at: new Date().toISOString(), pid: process.pid,
          kind: "compaction-usage", usage: usage ?? null }) + "\n");
        return;
      }
    }
  } finally { void reader.cancel().catch(() => {}); }
}

// One ledger is shared by the parent and every Pi child. Never reclaim an
// abandoned lock: a crashed writer must fail closed instead of resetting usage.
async function reserve(path, url, compact) {
  const lock = `${path}.lock`;
  const until = Date.now() + 2000;
  for (;;) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= until) throw new Error("Live budget lock unavailable");
      await delay(10);
    }
  }
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (!Number.isFinite(state.deadline) || Date.now() >= state.deadline) throw new Error("Live budget deadline reached");
    const local = state.localOrigins.includes(url.origin);
    if (!local && !state.allowedOrigins.includes(url.origin)) throw new Error(`Live budget rejected origin: ${url.origin}`);
    const auxiliary = /\/(?:models|oauth\/token|oauth2\/token)\/?$/.test(url.pathname);
    if (!local && !auxiliary) {
      if (state.requests >= state.maxRequests || (compact && state.compactions >= state.maxCompactions)) throw new Error("Live request budget exhausted");
      state.requests++;
      if (compact) state.compactions++;
    } else if (auxiliary) state.auxiliary++;
    await writeFile(path, JSON.stringify(state));
    await appendFile(`${path}.events.jsonl`, JSON.stringify({ at: new Date().toISOString(), pid: process.pid,
      origin: url.origin, path: url.pathname, kind: local ? "local" : auxiliary ? "auxiliary" : compact ? "compaction" : "request",
      requests: state.requests, compactions: state.compactions }) + "\n");
    return state.deadline;
  } finally { await rm(lock, { recursive: true, force: true }); }
}

export function budgetFetch(statePath, fetchImpl = globalThis.fetch) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = init.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    let compact = false;
    if (typeof body === "string") {
      try { compact = JSON.parse(body).input?.some(item => item.type === "compaction_trigger") === true; } catch {}
    }
    const deadline = await reserve(statePath, url, compact);
    const signals = [AbortSignal.timeout(Math.max(1, deadline - Date.now()))];
    if (init.signal) signals.push(init.signal);
    if (input instanceof Request) signals.push(input.signal);
    // Do not let a redirect bypass origin validation or the request counter.
    const response = await fetchImpl(input, { ...init, redirect: "error", signal: AbortSignal.any(signals) });
    if (compact && response.ok && response.body) {
      const observation = recordCompactionUsage(response.clone(), statePath).catch(async error => {
        await appendFile(`${statePath}.events.jsonl`, JSON.stringify({ at: new Date().toISOString(), pid: process.pid,
          kind: "compaction-usage-unavailable", error: error.name }) + "\n");
      });
      observations.add(observation);
      void observation.finally(() => observations.delete(observation));
    }
    return response;
  };
}
