import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, vi } from "vitest";

import sourceExtension from "../src/index.js";
import type { ManagedTmuxRuntime } from "../src/manager.js";
import { createSessionState, SessionStateStore as SourceStore } from "../src/state-store.js";

const SessionStateStore = process.env.PI_SUBAGENT_FIXTURE_DIST === "1" ? (await import("../dist/state-store.js")).SessionStateStore : SourceStore;
const subagentExtension = process.env.PI_SUBAGENT_FIXTURE_DIST === "1" ? (await import("../dist/index.js")).default : sourceExtension;

const eventNames = [
  "resources_discover",
  "session_start",
  "session_shutdown",
  "agent_start",
  "agent_settled",
  "session_tree",
];

test("installs the quit editor only for a root TUI session", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  const handlers = new Map<string, (...args: any[]) => unknown>();
  let factory: unknown;
  const ui = {
    getEditorComponent: vi.fn(() => undefined),
    setEditorComponent: vi.fn((value: unknown) => { factory = value; }),
  };
  const ctx = {
    mode: "tui",
    ui,
    cwd: root,
    sessionManager: {
      getSessionId: () => "parent-a",
      getSessionFile: () => join(root, "parent-a.jsonl"),
      getLeafId: () => null,
      getEntries: () => [],
    },
  };
  try {
    subagentExtension({
      on: (name: string, handler: any) => handlers.set(name, handler),
      registerTool() {},
    } as never, { env: { PATH: "/usr/bin" }, stateRoot: root });

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("resources_discover")!({ reason: "startup" }, ctx);

    assert.equal(typeof factory, "function");
    assert.equal(ui.setEditorComponent.mock.calls.length, 1);
    await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["rpc", "json", "print"])("does not install the quit editor in %s mode", async (mode) => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const ui = { setEditorComponent: vi.fn() };
  const ctx = {
    mode,
    ui,
    cwd: root,
    sessionManager: {
      getSessionId: () => "parent-a",
      getSessionFile: () => join(root, "parent-a.jsonl"),
      getLeafId: () => null,
      getEntries: () => [],
    },
  };
  try {
    subagentExtension({
      on: (name: string, handler: any) => handlers.set(name, handler),
      registerTool() {},
    } as never, { env: { PATH: "/usr/bin" }, stateRoot: root });

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("resources_discover")!({ reason: "startup" }, ctx);

    assert.equal(ui.setEditorComponent.mock.calls.length, 0);
    await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wires the public tools to Pi session lifecycle events", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  const store = new SessionStateStore(root);
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const tools: Array<{ name: string }> = [];
  const runtime: ManagedTmuxRuntime = {
    async launch() { throw new Error("not used"); },
    async sendPrompt() {},
    async isAlive() { return true; },
    async close() {},
  };
  const pi = {
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      handlers.set(event, handler);
    }),
    registerTool: vi.fn((tool: { name: string }) => {
      tools.push(tool);
    }),
    exec: vi.fn(),
  };
  let leafId = "user-a";
  const ctx = {
    cwd: "/repo",
    sessionManager: {
      getSessionId: () => "parent-a",
      getSessionFile: () => "/sessions/parent-a.jsonl",
      getLeafId: () => leafId,
      getEntries: () => [],
    },
  };

  try {
    subagentExtension(pi as never, {
      env: { PATH: "/usr/bin" },
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      store,
      runtime,
      createId: () => "parent-epoch",
      now: () => "2026-08-27T02:00:00.000Z",
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
    });

    assert.equal(tools.length, 6);
    assert.deepEqual(eventNames.filter((name) => handlers.has(name)), eventNames);

    await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    await handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    await handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    leafId = "assistant-a";
    await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);

    const state = await store.load("parent-a");
    assert.equal(state?.epoch, "parent-epoch");
    assert.equal(state?.runtime.generation, 1);
    assert.equal(state?.runtime.settledGeneration, 1);
    assert.equal(state?.runtime.settledEntryId, "assistant-a");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("releases the previous namespace controller when the root switches sessions", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  const handlers = new Map<string, (...args: any[]) => unknown>();
  try {
    subagentExtension({ on: (name: string, handler: any) => handlers.set(name, handler), registerTool() {} } as never,
      { env: { PATH: "/usr/bin" }, stateRoot: root });
    let sessionId = "first";
    const ctx = { cwd: root, sessionManager: { getSessionId: () => sessionId, getSessionFile: () => join(root, `${sessionId}.jsonl`), getLeafId: () => null, getEntries: () => [] } };
    await handlers.get("session_start")!({}, ctx);
    sessionId = "second";
    await handlers.get("session_start")!({}, ctx);
    await assert.rejects(stat(join(root, "controllers", "first")), { code: "ENOENT" });
    assert.ok(await stat(join(root, "controllers", "second")));
    await handlers.get("session_shutdown")!({});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(["shutdown", "session switch"])("%s releases ownership acquired by a tool after a read-only startup", async (action) => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  const create = () => {
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
    const tools = new Map<string, any>();
    const store = new SessionStateStore(root);
    subagentExtension({ on: (name: string, handler: any) => handlers.set(name, handler), registerTool: (tool: any) => tools.set(tool.name, tool) } as never,
      { env: { PATH: "/usr/bin" }, stateRoot: root, store });
    return { handlers, tools, store };
  };
  const ctx = { cwd: root, sessionManager: { getSessionId: () => "parent", getSessionFile: () => join(root, "parent.jsonl"), getLeafId: () => null, getEntries: () => [] } };
  const a = create(); const b = create(); const c = create();
  try {
    await a.handlers.get("session_start")!({}, ctx);
    const firstEpoch = (await a.store.loadRuntime("parent"))!.control!.controllerEpoch;
    await b.handlers.get("session_start")!({}, ctx);
    assert.equal((await b.store.loadRuntime("parent"))!.control!.controllerEpoch, firstEpoch);
    await a.handlers.get("session_shutdown")!({});
    await b.tools.get("subagent_list").execute("list", {}, undefined, undefined, ctx);
    const secondEpoch = (await b.store.loadRuntime("parent"))!.control!.controllerEpoch;
    assert.notEqual(secondEpoch, firstEpoch);
    if (action === "shutdown") await b.handlers.get("session_shutdown")!({});
    else await b.handlers.get("session_start")!({}, { ...ctx, sessionManager: {
      ...ctx.sessionManager, getSessionId: () => "next", getSessionFile: () => join(root, "next.jsonl"),
    } });
    await assert.rejects(stat(join(root, "controllers", "parent")), { code: "ENOENT" });
    await c.handlers.get("session_start")!({}, ctx);
    assert.notEqual((await c.store.loadRuntime("parent"))!.control!.controllerEpoch, secondEpoch);
  } finally {
    for (const instance of [a, b, c]) await instance.handlers.get("session_shutdown")!({}).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["corrupt", "old-schema"])("production startup rolls back new control ownership after a %s root fails validation", async (kind) => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  const store = new SessionStateStore(root);
  const createExtension = () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    subagentExtension({ on: (name: string, handler: any) => handlers.set(name, handler), registerTool() {} } as never,
      { env: { PATH: "/usr/bin" }, stateRoot: root, store });
    return handlers;
  };
  const ctx = { cwd: root, sessionManager: { getSessionId: () => "parent", getSessionFile: () => join(root, "parent.jsonl"), getLeafId: () => null, getEntries: () => [] } };
  try {
    await store.save(createSessionState({ sessionId: "parent", epoch: "e", cwd: root, sessionFile: join(root, "parent.jsonl"), now: "now" }));
    const original = await readFile(store.statePath("parent"), "utf8");
    await writeFile(store.statePath("parent"), kind === "corrupt" ? "{broken" : JSON.stringify({ ...JSON.parse(original), schemaVersion: 2 }));
    const first = createExtension();
    await assert.rejects(async () => first.get("session_start")!({}, ctx));
    await first.get("session_shutdown")!({});
    await assert.rejects(stat(join(root, "controllers", "parent")), { code: "ENOENT" });
    await writeFile(store.statePath("parent"), original);
    await store.update("parent", state => state);
    const next = createExtension();
    await next.get("session_start")!({}, ctx);
    assert.ok((await store.load("parent"))?.control?.controllerEpoch);
    await next.get("session_shutdown")!({});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production entry forwards effective agent and tmux configuration without parent pane or credentials", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  try {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const tools = new Map<string, any>();
    let environment: Record<string, string> | undefined;
    const runtime: ManagedTmuxRuntime = {
      async launch(options) { environment = options.environment; throw new Error("Captured launch"); },
      async sendPrompt() {}, async capturePane() { return ""; }, async isAlive() { return false; }, async close() {},
    };
    const pi = { on: (name: string, handler: any) => handlers.set(name, handler), registerTool: (tool: any) => tools.set(tool.name, tool) };
    subagentExtension(pi as never, { store: new SessionStateStore(root), stateRoot: root, nativeSessionRoot: join(root, "native"), runtime,
      env: { PATH: "/usr/bin", PI_CODING_AGENT_DIR: join(root, "agent"), TMUX_PANE: "%parent", OPENAI_API_KEY: "do-not-transfer" },
      tmuxPath: "./custom/tmux", piPath: "./custom/pi",
    });
    const ctx = { cwd: root, sessionManager: { getSessionId: () => "parent", getSessionFile: () => join(root, "parent.jsonl"), getLeafId: () => null, getEntries: () => [] } };
    await handlers.get("session_start")!({}, ctx);
    await tools.get("subagent_spawn").execute("call", { task: "Test" }, undefined, undefined, ctx).catch(() => undefined);
    assert.equal(environment?.PI_CODING_AGENT_DIR, join(root, "agent"));
    assert.equal(environment?.PI_SUBAGENT_TMUX_PATH, join(process.cwd(), "custom/tmux"));
    assert.equal(environment?.PI_SUBAGENT_PI_PATH, join(process.cwd(), "custom/pi"));
    assert.equal(environment?.TMUX_PANE, undefined);
    assert.equal(environment?.OPENAI_API_KEY, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fails fast when PI_SUBAGENT_MAX_ACTIVE is not a positive integer", () => {
  const pi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    exec: vi.fn(),
  };
  const runtime: ManagedTmuxRuntime = {
    async launch() { throw new Error("not used"); },
    async sendPrompt() {},
    async isAlive() { return true; },
    async close() {},
  };

  assert.throws(
    () => subagentExtension(pi as never, {
      env: { PATH: "/usr/bin", PI_SUBAGENT_MAX_ACTIVE: "0" },
      stateRoot: "/tmp/subagent-invalid-max-active",
      nativeSessionRoot: "/tmp/subagent-invalid-max-active-native",
      runtime,
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
    }),
    /Invalid PI_SUBAGENT_MAX_ACTIVE: expected a positive integer/u,
  );
});

test("keeps managed-child lifecycle hooks without registering orchestration tools", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-index-test-"));
  const store = new SessionStateStore(root);
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const tools: Array<{ name: string }> = [];
  const runtime = {
    async launch() { throw new Error("not used"); },
    async sendPrompt() {},
    async isAlive() { return true; },
    async close() {},
    async locatePane(paneId: string) {
      assert.equal(paneId, "%9");
      return {
        sessionName: "pi-subagents-test",
        windowId: "@7",
        paneId,
        panePid: 1234,
      };
    },
  };
  const pi = {
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      handlers.set(event, handler);
    }),
    registerTool: vi.fn((tool: { name: string }) => {
      tools.push(tool);
    }),
    appendEntry: vi.fn(),
    exec: vi.fn(),
  };
  const ctx = {
    mode: "tui",
    ui: { setEditorComponent: vi.fn() },
    cwd: "/repo",
    sessionManager: {
      getSessionId: () => "child-a",
      getSessionFile: () => "/sessions/child-a.jsonl",
      getLeafId: () => "assistant-a",
      getEntries: () => [],
    },
  };

  try {
    subagentExtension(pi as never, {
      env: {
        PATH: "/usr/bin",
        TMUX_PANE: "%9",
        PI_SUBAGENT_PARENT: JSON.stringify({
          sessionId: "parent-a",
          epoch: "parent-epoch",
          registrationToken: "registration-a",
        }),
        PI_SUBAGENT_LAUNCH: JSON.stringify({
          cwd: "/repo",
          sessionDir: "/sessions/managed-a",
          displayName: "Lin",
          processInstanceId: "process-a",
        }),
      },
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      store,
      runtime,
      createId: () => "child-epoch",
      now: () => "2026-08-27T02:00:00.000Z",
      extensionPath: "/package/extensions/subagent/dist/index.js",
      piPath: "/usr/local/bin/pi",
    });

    assert.deepEqual(tools, []);
    assert.deepEqual(eventNames.filter((name) => handlers.has(name)), eventNames);
    assert.equal(handlers.has("context"), true);
    assert.equal(handlers.has("message_end"), true);

    await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    await handlers.get("resources_discover")?.({ type: "resources_discover", reason: "startup" }, ctx);
    assert.equal(ctx.ui.setEditorComponent.mock.calls.length, 0);
    await handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    await handlers.get("message_start")?.({ type: "message_start", message: {
      role: "user", content: [{ type: "text", text: "[subagent:012345abcdef]\nWork" }],
    } }, ctx);
    assert.deepEqual(pi.appendEntry.mock.calls, [["subagent_delivery", {
      agentId: "child-a", epoch: "child-epoch", generation: 1, deliveryId: "012345abcdef",
    }]]);
    await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);

    const state = await store.load("child-a");
    assert.equal(state?.parent?.sessionId, "parent-a");
    assert.equal(state?.runtime.processInstanceId, "process-a");
    assert.equal(state?.runtime.generation, 1);
    assert.equal(state?.runtime.settledGeneration, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
