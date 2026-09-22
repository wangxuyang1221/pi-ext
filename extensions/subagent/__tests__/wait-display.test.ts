import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, vi } from "vitest";
import { initTheme, SessionManager, ToolExecutionComponent, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { SubagentManager } from "../src/manager.js";
import { registerDirectChild } from "../src/ownership.js";
import { createSessionState, SessionStateStore } from "../src/state-store.js";
import { registerSubagentTools } from "../src/tools.js";
import { encodeSettledCursor } from "../src/cursor.js";

async function fixture(name = "Iron Man", parentId = "parent") {
  const root = await mkdtemp(join(process.cwd(), ".wait-display-"));
  const store = new SessionStateStore(root);
  const parent = createSessionState({ sessionId: parentId, epoch: "parent-epoch", cwd: root,
    sessionFile: join(root, "parent.jsonl"), now: new Date().toISOString() });
  const child = createSessionState({ sessionId: "01a0c7-child-eb77", epoch: "child-epoch", cwd: root,
    sessionFile: join(root, "child.jsonl"), now: new Date().toISOString(),
    parent: { sessionId: parent.sessionId, epoch: parent.epoch, registrationToken: "token" },
    launch: { displayName: name, cwd: root, sessionDir: root, processInstanceId: "process" },
    processInstanceId: "process",
    tmux: { sessionName: "fixture", windowId: "@1", paneId: "%1", panePid: 1234 } });
  await store.save(registerDirectChild(parent, child, new Date().toISOString()));
  await store.save(child);
  await writeFile(child.runtime.sessionFile, `${JSON.stringify({ type: "session", version: 3,
    id: child.sessionId, timestamp: new Date().toISOString(), cwd: root })}\n`);
  const runtime = { launch: vi.fn(), sendPrompt: vi.fn(), close: vi.fn(), isAlive: vi.fn(async () => true) };
  const manager = new SubagentManager({ store, runtime, stateRoot: root, nativeSessionRoot: root,
    extensionPath: "/fixture.js", piPath: "/fixture", environment: {} });
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, (...args: any[]) => any>();
  registerSubagentTools({ registerTool: tool => tools.set(tool.name, tool),
    on: (event: string, handler: any) => handlers.set(event, handler) } as any, manager);
  const tool = tools.get("subagent_wait")!;
  const args = { agentId: child.sessionId, timeoutMs: 1000,
    afterSettled: encodeSettledCursor({ agentId: child.sessionId, epoch: child.epoch, generation: 0 }) };
  const ctx = { sessionManager: { getSessionId: () => parent.sessionId, getSessionFile: () => parent.runtime.sessionFile } };
  initTheme("dark", false);
  const row = (input = args) => new ToolExecutionComponent(tool.name, "wait-call", input, { showImages: false }, tool,
    { requestRender() {} }, root);
  return { root, store, child, parent, runtime, manager, tool, handlers, args, ctx, row,
    cleanup: async () => { await manager.releaseAllNamespaces(); await rm(root, { recursive: true, force: true }); } };
}

const plain = (row: ToolExecutionComponent) => row.render(120).map(stripTerminalSequences).join("\n");

async function runHost(f: Awaited<ReturnType<typeof fixture>>, signal?: AbortSignal) {
  const host = await realpath("node_modules/@earendil-works/pi-coding-agent/dist/index.js");
  const { runAgentLoop } = await import(new URL("../../pi-agent-core/dist/index.js", pathToFileURL(host)).href);
  const session = SessionManager.create(f.root, join(f.root, "history"));
  const row = f.row(f.args);
  const model = { api: "openai-completions", provider: "fixture", id: "offline" };
  let calls = 0;
  const messages = await runAgentLoop([{ role: "user", content: "wait", timestamp: Date.now() }],
    { systemPrompt: "", messages: [], tools: [{ ...f.tool,
      execute: (id: string, args: any, signal: any, update: any) => f.tool.execute(id, args, signal, update, f.ctx as never),
    }] }, {
      model, convertToLlm: (messages: any) => messages,
      afterToolCall: async (context: any) => f.handlers.get("tool_result")?.({
        toolName: context.toolCall.name, toolCallId: context.toolCall.id, input: context.args,
        ...context.result, isError: context.isError,
      }),
    }, (event: any) => {
      if (event.type === "message_end") session.appendMessage(event.message);
      if (event.type === "tool_execution_update") row.updateResult({ ...event.partialResult, isError: false }, true);
      if (event.type === "tool_execution_end") row.updateResult({ ...event.result, isError: event.isError });
    }, signal, async () => {
      const first = calls++ === 0;
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: first ? "toolUse" : "stop",
        content: first ? [{ type: "toolCall", id: "wait-call", name: f.tool.name, arguments: f.args }] : [{ type: "text", text: "Done" }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      return { async *[Symbol.asyncIterator]() { yield { type: "done", reason: message.stopReason, message }; },
        result: async () => message };
    });
  const result = messages.find((message: any) => message.role === "toolResult");
  const reopened = SessionManager.open(session.getSessionFile()!).getEntries()
    .find((entry: any) => entry.type === "message" && entry.message.role === "toolResult") as any;
  const history = f.row(f.args);
  history.updateResult(reopened.message);
  return { result, row, history };
}

test("shows the persisted name while a real wait is still running", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const row = f.row();
  let pending: Promise<unknown> | undefined;
  try {
    const reached = Promise.withResolvers<void>();
    f.runtime.isAlive.mockImplementation(async () => { reached.resolve(); return true; });
    pending = f.tool.execute("wait-call", f.args, controller.signal, update => row.updateResult({ ...update, isError: false }, true), f.ctx as never);
    await reached.promise;
    assert.match(plain(row), /Waiting for Iron Man/u);
    assert.doesNotMatch(plain(row), /01a0c7/u);
  } finally {
    controller.abort(new Error("Wait cancelled"));
    await pending?.catch(() => undefined);
    await f.cleanup();
  }
});

test("persists the name and host error flag when a real wait fails", async () => {
  const f = await fixture();
  try {
    f.args.afterSettled = "invalid-cursor";
    const { result, row, history } = await runHost(f);
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, "Invalid cursor prefix");
    assert.equal(result.details.agent.name, "Iron Man");
    for (const component of [row, history]) {
      assert.match(plain(component), /Wait failed Iron Man/u);
      assert.match(plain(component), /cursor/iu);
      for (const expanded of [false, true]) {
        component.setExpanded(expanded);
        component.invalidate();
        assert.match(plain(component), /Wait failed Iron Man/u);
        for (const width of [0, 1, 12, 40, 80, 120]) {
          assert.ok(component.render(width).every(line => visibleWidth(line) <= width));
        }
      }
    }
  } finally { await f.cleanup(); }
});

