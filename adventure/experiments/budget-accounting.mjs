import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerGoalAccounting } from "../../extensions/goal/dist/accounting.js";
import { GoalStore } from "../../extensions/goal/dist/storage.js";
import { ChildUsageReporter } from "../../extensions/subagent/dist/usage.js";

// Exercise production accounting with synthetic public events, not a live SDK/provider.
const temporary = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), ".budget-"));
const results = [];
let sequence = 0;
async function fixture(name, budget) {
  const root = join(temporary, name);
  const store = new GoalStore(root);
  const lease = await store.openSession({ ownerSessionId: name, cwd: root, sessionFile: join(root, "session.jsonl") });
  await lease.replace(name, lease.snapshot, budget);
  const handlers = new Map();
  const warnings = [];
  const context = {
    mode: "tui", model: { provider: "openai-codex" },
    sessionManager: { getSessionId: () => name, getSessionFile: () => join(root, "session.jsonl"), getEntries: () => [] },
    ui: { notify: (text, level) => warnings.push({ text, level }) },
  };
  registerGoalAccounting({ on: (event, handler) => handlers.set(event, handler) }, {
    snapshot: () => lease.snapshot,
    account: async (expected, usage) => { await lease.account(expected, usage); },
    budget: () => {},
    error: error => { throw error; },
  });
  const emit = async (name, event = {}) => handlers.get(name)?.(event, context);
  await emit("session_start");
  await emit("context");
  const message = async (usage, id = `response-${++sequence}`) => {
    const value = {
      role: "assistant", provider: "openai-codex", model: "synthetic", api: "openai-codex-responses",
      timestamp: ++sequence, responseId: id, content: [{ type: "text", text: "Fixture" }], stopReason: "stop", usage,
    };
    await emit("message_start", { message: value });
    await emit("message_end", { message: value });
    return value;
  };
  return { store, lease, root, warnings, emit, message, close: async () => { await emit("session_shutdown"); await lease.close(); } };
}
const values = [
  ["cache-and-reasoning", { input: 50, output: 10, cacheWrite: 30, cacheRead: 20, reasoning: 8, totalTokens: 110 }, 90, false],
  ["reasoning-subset", { input: 3, output: 10, reasoning: 8 }, 13, false],
  ["cache-read-only", { input: 0, output: 0, cacheRead: 20, cacheWrite: 0 }, 0, false],
  ["cache-write-only", { input: 0, output: 0, cacheWrite: 10 }, 10, false],
  ["unverified-zero", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 0, true],
  ["missing", undefined, 0, true],
  ["missing-output", { input: 3 }, 0, true],
  ["negative", { input: -1, output: 3 }, 0, true],
  ["fraction", { input: 1.5, output: 3 }, 0, true],
  ["string", { input: "3", output: 3 }, 0, true],
  ["nan", { input: 1, output: NaN }, 0, true],
  ["infinity", { input: Infinity, output: 1 }, 0, true],
  ["invalid-cache-read", { input: 3, output: 4, cacheRead: -1 }, 0, true],
  ["invalid-cache-write", { input: 3, output: 4, cacheWrite: null }, 0, true],
  ["overflow", { input: Number.MAX_SAFE_INTEGER, output: 1 }, 0, true],
];
try {
  for (const [name, usage, tokens, missing] of values) {
    for (const budget of [undefined, 100]) {
      const f = await fixture(`${name}-${budget ?? "none"}`, budget);
      try {
        const message = await f.message(usage);
        await f.emit("message_end", { message });
        assert.equal(f.lease.snapshot.goal.tokensUsed, tokens);
        assert.equal(!!f.lease.snapshot.goal.usageIncomplete, missing);
        assert.equal(f.lease.snapshot.goal.status, "active");
        assert.equal(f.warnings.length, missing ? 1 : 0);
        await f.message({ input: 3, output: 4 });
        assert.equal(f.lease.snapshot.goal.tokensUsed, tokens + 7);
        assert.equal(!!f.lease.snapshot.goal.usageIncomplete, missing);
        results.push({ name, source: "root", budget: budget ?? null, tokens, missing, replayCharged: false, passed: true });
      } finally { await f.close(); }
    }
    const directory = join(temporary, `child-${name}`);
    const reporter = new ChildUsageReporter(directory);
    await reporter.record("source", "receipt", usage);
    await reporter.record("source", "receipt", usage);
    const first = JSON.parse(await readFile(join(directory, "source.json"), "utf8"));
    assert.equal(first.tokens, tokens);
    assert.equal(first.missing, missing);
    await reporter.record("source", "valid-later", { input: 3, output: 4 });
    const later = JSON.parse(await readFile(join(directory, "source.json"), "utf8"));
    assert.equal(later.tokens, tokens + 7);
    assert.equal(later.missing, missing);
    results.push({ name, source: "child", tokens, missing, replayCharged: false, passed: true });
  }
  const f = await fixture("combined-sources", 100);
  try {
    await f.message({ input: 7, output: 3 });
    await f.emit("session_before_compact");
    await f.emit("session_compact", { compactionEntry: { id: "compact", usage: { input: 15, output: 5 } } });
    await f.emit("session_before_tree", { preparation: { userWantsSummary: true } });
    await f.emit("session_tree", { summaryEntry: { id: "summary", usage: { input: 7, output: 3 } } });
    await f.lease.subscribeChild(f.lease.snapshot, { sourceId: "child", reportPath: join(f.root, "child.json"), tokens: 0, missing: false });
    await f.lease.accountChild(f.lease.snapshot, { sourceId: "child", tokens: 30, missing: false });
    assert.equal(f.lease.snapshot.goal.tokensUsed, 70);
    await f.message({ input: 20, output: 10 });
    assert.equal(f.lease.snapshot.goal.status, "budget_limited");
    const wrap = await f.message({ input: 7, output: 3 });
    await f.emit("message_end", { message: wrap });
    assert.equal(f.lease.snapshot.goal.tokensUsed, 110);
    await f.emit("agent_settled");
    await f.lease.control("edit", f.lease.snapshot, "Edited");
    await f.lease.control("resume", f.lease.snapshot);
    assert.equal(f.lease.snapshot.goal.tokensUsed, 110);
    assert.equal(f.lease.snapshot.goal.status, "budget_limited");
    await f.lease.accountChild(f.lease.snapshot, { sourceId: "child", tokens: 50, missing: true });
    assert.equal(f.lease.snapshot.goal.tokensUsed, 110);
    assert.equal(f.lease.snapshot.goal.childUsage[0].tokens, 50);
    assert.equal(f.lease.snapshot.goal.usageIncomplete, undefined);
    results.push({ name: "combined-sources", tokens: 110, budget: 100, passed: true });
  } finally { await f.close(); }
  const f2 = await fixture("sticky-missing", 100);
  try {
    await f2.message(undefined);
    await f2.message({ input: 3, output: 4 });
    await f2.lease.control("pause", f2.lease.snapshot);
    await f2.lease.control("edit", f2.lease.snapshot, "Edited");
    await f2.lease.control("resume", f2.lease.snapshot);
    assert.equal(f2.lease.snapshot.goal.usageIncomplete, true);
    const saved = f2.lease.snapshot;
    await f2.close();
    const reopened = await f2.store.openSession(saved);
    try {
      assert.equal(reopened.snapshot.goal.tokensUsed, 7);
      assert.equal(reopened.snapshot.goal.usageIncomplete, true);
      await reopened.replace("New", reopened.snapshot, 100);
      assert.equal(reopened.snapshot.goal.tokensUsed, 0);
      assert.equal(reopened.snapshot.goal.usageIncomplete, undefined);
    } finally { await reopened.close(); }
    results.push({ name: "sticky-missing", survivedResumeEditReopen: true, resetForNewGoal: true, passed: true });
  } finally { await f2.close(); }
  console.log(JSON.stringify({ method: "production-accounting-with-synthetic-events", sdkOrProviderVerified: false, scenarios: results.length, results }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
