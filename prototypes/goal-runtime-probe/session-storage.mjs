import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Bounded storage experiment. All temporary session files stay inside the repository.
const packageRoot = resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const { SessionManager } = await import(pathToFileURL(resolve(packageRoot, "dist/index.js")).href);
const { fauxAssistantMessage } = await import(pathToFileURL(resolve(packageRoot, "../pi-ai/dist/index.js")).href);
const version = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8")).version;
const root = await mkdtemp(resolve("prototypes/goal-runtime-probe/.storage-probe-"));
const customType = "goal-storage-probe";
const snapshots = (manager) => manager.getEntries().filter((entry) =>
  entry.type === "custom" && entry.customType === customType);
const ownedSnapshot = (manager) => snapshots(manager).findLast((entry) =>
  entry.data.ownerSessionId === manager.getSessionId())?.data;
const record = (manager, data) => manager.appendCustomEntry(customType, {
  ownerSessionId: manager.getSessionId(), ...data,
});
const results = [];
try {
  const fresh = SessionManager.create(process.cwd(), root);
  record(fresh, { goalId: "probe-goal", status: "active", tokensUsed: 0 });
  assert.equal(fresh.isPersisted(), true);
  assert.equal(existsSync(fresh.getSessionFile()), false);
  results.push({ name: "goal-first-custom-entry-not-durable", persistedMode: true, fileExists: false });

  const userId = fresh.appendMessage({ role: "user", content: "Storage probe", timestamp: Date.now() });
  assert.equal(existsSync(fresh.getSessionFile()), false);
  fresh.appendMessage(fauxAssistantMessage("Stored response"));
  const sourcePath = fresh.getSessionFile();
  const reopened = SessionManager.open(sourcePath, root);
  assert.equal(ownedSnapshot(reopened).status, "active");
  results.push({ name: "first-assistant-flushes-pending-goal", restoredStatus: ownedSnapshot(reopened).status });

  record(reopened, { goalId: "probe-goal", status: "complete", tokensUsed: 123 });
  reopened.branch(userId);
  assert.equal(reopened.getBranch().some((entry) => entry.type === "custom"
    && entry.data.status === "complete"), false);
  assert.equal(ownedSnapshot(reopened).status, "complete");
  reopened.appendMessage({ role: "user", content: "Alternate branch", timestamp: Date.now() });
  const restoredTree = SessionManager.open(sourcePath, root);
  assert.equal(ownedSnapshot(restoredTree).tokensUsed, 123);
  results.push({ name: "tree-does-not-erase-session-wide-snapshot", restoredStatus: ownedSnapshot(restoredTree).status });

  const copy = SessionManager.open(sourcePath, root);
  const originalId = copy.getSessionId();
  const copiedPath = copy.createBranchedSession(copy.getLeafId());
  assert.notEqual(copy.getSessionId(), originalId);
  assert.equal(snapshots(copy).length > 0, true);
  assert.equal(ownedSnapshot(copy), undefined);
  results.push({ name: "ordinary-branch-copy-retains-foreign-records", copiedRecords: snapshots(copy).length, ownedGoal: false });

  record(copy, { goalId: "probe-goal", status: "active", tokensUsed: 123, deferred: true });
  // This branch was forked before its first assistant, so even the explicit snapshot is not flushed.
  assert.equal(existsSync(copiedPath), false);
  results.push({ name: "pre-assistant-fork-inheritance-not-durable", fileExists: false });

  const savedCopy = SessionManager.open(sourcePath, root);
  const assistantId = savedCopy.getEntries().find((entry) =>
    entry.type === "message" && entry.message.role === "assistant").id;
  const savedCopyPath = savedCopy.createBranchedSession(assistantId);
  record(savedCopy, { goalId: "probe-goal", status: "active", tokensUsed: 123, deferred: true });
  const restoredCopy = SessionManager.open(savedCopyPath, root);
  assert.equal(ownedSnapshot(restoredCopy).deferred, true);
  assert.equal(ownedSnapshot(restoredCopy).tokensUsed, 123);
  assert.equal(ownedSnapshot(SessionManager.open(sourcePath, root)).status, "complete");
  results.push({ name: "saved-fork-persists-owned-deferred-snapshot", deferred: true, sourceUnchanged: true });

  record(restoredTree, { goal: null });
  assert.equal(ownedSnapshot(SessionManager.open(sourcePath, root)).goal, null);
  results.push({ name: "clear-tombstone-survives-reopen", goal: null });
  console.log(JSON.stringify({ version, results }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
  assert.equal(existsSync(root), false);
}