test("keeps cancellation text, failure status and name in persisted results", async () => {
  const f = await fixture("reviewer");
  const controller = new AbortController();
  try {
    f.runtime.isAlive.mockImplementation(async () => {
      controller.abort(new Error("User cancelled waiting"));
      return true;
    });
    const { result, history } = await runHost(f, controller.signal);
    assert.equal(controller.signal.aborted, true);
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, "User cancelled waiting");
    assert.equal(result.details.outcome, undefined);
    assert.match(plain(history), /Wait failed reviewer/u);
    assert.match(plain(history), /User cancelled waiting/u);
  } finally { await f.cleanup(); }
});

for (const failure of ["missing", "ownership"] as const) test(`does not expose a name for a ${failure} target`, async () => {
  const f = await fixture("Private name");
  try {
    if (failure === "missing") await f.store.delete(f.child.sessionId);
    else await f.store.update(f.child.sessionId, child => ({ ...child, parent: { ...child.parent!, epoch: "other-parent" } }));
    const { result, row, history } = await runHost(f);
    assert.equal(result.isError, true);
    assert.equal(result.details.agent, undefined);
    for (const component of [row, history]) {
      assert.match(plain(component), /Wait failed 01a0c7…eb77/u);
      assert.doesNotMatch(plain(component), /Private name/u);
    }
  } finally { await f.cleanup(); }
});

