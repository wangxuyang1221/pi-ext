import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { HERO_NAMES } from "../src/hero-names.js";
import { SubagentManager, PI_SUBAGENT_LAUNCH, PI_SUBAGENT_PARENT, type ManagedTmuxRuntime } from "../src/manager.js";
import { createSessionState, SessionStateStore, type LaunchMetadata, type ParentOwnership } from "../src/state-store.js";

async function fixture() {
  const root = await mkdtemp(join(process.cwd(), ".hero-name-"));
  const store = new SessionStateStore(root);
  for (const id of ["parent-a", "parent-b"]) await store.save(createSessionState({
    sessionId: id, epoch: `${id}-epoch`, cwd: root, sessionFile: join(root, `${id}.jsonl`), now: new Date().toISOString(),
  }));
  const alive = new Set<string>();
  const files = new Map<string, string>();
  let serial = 0;
  let beforeAuthentication: (() => Promise<void>) | undefined;
  let failPrompt = false;
  let failClose = false;
  const launches: Array<{ name: string; args: string[]; windowName: string }> = [];
  const runtime: ManagedTmuxRuntime = {
    async launch(spec) {
      const launch: LaunchMetadata = JSON.parse(spec.environment[PI_SUBAGENT_LAUNCH]);
      const parent: ParentOwnership = JSON.parse(spec.environment[PI_SUBAGENT_PARENT]);
      const id = `child-${++serial}`;
      const locator = { sessionName: "test", windowId: `@${serial}`, paneId: `%${serial}`, panePid: serial + 1000 };
      const sessionFile = join(launch.sessionDir, "session.jsonl");
      await writeFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: root })}\n`);
      const child = createSessionState({ sessionId: id, epoch: `${id}-epoch`, cwd: root, sessionFile,
        now: new Date().toISOString(), parent, launch, processInstanceId: launch.processInstanceId, tmux: locator });
      child.runtime.promptReady = true;
      child.runtime.status = "settled";
      await store.save(child);
      alive.add(locator.windowId);
      files.set(locator.windowId, sessionFile);
      launches.push({ name: launch.displayName, args: spec.args, windowName: spec.windowName });
      return locator;
    },
    async sendPrompt(locator, text) {
      if (failPrompt) throw new Error("prompt failed");
      await appendFile(files.get(locator.windowId)!, `${JSON.stringify({ type: "message", id: `user-${serial}`, parentId: null,
        timestamp: new Date().toISOString(), message: { role: "user", content: text } })}\n`);
    },
    async capturePane() { return ""; },
    async isAlive(locator) { return alive.has(locator.windowId); },
    async close(locator) { if (failClose) throw new Error("close failed"); alive.delete(locator.windowId); },
  };
  const makeManager = () => new SubagentManager({ store, runtime, stateRoot: root, nativeSessionRoot: join(root, "native"),
    extensionPath: "/fixture.js", piPath: "/pi", environment: {}, maxActive: 200,
    authenticationEnvironment: async () => { await beforeAuthentication?.(); return {}; } });
  const manager = makeManager();
  const seedReservations = async (parent: string, names: string[]) => store.update(parent, state => ({ ...state,
    reservations: names.map((displayName, i) => ({ displayName, reservationId: `old-${i}`, processInstanceId: `old-process-${i}`,
      createdAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00.000Z", launchState: "launching" })),
  }));
  return { root, store, manager, makeManager, launches, seedReservations,
    spawn: (parent = "parent-a", extra = {}) => manager.spawn(parent, { task: "Task only", ...extra }, { cwd: root }),
    beforeAuthentication: (callback: () => Promise<void>) => { beforeAuthentication = callback; },
    setFailures: (prompt: boolean, close: boolean) => { failPrompt = prompt; failClose = close; },
    cleanup: async () => { await manager.releaseNamespace("parent-a"); await manager.releaseNamespace("parent-b"); await rm(root, { recursive: true, force: true }); },
  };
}

test("ignores stale names, persists one allocation across reload, and passes it to Pi and tmux", async () => {
  const f = await fixture();
  try {
    const agent = await f.spawn("parent-a", { name: "caller-selected" });
    assert.ok(HERO_NAMES.includes(agent.name as any));
    assert.equal(f.launches[0]!.args[f.launches[0]!.args.indexOf("--name") + 1], agent.name);
    assert.equal(f.launches[0]!.windowName, agent.name);
    assert.equal((await f.store.load("parent-a"))!.children[0]!.name, agent.name);
    await f.manager.releaseNamespace("parent-a");
    const reloaded = f.makeManager();
    assert.equal((await reloaded.list("parent-a")).agents[0]!.name, agent.name);
    assert.equal((await reloaded.read("parent-a", agent.agentId, { view: "recent_activity" })).agent.name, agent.name);
    await reloaded.releaseNamespace("parent-a");
  } finally { await f.cleanup(); }
});

test("settled children retain names until confirmed close and parent namespaces allocate independently", async () => {
  const f = await fixture();
  try {
    const reserved = HERO_NAMES.filter(name => name !== "Storm");
    await f.seedReservations("parent-a", reserved);
    await f.seedReservations("parent-b", reserved);
    const first = await f.spawn();
    const other = await f.spawn("parent-b");
    assert.equal(first.name, "Storm");
    assert.equal(other.name, "Storm");
    const numbered = await f.spawn();
    assert.match(numbered.name, / 2$/u);
    await f.manager.close("parent-a", first.agentId);
    assert.equal((await f.spawn()).name, "Storm");
  } finally { await f.cleanup(); }
});

test("failed startup releases names only after cleanup confirms the process stopped", async () => {
  const f = await fixture();
  try {
    await f.seedReservations("parent-a", HERO_NAMES.filter(name => name !== "Storm"));
    f.setFailures(true, false);
    await assert.rejects(f.spawn(), /delivery_unconfirmed/u);
    assert.equal((await f.store.load("parent-a"))!.children.length, 0);
    f.setFailures(false, false);
    const first = await f.spawn();
    assert.equal(first.name, "Storm");
    await f.manager.close("parent-a", first.agentId);
    f.setFailures(true, true);
    await assert.rejects(f.spawn(), /Failed to clean up/u);
    assert.equal((await f.store.load("parent-a"))!.children[0]!.name, "Storm");
    f.setFailures(false, false);
    assert.match((await f.spawn()).name, / 2$/u);
  } finally { await f.cleanup(); }
});

test("retains legacy names and reads reservations without display names", async () => {
  const f = await fixture();
  try {
    const old = await f.spawn();
    await f.store.update(old.agentId, state => ({ ...state, launch: { ...state.launch!, displayName: "Legacy custom" } }));
    await f.seedReservations("parent-a", [...HERO_NAMES, ...HERO_NAMES.map(name => `${name} 2`)]);
    await f.store.update("parent-a", state => ({ ...state, reservations: [...state.reservations, {
      reservationId: "legacy", processInstanceId: "legacy-process", createdAt: "2020-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    }] }));
    assert.equal((await f.manager.list("parent-a")).agents[0]!.name, "Legacy custom");
    assert.match((await f.spawn()).name, / 3$/u);
  } finally { await f.cleanup(); }
});

test("parallel registered children remain unique across pool exhaustion", async () => {
  const f = await fixture();
  try {
    const agents = await Promise.all(Array.from({ length: 36 }, () => f.spawn()));
    assert.equal(new Set(agents.map(agent => agent.name)).size, 36);
    assert.equal(agents.filter(agent => HERO_NAMES.includes(agent.name as any)).length, 32);
    assert.equal((await f.store.load("parent-a"))!.reservations.length, 0);
    assert.equal((await f.store.load("parent-a"))!.children.length, 36);
  } finally { await f.cleanup(); }
});

test("legacy bare child names occupy the pool and remain unchanged", async () => {
  const f = await fixture();
  try {
    const old = await f.spawn();
    await f.store.update(old.agentId, state => ({ ...state, launch: { ...state.launch!, displayName: "Storm" } }));
    await f.store.update("parent-a", state => ({ ...state, children: state.children.map(child => ({ ...child, name: "Storm", launch: { ...child.launch, displayName: "Storm" } })) }));
    await f.seedReservations("parent-a", HERO_NAMES.filter(name => name !== "Storm"));
    assert.match((await f.spawn()).name, / 2$/u);
    assert.equal((await f.manager.list("parent-a")).agents.find(agent => agent.agentId === old.agentId)!.name, "Storm");
  } finally { await f.cleanup(); }
});

test("does not launch after its unstarted reservation has been safely reclaimed", async () => {
  const f = await fixture();
  try {
    f.beforeAuthentication(async () => {
      await f.store.update("parent-a", state => ({ ...state, reservations: state.reservations.map(entry => ({ ...entry, expiresAt: "2020-01-01T00:00:00.000Z" })) }));
      await f.manager.list("parent-a");
    });
    await assert.rejects(f.spawn(), /Spawn reservation is no longer active/u);
    assert.equal(f.launches.length, 0);
    assert.equal((await f.store.load("parent-a"))!.reservations.length, 0);
  } finally { await f.cleanup(); }
});

test("expired launches with unknown outcomes keep names reserved", async () => {
  const f = await fixture();
  try {
    await f.seedReservations("parent-a", [...HERO_NAMES]);
    await f.store.update("parent-a", state => ({ ...state, reservations: state.reservations.map(entry => ({ ...entry, expiresAt: "2020-01-01T00:00:00.000Z" })) }));
    assert.match((await f.spawn()).name, / 2$/u);
    assert.equal((await f.store.load("parent-a"))!.reservations.length, 32);
  } finally { await f.cleanup(); }
});
