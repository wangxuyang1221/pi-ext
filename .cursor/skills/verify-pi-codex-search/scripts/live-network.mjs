import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const path = process.env.LIVE_VERIFY_STATE;
assert(path && realpathSync(path).startsWith(realpathSync(resolve(repo, ".tmp")) + sep), "Use a repository-local budget file");
const { configureHttpDispatcher } = await import(new URL("./core/http-dispatcher.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
configureHttpDispatcher();
const fetchImpl = globalThis.fetch;
globalThis.WebSocket = undefined;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const lock = path + ".lock";
  const until = Date.now() + 2000;
  for (;;) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= until) throw new Error("Live budget lock unavailable");
      await delay(10);
    }
  }
  let deadline;
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    assert(Number.isSafeInteger(state.maxRequests) && state.maxRequests > 0 && state.maxRequests <= 40);
    assert(Number.isSafeInteger(state.requests) && state.requests >= 0);
    assert(state.allowedOrigins.includes(url.origin), "Live origin is not authorized");
    assert(Number.isFinite(state.deadline) && Date.now() < state.deadline, "Live deadline reached");
    assert(state.requests < state.maxRequests, "Live request budget exhausted");
    state.requests++;
    deadline = state.deadline;
    const temporary = path + `.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, path);
    appendFileSync(path + ".events.jsonl", JSON.stringify({ at: new Date().toISOString(), pid: process.pid,
      origin: url.origin, path: url.pathname, requests: state.requests }) + "\n");
  } finally { if (existsSync(lock)) rmSync(lock, { recursive: true }); }
  const signals = [AbortSignal.timeout(Math.max(1, Math.min(120000, deadline - Date.now())))];
  if (init.signal) signals.push(init.signal);
  if (input instanceof Request) signals.push(input.signal);
  return fetchImpl(input, { ...init, redirect: "error", signal: AbortSignal.any(signals) });
};