for (const outcome of ["timeout", "settled", "interrupted", "closed"] as const) {
  test(`retains the persisted name for a normal ${outcome} outcome`, async () => {
    const f = await fixture("reviewer");
    try {
      if (outcome !== "timeout") await f.store.update(f.child.sessionId, child => ({ ...child, runtime: {
        ...child.runtime, status: outcome, generation: outcome === "settled" ? 1 : 0,
        settledGeneration: outcome === "settled" ? 1 : 0,
      } }));
      const { result, row, history } = await runHost(f);
      assert.equal(result.isError, false, JSON.stringify(result.content));
      assert.equal(result.details.outcome, outcome);
      for (const component of [row, history]) assert.match(plain(component), /Finished waiting for reviewer/u);
    } finally { await f.cleanup(); }
  });
}

test("publishes identity once without extra state reads or runtime probes", async () => {
  const f = await fixture();
  try {
    const reads = vi.spyOn(f.store, "load");
    const scans = vi.spyOn(f.store, "listOwned");
    const options = { afterSettled: f.args.afterSettled, timeoutMs: 0 };
    await f.manager.wait(f.parent.sessionId, f.child.sessionId, options);
    const baseline = reads.mock.calls.map(args => args[0]);
    reads.mockClear();
    const onAgent = vi.fn();
    await f.manager.wait(f.parent.sessionId, f.child.sessionId, { ...options, onAgent });
    assert.equal(onAgent.mock.calls.length, 1);
    assert.equal(onAgent.mock.calls[0]![0].name, "Iron Man");
    assert.deepEqual(reads.mock.calls.map(args => args[0]), baseline);
    assert.equal(scans.mock.calls.length, 0);
    assert.equal(f.runtime.isAlive.mock.calls.length, 2);
  } finally { await f.cleanup(); }
});

test("keeps wait identities isolated across simultaneous parent sessions", async () => {
  const first = await fixture("Iron Man", "first-parent");
  const second = await fixture("Storm", "second-parent");
  try {
    first.args.afterSettled = "invalid";
    second.args.afterSettled = "invalid";
    const [a, b] = await Promise.all([runHost(first), runHost(second)]);
    assert.match(plain(a.history), /Wait failed Iron Man/u);
    assert.doesNotMatch(plain(a.history), /Storm/u);
    assert.match(plain(b.history), /Wait failed Storm/u);
    assert.doesNotMatch(plain(b.history), /Iron Man/u);
  } finally { await first.cleanup(); await second.cleanup(); }
});

test("keeps simultaneous targets in one parent separate", async () => {
  const f = await fixture();
  try {
    const other = { ...f.child, sessionId: "other-child", epoch: "other-epoch",
      launch: { ...f.child.launch!, displayName: "Storm" } };
    await f.store.save(other);
    await f.store.update(f.parent.sessionId, parent => registerDirectChild(parent, other, new Date().toISOString()));
    f.args.afterSettled = "invalid";
    const [a, b] = await Promise.all([runHost(f), runHost({ ...f, args: { ...f.args, agentId: other.sessionId } })]);
    assert.match(plain(a.row), /Wait failed Iron Man/u);
    assert.doesNotMatch(plain(a.row), /Storm/u);
    assert.match(plain(b.row), /Wait failed Storm/u);
    assert.doesNotMatch(plain(b.row), /Iron Man/u);
  } finally { await f.cleanup(); }
});

test("retains a known wait name when a later host error has no details", async () => {
  const f = await fixture("reviewer");
  try {
    const row = f.row();
    await f.tool.execute("wait-call", { ...f.args, timeoutMs: 0 }, undefined,
      update => row.updateResult({ ...update, isError: false }, true), f.ctx as never);
    row.updateResult({ content: [{ type: "text", text: "Host error" }], details: {}, isError: true });
    assert.match(plain(row), /Wait failed reviewer/u);
    assert.match(plain(row), /Host error/u);
    assert.doesNotMatch(plain(row), /Waiting for a newer/u);
    const other = f.row();
    other.updateResult({ content: [{ type: "text", text: "Unknown target" }], details: {}, isError: true });
    assert.doesNotMatch(plain(other), /reviewer/u);
  } finally { await f.cleanup(); }
});
