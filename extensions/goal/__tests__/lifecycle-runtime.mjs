import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(resolve(".goal-lifecycle-test-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
const sdkRoot = resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(sdkRoot, "../pi-ai/dist/index.js")).href);
const { registerGoal, GOAL_MIRROR } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const version = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8")).version;
const disk = new GoalStore(join(root, "goals"));
const { ModelRuntime, SettingsManager, SessionManager, createAgentSessionServices, createAgentSessionFromServices, createAgentSessionRuntime } = sdk;
const faux = ai.fauxProvider({ provider: "goal-lifecycle-test" });
const modelRuntime = await ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const notices = [];
const errors = [];
const results = [];
let selection = "clone";
let cancelFork = false;
let failCreation = false;
let editorText;
let captured;
let runtime;
const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
  if (failCreation) { failCreation = false; throw new Error("Injected replacement construction failure"); }
  const services = await createAgentSessionServices({
    cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [pi => {
        registerGoal(pi, disk);
        pi.on("session_before_fork", () => cancelFork ? { cancel: true } : undefined);
        pi.registerCommand("capture-context", { handler: async (_args, ctx) => { captured = { ctx, pi }; } });
      }],
    },
  });
  return { ...await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: "all" }), services, diagnostics: services.diagnostics };
};
const bind = async session => session.bindExtensions({ mode: "tui", uiContext: {
  notify: (text, level) => notices.push({ text, level }),
  confirm: async () => true,
  select: async (title, choices) => {
    if (selection === "cancel" || (selection === "cancel-history" && title === "Fork before user message")) return undefined;
    if (title === "Inherit current goal") return choices[selection === "clone" ? 1 : 0];
    return choices.at(-1);
  },
  setEditorText: text => { editorText = text; },
  setStatus() {}, setWidget() {},
}, commandContextActions: {
  newSession: options => runtime.newSession(options),
  switchSession: (path, options) => runtime.switchSession(path, options),
  fork: (id, options) => runtime.fork(id, options),
  navigateTree: (id, options) => runtime.session.navigateTree(id, options),
  waitForIdle: () => runtime.session.waitForIdle(),
  reload: () => runtime.session.reload(),
}, onError: error => errors.push(error.error) });
async function start(manager) {
  runtime = await createAgentSessionRuntime(createRuntime, { cwd: root, agentDir: join(root, "agent"), sessionManager: manager });
  runtime.setRebindSession(bind);
  await bind(runtime.session);
}
async function current() { return (await disk.records()).find(row => row.ownerSessionId === runtime.session.sessionId); }
async function show(text) {
  await runtime.session.prompt("/goal");
  assert.ok(notices.at(-1).text.includes(text), notices.at(-1).text);
}
async function assertStale(previous) {
  const before = await disk.records();
  assert.throws(() => previous.pi.appendEntry(GOAL_MIRROR, {}), /stale|disposed|active|invalid/i);
  assert.throws(() => previous.ctx.newSession(), /stale|disposed|active|invalid/i);
  assert.deepEqual(await disk.records(), before);
}
try {
  await start(SessionManager.create(root, join(root, "sessions")));
  await runtime.session.prompt("/goal Historical objective");
  const firstUser = runtime.session.sessionManager.appendMessage({ role: "user", content: "Historical user prompt", timestamp: Date.now() });
  const firstAssistant = runtime.session.sessionManager.appendMessage(ai.fauxAssistantMessage("Fixture response"));
  const lastUser = runtime.session.sessionManager.appendMessage({ role: "user", content: "Latest user prompt", timestamp: Date.now() });
  runtime.session.sessionManager.appendMessage(ai.fauxAssistantMessage("Fixture later response"));
  await runtime.session.prompt("/goal Latest objective");
  let source = await current();
  source.goal = { ...source.goal, status: "complete", tokenBudget: 1000, tokensUsed: 450, elapsedSeconds: 32.5 };
  // Test fixture only. Production mutations use the lease, not direct commits.
  await disk.commit(source);
  await runtime.session.reload();
  const sourcePath = runtime.session.sessionFile;
  const sourceId = runtime.session.sessionId;
  await runtime.session.navigateTree(firstAssistant, { summarize: false });
  await show("Goal: complete");
  await show("Tokens used: 450");
  assert.deepEqual(await current(), source);
  assert.equal(runtime.session.sessionId, sourceId);
  results.push("tree-preserves-latest-objective-complete-status-and-usage");

  await runtime.session.prompt("/goal clear");
  const tombstone = await current();
  await runtime.session.navigateTree(firstUser, { summarize: false });
  await show("No goal set");
  await runtime.session.reload();
  assert.deepEqual(await current(), tombstone);
  await show("No goal set");
  results.push("tree-and-reload-do-not-resurrect-cleared-goal");

  await runtime.session.prompt("/goal Current inherited objective");
  source = await current();
  source.goal = { ...source.goal, tokenBudget: 1000, tokensUsed: 450, elapsedSeconds: 32.5 };
  await disk.commit(source);
  await runtime.session.reload();
  await runtime.session.prompt("/capture-context");
  const beforeNew = captured;
  await runtime.newSession();
  await show("No goal set");
  assert.equal(await current(), undefined);
  await assertStale(beforeNew);
  await runtime.switchSession(sourcePath);
  await show("Current inherited objective");
  assert.deepEqual(await current(), source);
  results.push("new-and-resume-bind-only-owned-record-and-invalidate-old-context");

  await runtime.fork(lastUser);
  assert.ok(runtime.session.sessionManager.getEntries().some(entry => entry.customType === GOAL_MIRROR));
  await show("No goal set");
  assert.equal(await current(), undefined);
  await runtime.session.prompt("/goal Independent ordinary fork");
  assert.deepEqual(await disk.read(source.recordId), source);
  await runtime.switchSession(sourcePath);
  await runtime.fork(runtime.session.sessionManager.getLeafId(), { position: "at" });
  assert.ok(runtime.session.sessionManager.getEntries().some(entry => entry.customType === GOAL_MIRROR));
  await show("No goal set");
  assert.equal(await current(), undefined);
  await runtime.switchSession(sourcePath);
  results.push("ordinary-fork-and-clone-ignore-copied-mirrors");

  selection = "fork";
  await runtime.session.prompt("/capture-context");
  const beforeFork = captured;
  await runtime.session.prompt("/goal-fork");
  const inheritedFork = await current();
  assert.notEqual(inheritedFork.recordId, source.recordId);
  assert.deepEqual(inheritedFork.goal, source.goal);
  assert.equal(inheritedFork.continuationDeferral, true);
  assert.equal(editorText, "Latest user prompt");
  assert.deepEqual(await disk.read(source.recordId), source);
  await assertStale(beforeFork);
  results.push("explicit-history-fork-copies-current-full-snapshot-not-old-mirror");

  const inheritedPath = runtime.session.sessionFile;
  await runtime.session.reload();
  assert.deepEqual(await current(), inheritedFork);
  await show("Automatic continuation deferred");
  await runtime.dispose();
  await start(SessionManager.open(inheritedPath, join(root, "sessions")));
  assert.deepEqual(await current(), inheritedFork);
  assert.equal(faux.state.callCount, 0);
  results.push("active-inheritance-gate-survives-reload-and-reopen-without-model-call");

  await runtime.session.prompt("Injected extension fixture", { source: "extension" });
  assert.equal((await current()).continuationDeferral, true);
  await runtime.session.prompt("Explicit user turn", { source: "interactive" });
  assert.equal((await current()).continuationDeferral, false);
  const afterExplicitTurn = (await current()).goal;
  // Native responses now accrue usage; inheritance still preserves identity and baseline.
  for (const field of ["goalId", "generation", "objective", "tokenBudget", "createdAt"]) assert.deepEqual(afterExplicitTurn[field], inheritedFork.goal[field]);
  assert.ok(afterExplicitTurn.tokensUsed >= inheritedFork.goal.tokensUsed);
  assert.ok(afterExplicitTurn.elapsedSeconds >= inheritedFork.goal.elapsedSeconds);
  await runtime.session.reload();
  assert.equal((await current()).continuationDeferral, false);
  assert.deepEqual(await disk.read(source.recordId), source);
  results.push("only-interactive-input-releases-gate-and-source-remains-independent");

  await runtime.switchSession(sourcePath);
  selection = "clone";
  await runtime.session.prompt("/goal-fork");
  const inheritedClone = await current();
  assert.deepEqual(inheritedClone.goal, source.goal);
  assert.notEqual(inheritedClone.recordId, source.recordId);
  assert.equal(inheritedClone.continuationDeferral, true);
  assert.deepEqual(await disk.read(source.recordId), source);
  results.push("explicit-clone-copies-full-snapshot-into-distinct-deferred-record");

  await runtime.switchSession(sourcePath);
  const beforeCancel = await disk.records();
  for (const choice of ["cancel", "cancel-history"]) {
    selection = choice;
    await runtime.session.prompt("/goal-fork");
    assert.equal(runtime.session.sessionId, sourceId);
    assert.deepEqual(await disk.records(), beforeCancel);
  }
  selection = "clone";
  cancelFork = true;
  await runtime.session.prompt("/goal-fork");
  cancelFork = false;
  assert.equal(runtime.session.sessionId, sourceId);
  assert.deepEqual(await disk.records(), beforeCancel);
  assert.ok(notices.at(-1).text.includes("cancelled"));
  results.push("picker-and-host-cancellation-preserve-source-and-create-no-record");

  disk.beforeRename = () => { throw new Error("Injected inheritance write failure"); };
  await runtime.session.prompt("/goal-fork");
  disk.beforeRename = undefined;
  assert.notEqual(runtime.session.sessionId, sourceId);
  assert.equal(await current(), undefined);
  assert.ok(notices.at(-1).text.includes("Goal inheritance failed"));
  await show("No goal set");
  assert.deepEqual(await disk.records(), beforeCancel);
  await runtime.session.prompt("/goal New after failed inheritance");
  assert.equal((await current()).goal.objective, "New after failed inheritance");
  assert.deepEqual(await disk.read(source.recordId), source);
  results.push("failed-inheritance-commit-leaves-goalless-session-and-releases-writer");

  await runtime.switchSession(sourcePath);
  await runtime.session.prompt("/capture-context");
  const beforeReload = captured;
  await runtime.session.reload();
  await assertStale(beforeReload);
  assert.deepEqual(await current(), source);
  results.push("reload-invalidates-old-context-and-rebinds-source");

  await runtime.session.prompt("/capture-context");
  const beforeFailure = captured;
  const beforeConstruction = await disk.records();
  failCreation = true;
  await runtime.session.prompt("/goal-fork");
  assert.ok(errors.some(error => error.includes("Injected replacement construction failure")));
  await assertStale(beforeFailure);
  assert.deepEqual(await disk.records(), beforeConstruction);
  await runtime.dispose();
  await start(SessionManager.open(sourcePath, join(root, "sessions")));
  assert.deepEqual(await current(), source);
  results.push("replacement-construction-failure-preserves-source-and-old-context-stays-invalid");

  const beforeOvertakenCommit = await disk.records();
  const originalCommit = disk.commit.bind(disk);
  let releaseCommit;
  let reachedCommit;
  const commitBarrier = new Promise(resolve => { releaseCommit = resolve; });
  const commitReached = new Promise(resolve => { reachedCommit = resolve; });
  disk.commit = async (record, guard) => {
    reachedCommit();
    await commitBarrier;
    return originalCommit(record, guard);
  };
  const pendingInheritance = runtime.session.prompt("/goal-fork");
  await commitReached;
  await runtime.newSession();
  releaseCommit();
  await pendingInheritance;
  disk.commit = originalCommit;
  assert.deepEqual(await disk.records(), beforeOvertakenCommit);
  assert.equal(await current(), undefined);
  assert.ok(errors.at(-1).includes("stale"));
  await runtime.switchSession(sourcePath);
  results.push("replacement-during-inheritance-io-rejects-stale-authoritative-commit");

  for (const status of ["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"]) {
    await runtime.switchSession(sourcePath);
    const stateSource = await current();
    stateSource.goal.status = status;
    await disk.commit(stateSource);
    await runtime.session.reload();
    await runtime.session.prompt("/goal-fork");
    const stateChild = await current();
    assert.deepEqual(stateChild.goal, stateSource.goal);
    assert.equal(stateChild.continuationDeferral, true);
    await runtime.session.reload();
    assert.deepEqual(await current(), stateChild);
    await runtime.session.prompt("Explicit state fixture", { source: "interactive" });
    assert.equal((await current()).continuationDeferral, false);
    const stateAfter = (await current()).goal;
    if (status === "active") {
      for (const field of ["goalId", "generation", "objective", "tokenBudget", "createdAt"]) assert.deepEqual(stateAfter[field], stateSource.goal[field]);
      assert.ok(stateAfter.tokensUsed >= stateSource.goal.tokensUsed);
      assert.ok(stateAfter.elapsedSeconds >= stateSource.goal.elapsedSeconds);
    } else assert.deepEqual(stateAfter, stateSource.goal);
    assert.deepEqual(await disk.read(stateSource.recordId), stateSource);
  }
  results.push("all-six-inherited-states-retain-stats-and-stop-state-through-reload-and-gate-release");

  await runtime.newSession();
  await runtime.session.prompt("/goal Unsaved goal");
  const unsaved = await current();
  const unsavedId = runtime.session.sessionId;
  await runtime.session.prompt("/goal-fork");
  assert.equal(runtime.session.sessionId, unsavedId);
  assert.deepEqual(await current(), unsaved);
  assert.ok(notices.at(-1).text.includes("has not been saved yet"));
  results.push("host-rejects-unsaved-clone-without-losing-pre-reply-goal");

  assert.equal(faux.state.callCount, 8);
  assert.equal(errors.length, 2);
  console.log(JSON.stringify({ version, results, explicitFixtureModelRequests: faux.state.callCount, expectedExtensionErrors: errors }, null, 2));
} finally {
  disk.beforeRename = undefined;
  await runtime?.dispose();
  await rm(root, { recursive: true, force: true });
  assert.equal(existsSync(root), false);
}
