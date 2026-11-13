import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { test } from "node:test";

test("live request guard bounds concurrent calls and rejects unauthorized traffic", async () => {
  const root = mkdtempSync(resolve(".tmp/live-budget-test-"));
  const path = join(root, "budget.json");
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalState = process.env.LIVE_VERIFY_STATE;
  const calls = [];
  const state = { requests: 0, maxRequests: 2, deadline: Date.now() + 60000, allowedOrigins: ["https://example.test"] };
  writeFileSync(path, JSON.stringify(state));
  process.env.LIVE_VERIFY_STATE = path;
  await import(new URL("./core/http-dispatcher.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
  globalThis.fetch = async (input, init) => { calls.push({ input, init }); return new Response("ok"); };
  try {
    await import("./live-network.mjs");
    await assert.rejects(fetch("https://unauthorized.test"), /not authorized/);
    assert.equal(JSON.parse(readFileSync(path)).requests, 0);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => fetch("https://example.test/path?private=value")));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(readFileSync(path)).requests, 2);
    assert(calls.every(call => call.init.redirect === "error" && call.init.signal instanceof AbortSignal));
    assert(!readFileSync(path + ".events.jsonl", "utf8").includes("private"));
    assert(!existsSync(path + ".lock"));
    writeFileSync(path, JSON.stringify({ ...state, deadline: Date.now() - 1 }));
    await assert.rejects(fetch("https://example.test"), /deadline/);
    assert.equal(calls.length, 2);
    assert(!existsSync(path + ".lock"));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    if (originalState === undefined) delete process.env.LIVE_VERIFY_STATE;
    else process.env.LIVE_VERIFY_STATE = originalState;
    rmSync(root, { recursive: true, force: true });
  }
});
